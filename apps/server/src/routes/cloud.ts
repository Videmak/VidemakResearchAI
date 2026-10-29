import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireUser, type AppVariables } from '../auth.js';
import { createApiKey, forgetApiKeys } from '../lib/apiKeys.js';
import { CREDIT_PACKS, publicPrices } from '../lib/prices.js';
import { billingMode, stripeClient } from '../lib/stripeBilling.js';
import { completeCreditCheckout, creditOverview, dailyFreeCredits, grantStarter, startCreditCheckout, starterCredits, topUp, wallet } from '../lib/credits.js';

/**
 * Videmak Cloud account pages: API keys, credits (balance, free credits today, packs, automatic
 * top-up) and usage per service this month.
 */
function stripeOr503() {
  try {
    const stripe = stripeClient();
    if (stripe) return stripe;
  } catch (error) {
    throw new HTTPException(503, { message: (error as Error).message });
  }
  throw new HTTPException(503, { message: 'Payments are not set up yet.' });
}

/** Public: prices and packs for the developer page. */
export function cloudPriceRoutes() {
  const app = new Hono();
  app.get('/', (c) => c.json({ ...publicPrices(), free_per_day: dailyFreeCredits(), starter_credits: starterCredits() }));
  return app;
}

export function cloudRoutes() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', requireUser);
  const accountOf = (c: { get: (key: 'user') => AppVariables['user'] }) => c.get('user')!.account_id;

  app.get('/', async (c) => c.json(await creditOverview(accountOf(c))));

  app.get('/keys', async (c) => {
    const rows = await sql`
      select id, name, prefix, mode, monthly_credit_cap, created_at, last_used_at, revoked_at
      from api_keys where account_id = ${accountOf(c)} order by created_at desc`;
    return c.json({ keys: rows });
  });

  app.post('/keys', async (c) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(80).default('Default key') }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Give the key a name.' });
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from api_keys where account_id = ${accountOf(c)} and revoked_at is null`;
    if (count >= 20) throw new HTTPException(422, { message: 'An account can have up to 20 keys. Revoke one first.' });
    const { key, row } = await createApiKey(accountOf(c), parsed.data.name, billingMode());
    await grantStarter(accountOf(c)).catch((error) => console.error('starter credits failed', error));
    return c.json({ key, id: row.id, name: row.name, prefix: row.prefix, mode: row.mode, notice: 'Copy this key now. It will not be shown again.' }, 201);
  });

  app.patch('/keys/:id', async (c) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(80).optional(), monthly_credit_cap: z.number().int().min(1).max(100_000_000).nullable().optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Give a name, or a monthly cap of at least 1 credit.' });
    const [row] = await sql`
      update api_keys set name = coalesce(${parsed.data.name ?? null}, name),
        monthly_credit_cap = case when ${parsed.data.monthly_credit_cap !== undefined} then ${parsed.data.monthly_credit_cap ?? null}::int else monthly_credit_cap end
      where id = ${c.req.param('id')} and account_id = ${accountOf(c)} and revoked_at is null returning id, name, monthly_credit_cap`;
    if (!row) throw new HTTPException(404, { message: 'Key not found' });
    forgetApiKeys();
    return c.json(row);
  });

  app.delete('/keys/:id', async (c) => {
    const [row] = await sql`update api_keys set revoked_at = now() where id = ${c.req.param('id')} and account_id = ${accountOf(c)} and revoked_at is null returning id`;
    if (!row) throw new HTTPException(404, { message: 'Key not found' });
    forgetApiKeys();
    return c.json({ revoked: true });
  });

  app.get('/credits', async (c) => c.json(await wallet(accountOf(c))));

  app.post('/credits/checkout', async (c) => {
    const parsed = z.object({ pack: z.enum(CREDIT_PACKS.map((pack) => pack.id) as [string, ...string[]]) }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Choose a credit pack.' });
    const stripe = stripeOr503();
    try {
      return c.json(await startCreditCheckout(stripe, accountOf(c), parsed.data.pack));
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      throw new HTTPException(422, { message: (error as Error).message || 'The payment page could not open.' });
    }
  });

  /** Back from Checkout: the credits are added straight away (the webhook does the same, once). */
  app.post('/credits/complete', async (c) => {
    const parsed = z.object({ session: z.string().min(5).max(300) }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Missing checkout session.' });
    return c.json(await completeCreditCheckout(stripeOr503(), accountOf(c), parsed.data.session));
  });

  app.put('/topup', async (c) => {
    const parsed = z.object({
      enabled: z.boolean(),
      threshold: z.number().int().min(10).max(1_000_000),
      pack: z.enum(CREDIT_PACKS.map((pack) => pack.id) as [string, ...string[]]),
      monthly_limit_usd: z.number().min(10).max(100_000),
    }).safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HTTPException(422, { message: 'Set a threshold, a pack and a monthly limit of at least $10.' });
    const pack = CREDIT_PACKS.find((item) => item.id === parsed.data.pack)!;
    if (parsed.data.enabled && pack.cents > parsed.data.monthly_limit_usd * 100) throw new HTTPException(422, { message: 'The monthly limit must cover at least one pack.' });
    if (parsed.data.enabled) {
      const [account] = await sql<{ stripe_customer_id: string | null }[]>`select stripe_customer_id from accounts where id = ${accountOf(c)}`;
      if (!account?.stripe_customer_id) throw new HTTPException(422, { message: 'Buy credits once first: that card is used for top-ups.' });
    }
    await sql`
      update accounts set topup_enabled = ${parsed.data.enabled}, topup_threshold = ${parsed.data.threshold}, topup_pack = ${parsed.data.pack},
        topup_monthly_limit_cents = ${Math.round(parsed.data.monthly_limit_usd * 100)}, topup_error = null
      where id = ${accountOf(c)}`;
    // Already under the threshold: top up now rather than on the next call.
    if (parsed.data.enabled) void topUp(accountOf(c)).catch((error) => console.error('top-up failed', error));
    return c.json({ ok: true });
  });

  return app;
}
