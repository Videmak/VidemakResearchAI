import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAdmin, type AppVariables } from '../auth.js';
import { stripeClient } from '../lib/stripeBilling.js';
import { forgetPlans, LIMIT_DEFS, LIVE_STATUSES, loadPlans, normalizeLimits } from '../lib/plans.js';
import { syncPlanToStripe } from '../lib/planBilling.js';
import { grantCredits } from '../lib/credits.js';
import { randomUUID } from 'node:crypto';

const countLimit = z.object({ amount: z.number().int().min(0).max(10_000_000).nullable(), per: z.enum(['day', 'month']) });
const PlanInput = z.object({
  name: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(200).default(''),
  sort_order: z.number().int().min(0).max(1000).default(0),
  is_default: z.boolean().default(false),
  is_public: z.boolean().default(true),
  featured: z.boolean().default(false),
  checkout: z.enum(['self_serve', 'contact']).default('self_serve'),
  contact_url: z.string().trim().max(500).nullable().default(null),
  monthly_cents: z.number().int().min(0).max(10_000_000).default(0),
  yearly_cents: z.number().int().min(0).max(100_000_000).default(0),
  currency: z.string().trim().length(3).toLowerCase().default('usd'),
  trial_days: z.number().int().min(0).max(365).default(0),
  limits: z.object({
    autocomplete: countLimit, ai_edit: countLimit, chat: countLimit, review: countLimit, write: countLimit,
    library_pdfs: z.number().int().min(0).max(10_000_000).nullable(), latex_export: z.boolean(),
  }),
  features: z.array(z.object({ label: z.string().trim().min(1).max(200), included: z.boolean() })).max(30).default([]),
});

/** Admin › Plans: plans, their features and limits, Stripe prices, subscribers, given plans. */
export function adminPlanRoutes() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', requireAdmin);
  const audit = (userId: string, action: string, target: string) => sql`insert into admin_audit (user_id, action, target) values (${userId}, ${action}, ${target})`;

  app.get('/', async (c) => {
    forgetPlans();
    const { plans, features } = await loadPlans();
    const counts = await sql<{ plan: string; subscribers: number }[]>`
      select plan, count(*)::int as subscribers from accounts
      where (plan_source = 'stripe' and plan_status = any(${LIVE_STATUSES})) or plan_source = 'admin' group by plan`;
    return c.json({
      plans: plans.map((plan) => ({
        ...plan, limits: normalizeLimits(plan.limits), features: features.get(plan.id) || [],
        subscribers: counts.find((row) => row.plan === plan.id)?.subscribers ?? 0,
      })),
      limit_defs: LIMIT_DEFS,
      stripe_ready: (() => { try { return Boolean(stripeClient()); } catch { return false; } })(),
    });
  });

  /** Creates or saves a plan (its features replace the old list). */
  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) throw new HTTPException(422, { message: 'Plan id: lowercase letters, digits and dashes (e.g. "plus").' });
    const parsed = PlanInput.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
    const plan = parsed.data;
    if (plan.checkout === 'contact' && !plan.contact_url) throw new HTTPException(422, { message: 'A "Talk to us" plan needs a contact link (mailto: or https://).' });
    await sql.begin(async (tx) => {
      if (plan.is_default) await tx`update plans set is_default = false where id <> ${id}`;
      await tx`
        insert into plans (id, name, tagline, sort_order, is_default, is_public, featured, checkout, contact_url, monthly_cents, yearly_cents, currency, trial_days, limits)
        values (${id}, ${plan.name}, ${plan.tagline}, ${plan.sort_order}, ${plan.is_default}, ${plan.is_public}, ${plan.featured}, ${plan.checkout},
                ${plan.contact_url}, ${plan.monthly_cents}, ${plan.yearly_cents}, ${plan.currency}, ${plan.trial_days}, ${tx.json(plan.limits as any)})
        on conflict (id) do update set name = excluded.name, tagline = excluded.tagline, sort_order = excluded.sort_order,
          is_default = excluded.is_default, is_public = excluded.is_public, featured = excluded.featured, checkout = excluded.checkout,
          contact_url = excluded.contact_url, monthly_cents = excluded.monthly_cents, yearly_cents = excluded.yearly_cents,
          currency = excluded.currency, trial_days = excluded.trial_days, limits = excluded.limits, updated_at = now()`;
      await tx`delete from plan_features where plan_id = ${id}`;
      for (const [index, feature] of plan.features.entries()) {
        await tx`insert into plan_features (plan_id, label, included, sort_order) values (${id}, ${feature.label}, ${feature.included}, ${index})`;
      }
      const [{ defaults }] = await tx<{ defaults: number }[]>`select count(*)::int as defaults from plans where is_default`;
      if (defaults !== 1) throw new HTTPException(422, { message: 'Exactly one plan must be the default (the free plan).' });
    });
    forgetPlans();
    await audit(c.get('user')!.id, 'plan_saved', id);
    // Prices on Stripe follow the saved amounts straight away when payments are set up.
    let stripe_error: string | null = null;
    try {
      const stripe = stripeClient();
      if (stripe) await syncPlanToStripe(stripe, id);
    } catch (error) {
      stripe_error = (error as Error).message;
    }
    return c.json({ ok: true, stripe_error });
  });

  app.post('/:id/stripe', async (c) => {
    let stripe;
    try { stripe = stripeClient(); } catch (error) { throw new HTTPException(422, { message: (error as Error).message }); }
    if (!stripe) throw new HTTPException(422, { message: 'Save a Stripe key on the Billing tab first.' });
    const plan = await syncPlanToStripe(stripe, c.req.param('id')).catch((error) => { throw new HTTPException(422, { message: (error as Error).message }); });
    await audit(c.get('user')!.id, 'plan_stripe_sync', c.req.param('id'));
    return c.json({ ok: true, plan });
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const [plan] = await sql<{ is_default: boolean }[]>`select is_default from plans where id = ${id}`;
    if (!plan) throw new HTTPException(404, { message: 'No such plan.' });
    if (plan.is_default) throw new HTTPException(422, { message: 'Make another plan the default first.' });
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from accounts where plan = ${id} and plan_source <> 'default'`;
    if (count > 0) throw new HTTPException(422, { message: `${count} account(s) are on this plan. Hide it from pricing instead.` });
    await sql`delete from plans where id = ${id}`;
    forgetPlans();
    await audit(c.get('user')!.id, 'plan_deleted', id);
    return c.json({ ok: true });
  });

  return app;
}

/** Admin › Plans › Subscribers, and giving someone a plan without payment. */
export function adminAccountRoutes() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', requireAdmin);

  app.get('/subscribers', async (c) => {
    const rows = await sql`
      select u.email, a.plan, a.plan_status, a.plan_source, a.plan_interval, a.plan_period_end, a.plan_cancel_at_period_end
      from accounts a join lateral (select email from users where account_id = a.id order by created_at limit 1) u on true
      where a.plan_source <> 'default' order by a.plan_event_at desc nulls last limit 200`;
    return c.json({ subscribers: rows });
  });

  /** Videmak Cloud this month: credits sold, credits used (free and paid), keys in use. */
  app.get('/credits', async (c) => {
    const [row] = await sql<{ sold_cents: number; credits_sold: number; free_used: number; paid_used: number; keys: number; accounts: number }[]>`
      select
        (select coalesce(sum(amount_cents), 0)::int from credit_ledger where kind in ('purchase', 'topup') and created_at >= date_trunc('month', now() at time zone 'utc')) as sold_cents,
        (select coalesce(sum(credits_milli), 0)::float / 1000 from credit_ledger where kind in ('purchase', 'topup') and created_at >= date_trunc('month', now() at time zone 'utc')) as credits_sold,
        (select coalesce(sum(free_milli), 0)::float / 1000 from usage_events where api_key_id is not null and created_at >= date_trunc('month', now() at time zone 'utc')) as free_used,
        (select coalesce(sum(paid_milli), 0)::float / 1000 from usage_events where api_key_id is not null and created_at >= date_trunc('month', now() at time zone 'utc')) as paid_used,
        (select count(*)::int from api_keys where revoked_at is null) as keys,
        (select count(distinct account_id)::int from api_keys where revoked_at is null) as accounts`;
    return c.json(row);
  });

  /** Credits given by hand (support, refunds, partners); recorded in the ledger and the audit log. */
  app.post('/credits', async (c) => {
    const body = z.object({ email: z.string().trim().toLowerCase().email(), credits: z.number().int().min(1).max(10_000_000), note: z.string().max(200).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new HTTPException(422, { message: 'An account email and a number of credits.' });
    const [user] = await sql<{ account_id: string }[]>`select account_id from users where lower(email) = ${body.data.email}`;
    if (!user) throw new HTTPException(404, { message: 'No account with that email.' });
    const result = await grantCredits({
      accountId: user.account_id, kind: 'grant', credits: body.data.credits, reference: `grant:${randomUUID()}`,
      note: body.data.note ?? 'Added by an admin', createdBy: c.get('user')!.id,
    });
    await sql`insert into admin_audit (user_id, action, target) values (${c.get('user')!.id}, 'credits_given', ${`${body.data.email}:${body.data.credits}`})`;
    return c.json({ ok: true, balance: result.balance ?? 0 });
  });

  app.put('/plan', async (c) => {
    const body = z.object({ email: z.string().trim().toLowerCase().email(), plan: z.string().max(40).nullable() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new HTTPException(422, { message: 'An email and a plan (or none).' });
    const [user] = await sql<{ account_id: string }[]>`select account_id from users where lower(email) = ${body.data.email}`;
    if (!user) throw new HTTPException(404, { message: 'No account with that email.' });
    if (body.data.plan) {
      const { plans } = await loadPlans();
      if (!plans.some((plan) => plan.id === body.data.plan)) throw new HTTPException(422, { message: 'No such plan.' });
      await sql`update accounts set plan = ${body.data.plan}, plan_source = 'admin', plan_status = 'active', plan_event_at = now() where id = ${user.account_id}`;
    } else {
      // Back to the subscription (if any) or the default plan.
      await sql`update accounts set plan_source = case when plan_subscription_id is not null then 'stripe' else 'default' end,
        plan_status = case when plan_subscription_id is not null then plan_status else 'none' end where id = ${user.account_id}`;
    }
    await sql`insert into admin_audit (user_id, action, target) values (${c.get('user')!.id}, ${body.data.plan ? 'plan_given' : 'plan_given_removed'}, ${`${body.data.email}:${body.data.plan ?? ''}`})`;
    return c.json({ ok: true });
  });

  return app;
}
