import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireUser, type AppVariables } from '../auth.js';
import { stripeClient } from '../lib/stripeBilling.js';
import { loadPlans, publicPlan, usageSummary } from '../lib/plans.js';
import {
  completeCheckout, listCards, listInvoices, payInvoice, removeCard, renewPlan, setCancelAtPeriodEnd,
  setDefaultCard, startAddCard, startPlanPurchase,
} from '../lib/planBilling.js';

/** Public: the plans on the pricing page and in the pricing dialog. */
export function planRoutes() {
  const app = new Hono();
  app.get('/', async (c) => {
    const { plans, features } = await loadPlans();
    return c.json({ plans: plans.filter((plan) => plan.is_public).map((plan) => publicPlan(plan, features.get(plan.id) || [])) });
  });
  return app;
}

function stripeOr503() {
  try {
    const stripe = stripeClient();
    if (stripe) return stripe;
  } catch (error) {
    throw new HTTPException(503, { message: (error as Error).message });
  }
  throw new HTTPException(503, { message: 'Payments are not set up yet.' });
}

/** Turns Stripe and validation errors into a message the account page can show. */
async function friendly<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    const message = (error as Error).message || 'Something went wrong with the payment provider.';
    throw new HTTPException(422, { message });
  }
}

/** The signed-in person's plan, usage, cards and invoices, and the actions on them. */
export function billingRoutes() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', requireUser);
  const accountOf = (c: { get: (key: 'user') => AppVariables['user'] }) => c.get('user')!.account_id;

  app.get('/', async (c) => {
    const accountId = accountOf(c);
    const summary = await usageSummary(accountId);
    const [library] = await sql<{ count: number }[]>`select count(*)::int as count from library_documents where user_id = ${c.get('user')!.id}`;
    const [account] = await sql<{ stripe_customer_id: string | null }[]>`select stripe_customer_id from accounts where id = ${accountId}`;
    let cards: Awaited<ReturnType<typeof listCards>> = [];
    let invoices: Awaited<ReturnType<typeof listInvoices>> = [];
    let payments = true;
    try {
      const stripe = stripeClient();
      if (stripe && account?.stripe_customer_id) {
        [cards, invoices] = await Promise.all([listCards(stripe, account.stripe_customer_id), listInvoices(stripe, account.stripe_customer_id)]);
      }
      payments = Boolean(stripe);
    } catch (error) {
      console.warn('billing summary: Stripe unavailable', (error as Error).message);
      payments = false;
    }
    const { plan, limits, account: state, counts } = summary;
    return c.json({
      plan: { id: plan.id, name: plan.name, is_default: plan.is_default },
      subscription: state ? {
        plan_id: state.plan_id, status: state.plan_status, source: state.plan_source, interval: state.plan_interval,
        period_end: state.plan_period_end, cancel_at_period_end: state.plan_cancel_at_period_end,
      } : null,
      limits,
      usage: counts,
      library: { used: library.count, limit: limits.library_pdfs },
      cards,
      invoices,
      open_invoices: invoices.filter((invoice) => invoice.status === 'open'),
      payments_enabled: payments,
    });
  });

  app.post('/checkout', async (c) => {
    const body = z.object({ plan: z.string().min(1).max(40), interval: z.enum(['month', 'year']) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new HTTPException(422, { message: 'Choose a plan and monthly or yearly.' });
    const stripe = stripeOr503();
    return c.json(await friendly(() => startPlanPurchase(stripe, accountOf(c), body.data.plan, body.data.interval)));
  });

  /** Back from Stripe Checkout (a plan or a card): saves the result straight away. */
  app.post('/checkout/complete', async (c) => {
    const body = z.object({ session: z.string().min(5).max(300) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new HTTPException(422, { message: 'Missing checkout session.' });
    const stripe = stripeOr503();
    return c.json(await friendly(() => completeCheckout(stripe, accountOf(c), body.data.session)));
  });

  app.post('/cards', async (c) => {
    const stripe = stripeOr503();
    return c.json({ url: await friendly(() => startAddCard(stripe, accountOf(c))) });
  });

  app.post('/cards/:id/default', async (c) => {
    const stripe = stripeOr503();
    await friendly(() => setDefaultCard(stripe, accountOf(c), c.req.param('id')));
    return c.json({ ok: true });
  });

  app.delete('/cards/:id', async (c) => {
    const stripe = stripeOr503();
    await friendly(() => removeCard(stripe, accountOf(c), c.req.param('id')));
    return c.json({ ok: true });
  });

  app.post('/cancel', async (c) => {
    const body = z.object({ reason: z.string().max(500).optional() }).safeParse(await c.req.json().catch(() => ({})));
    const stripe = stripeOr503();
    await friendly(() => setCancelAtPeriodEnd(stripe, accountOf(c), true, body.success ? body.data.reason : undefined));
    return c.json({ ok: true });
  });

  app.post('/resume', async (c) => {
    const stripe = stripeOr503();
    await friendly(() => setCancelAtPeriodEnd(stripe, accountOf(c), false));
    return c.json({ ok: true });
  });

  app.post('/renew', async (c) => {
    const stripe = stripeOr503();
    return c.json(await friendly(() => renewPlan(stripe, accountOf(c))));
  });

  app.post('/invoices/:id/pay', async (c) => {
    const body = z.object({ card: z.string().max(100).optional() }).safeParse(await c.req.json().catch(() => ({})));
    const stripe = stripeOr503();
    return c.json(await friendly(() => payInvoice(stripe, accountOf(c), c.req.param('id'), body.success ? body.data.card : undefined)));
  });

  return app;
}
