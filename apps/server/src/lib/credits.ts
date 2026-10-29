import Stripe from 'stripe';
import { HTTPException } from 'hono/http-exception';
import { sql } from '../db.js';
import { settings } from './settings.js';
import { CREDIT_PACKS, SERVICES, costMilli, packById, publicPrices, type ServiceName } from './prices.js';
import { stripeClient } from './stripeBilling.js';
import { ensureCustomer, setDefaultCard } from './planBilling.js';
import { mailReady, sendMail } from './mail.js';
import { lowCreditsEmail, topUpFailedEmail } from './emails.js';

/**
 * Videmak Cloud credits. Each account has a prepaid balance (bought in packs, topped up
 * automatically if the owner wants) and free credits every day for the services Scholar
 * answers. A call is checked before it runs and charged after it succeeds: free credits
 * first, then the balance. Amounts are kept in thousandths of a credit.
 */

const MILLI = 1000;
/** Below this balance (in credits) the owner gets one "running low" email a day. */
const LOW_BALANCE = 100;
export const CONSOLE_PATH = '/developers/keys';

const consoleUrl = (query = '') => `${settings().publicUrl.replace(/\/$/, '')}${CONSOLE_PATH}${query}`;
const credits = (milli: number | string) => Number(milli) / MILLI;
const positiveInt = (value: string, fallback: number) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

export const dailyFreeCredits = () => positiveInt(settings().cloudDailyFreeCredits, 1000);
export const starterCredits = () => positiveInt(settings().cloudStarterCredits, 100);

/** Midnight UTC tonight, when the free credits come back. */
const resetsAt = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
};

/** Free credits need a confirmed email (one allowance per real person). Without email set up, nobody can confirm. */
async function emailConfirmed(accountId: string) {
  if (!mailReady()) return true;
  const [row] = await sql`select 1 from users where account_id = ${accountId} and email_verified_at is not null limit 1`;
  return Boolean(row);
}

export type Wallet = {
  balance: number;
  free_per_day: number;
  free_used: number;
  free_left: number;
  resets_at: string;
  email_confirmed: boolean;
};

export async function wallet(accountId: string): Promise<Wallet> {
  const [row] = await sql<{ credits_milli: string; used_milli: string | null }[]>`
    select a.credits_milli::text, d.used_milli::text from accounts a
    left join credit_daily_free d on d.account_id = a.id and d.day = (now() at time zone 'utc')::date
    where a.id = ${accountId}`;
  const confirmed = await emailConfirmed(accountId);
  const perDay = confirmed ? dailyFreeCredits() : 0;
  const used = credits(row?.used_milli ?? 0);
  return {
    balance: credits(row?.credits_milli ?? 0),
    free_per_day: perDay,
    free_used: used,
    free_left: Math.max(0, perDay - used),
    resets_at: resetsAt(),
    email_confirmed: confirmed,
  };
}

/** 402 with a code the client can act on (buy credits, confirm email, raise a key's cap). */
export class CreditsError extends HTTPException {
  constructor(message: string, readonly code: 'no_credits' | 'confirm_email' | 'key_cap') {
    super(402, { message });
  }
}

/** Throws unless the account can pay for one more call to `service` (and the key is under its cap). */
export async function assertCanSpend(accountId: string, service: ServiceName, key?: { id: string; monthly_credit_cap: number | null }) {
  if (key?.monthly_credit_cap != null) {
    const [spent] = await sql<{ milli: string }[]>`
      select coalesce(sum(free_milli + paid_milli), 0)::text as milli from usage_events
      where api_key_id = ${key.id} and created_at >= date_trunc('month', now() at time zone 'utc')`;
    if (credits(spent.milli) >= key.monthly_credit_cap) {
      throw new CreditsError(`This key reached its monthly cap of ${key.monthly_credit_cap.toLocaleString('en-US')} credits. Raise it at ${consoleUrl()}.`, 'key_cap');
    }
  }
  const current = await wallet(accountId);
  if (current.balance > 0) return current;
  if (SERVICES[service].free) {
    if (current.free_left > 0) return current;
    if (!current.email_confirmed) throw new CreditsError(`Confirm your email to get ${dailyFreeCredits().toLocaleString('en-US')} free credits a day, or buy credits at ${consoleUrl()}.`, 'confirm_email');
    throw new CreditsError(`Today's free credits are used up. They come back at midnight UTC, or buy credits at ${consoleUrl()}.`, 'no_credits');
  }
  throw new CreditsError(`You are out of credits. Buy credits at ${consoleUrl()}.`, 'no_credits');
}

export type Charge = {
  accountId: string;
  apiKeyId?: string | null;
  service: ServiceName;
  quantity: number;
  requestId: string;
  metadata?: Record<string, unknown>;
};

/**
 * Records a successful call and takes its cost: free credits first (for free services), then the
 * balance, which may dip below zero by one call. The request id makes retries free.
 */
export async function charge(event: Charge): Promise<{ free: number; paid: number; balance: number } | null> {
  const cost = costMilli(event.service, event.quantity);
  if (!cost) return null;
  const freeAllowance = SERVICES[event.service].free && (await emailConfirmed(event.accountId)) ? dailyFreeCredits() * MILLI : 0;
  const result = await sql.begin(async (tx) => {
    const [usage] = await tx<{ id: string }[]>`
      insert into usage_events (account_id, api_key_id, service, quantity, request_id, metadata)
      values (${event.accountId}, ${event.apiKeyId ?? null}, ${event.service}, ${event.quantity}, ${event.requestId}, ${sql.json((event.metadata ?? {}) as any)})
      on conflict (request_id, service) do nothing returning id`;
    if (!usage) return null;
    let free = 0;
    if (freeAllowance > 0) {
      await tx`insert into credit_daily_free (account_id, day) values (${event.accountId}, (now() at time zone 'utc')::date) on conflict do nothing`;
      const [day] = await tx<{ used_milli: string }[]>`
        select used_milli::text from credit_daily_free where account_id = ${event.accountId} and day = (now() at time zone 'utc')::date for update`;
      free = Math.min(cost, Math.max(0, freeAllowance - Number(day.used_milli)));
      if (free > 0) await tx`update credit_daily_free set used_milli = used_milli + ${free} where account_id = ${event.accountId} and day = (now() at time zone 'utc')::date`;
    }
    const paid = cost - free;
    const [account] = await tx<{ credits_milli: string }[]>`
      update accounts set credits_milli = credits_milli - ${paid} where id = ${event.accountId} returning credits_milli::text`;
    await tx`update usage_events set free_milli = ${free}, paid_milli = ${paid} where id = ${usage.id}`;
    return { free: credits(free), paid: credits(paid), balance: credits(account.credits_milli) };
  });
  if (result && result.paid > 0) void afterSpend(event.accountId, result.balance).catch((error) => console.error('after-spend check failed', error));
  return result;
}

/** Adds credits once per reference (a Stripe session or payment, the starter grant, an admin grant). */
export async function grantCredits(input: {
  accountId: string; kind: 'purchase' | 'topup' | 'starter' | 'grant' | 'refund'; credits: number;
  amountCents?: number | null; reference: string; note?: string | null; createdBy?: string | null;
}) {
  return sql.begin(async (tx) => {
    const [entry] = await tx`
      insert into credit_ledger (account_id, kind, credits_milli, amount_cents, reference, note, created_by)
      values (${input.accountId}, ${input.kind}, ${Math.round(input.credits * MILLI)}, ${input.amountCents ?? null}, ${input.reference}, ${input.note ?? null}, ${input.createdBy ?? null})
      on conflict (reference) do nothing returning id`;
    if (!entry) return { granted: false };
    const [account] = await tx<{ credits_milli: string }[]>`
      update accounts set credits_milli = credits_milli + ${Math.round(input.credits * MILLI)},
        low_balance_noticed_at = null, topup_error = case when ${input.kind} in ('purchase', 'topup') then null else topup_error end
      where id = ${input.accountId} returning credits_milli::text`;
    return { granted: true, balance: credits(account.credits_milli) };
  });
}

/** The one-time starter credits, once the account has a confirmed email. */
export async function grantStarter(accountId: string) {
  const amount = starterCredits();
  if (!amount || !(await emailConfirmed(accountId))) return;
  const [claimed] = await sql`update accounts set starter_granted_at = now() where id = ${accountId} and starter_granted_at is null returning id`;
  if (claimed) await grantCredits({ accountId, kind: 'starter', credits: amount, reference: `starter:${accountId}`, note: 'Starter credits' });
}

// ------------------------------------------------------------------ buying credits

export async function startCreditCheckout(stripe: Stripe, accountId: string, packId: string) {
  const pack = packById(packId);
  if (!pack) throw new HTTPException(422, { message: 'Choose a credit pack.' });
  const customer = await ensureCustomer(stripe, accountId);
  const metadata = { videmak_kind: 'credits', videmak_account_id: accountId, pack: pack.id };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer,
    allowed_payment_method_types: ['card'],
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: pack.cents, product_data: { name: `${pack.credits.toLocaleString('en-US')} Videmak credits` } } }],
    // The card is kept for automatic top-ups (only if the owner turns them on).
    payment_intent_data: { setup_future_usage: 'off_session', metadata },
    metadata,
    client_reference_id: accountId,
    success_url: consoleUrl('?credits=paid&session={CHECKOUT_SESSION_ID}'),
    cancel_url: consoleUrl('?credits=cancelled'),
  });
  return { url: session.url! };
}

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === 'string' ? value : value?.id ?? null);

/** Credits for a paid Checkout session (from the webhook or the return page; whichever comes first). */
export async function grantForSession(session: Stripe.Checkout.Session) {
  if (session.metadata?.videmak_kind !== 'credits' || session.payment_status !== 'paid') return { granted: false };
  const accountId = session.metadata.videmak_account_id;
  const pack = packById(session.metadata.pack ?? '');
  if (!accountId || !pack) return { granted: false };
  return grantCredits({ accountId, kind: 'purchase', credits: pack.credits, amountCents: session.amount_total, reference: `checkout:${session.id}`, note: `${pack.credits.toLocaleString('en-US')} credits` });
}

/** Back from Checkout: credit the account at once and keep the card for top-ups. */
export async function completeCreditCheckout(stripe: Stripe, accountId: string, sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
  const [account] = await sql<{ stripe_customer_id: string | null }[]>`select stripe_customer_id from accounts where id = ${accountId}`;
  if (!account?.stripe_customer_id || idOf(session.customer as any) !== account.stripe_customer_id || session.metadata?.videmak_account_id !== accountId) {
    throw new HTTPException(403, { message: 'This payment belongs to another account.' });
  }
  if (session.payment_status !== 'paid') return { paid: false, ...(await wallet(accountId)) };
  await grantForSession(session);
  const intent = session.payment_intent && typeof session.payment_intent === 'object' ? (session.payment_intent as Stripe.PaymentIntent) : null;
  const card = idOf(intent?.payment_method as any);
  if (card) await setDefaultCard(stripe, accountId, card, { onlyIfNone: true }).catch((error) => console.warn('keeping card failed', (error as Error).message));
  return { paid: true, ...(await wallet(accountId)) };
}

// ------------------------------------------------------------------ automatic top-up and low balance

const toppingUp = new Set<string>();

type TopUpAccount = {
  topup_enabled: boolean; topup_threshold: number; topup_pack: string; topup_monthly_limit_cents: number;
  credits_milli: string; stripe_customer_id: string | null; low_balance_noticed_at: Date | null;
};

async function ownerEmail(accountId: string) {
  const [owner] = await sql<{ email: string }[]>`select email from users where account_id = ${accountId} order by created_at limit 1`;
  return owner?.email ?? null;
}

async function afterSpend(accountId: string, balance: number) {
  const [account] = await sql<TopUpAccount[]>`
    select topup_enabled, topup_threshold, topup_pack, topup_monthly_limit_cents, credits_milli::text, stripe_customer_id, low_balance_noticed_at
    from accounts where id = ${accountId}`;
  if (!account) return;
  if (account.topup_enabled && balance < account.topup_threshold) {
    await topUp(accountId);
    return;
  }
  const recentlyTold = account.low_balance_noticed_at && Date.now() - account.low_balance_noticed_at.getTime() < 24 * 3600_000;
  if (balance < LOW_BALANCE && !recentlyTold && mailReady()) {
    const email = await ownerEmail(accountId);
    if (!email) return;
    await sql`update accounts set low_balance_noticed_at = now() where id = ${accountId}`;
    await sendMail(lowCreditsEmail(email, balance, consoleUrl())).catch((error) => console.error('low-credits email failed', (error as Error).message));
  }
}

async function stopTopUp(accountId: string, reason: string) {
  await sql`update accounts set topup_enabled = false, topup_error = ${reason} where id = ${accountId}`;
  const email = mailReady() ? await ownerEmail(accountId) : null;
  if (email) await sendMail(topUpFailedEmail(email, reason, consoleUrl())).catch((error) => console.error('top-up email failed', (error as Error).message));
}

/** Charges the saved card for the chosen pack when the balance is under the threshold (within the monthly limit). */
export async function topUp(accountId: string) {
  if (toppingUp.has(accountId)) return { started: false };
  toppingUp.add(accountId);
  try {
    const [account] = await sql<TopUpAccount[]>`
      select topup_enabled, topup_threshold, topup_pack, topup_monthly_limit_cents, credits_milli::text, stripe_customer_id, low_balance_noticed_at
      from accounts where id = ${accountId}`;
    if (!account?.topup_enabled || credits(account.credits_milli) >= account.topup_threshold) return { started: false };
    const pack = packById(account.topup_pack) ?? CREDIT_PACKS[0];
    const [month] = await sql<{ cents: number }[]>`
      select coalesce(sum(amount_cents), 0)::int as cents from credit_ledger
      where account_id = ${accountId} and kind = 'topup' and created_at >= date_trunc('month', now() at time zone 'utc')`;
    if (month.cents + pack.cents > account.topup_monthly_limit_cents) {
      await stopTopUp(accountId, `this month's top-up limit of $${(account.topup_monthly_limit_cents / 100).toFixed(2)} is reached.`);
      return { started: false };
    }
    const stripe = stripeClient();
    if (!stripe || !account.stripe_customer_id) {
      await stopTopUp(accountId, 'there is no saved card.');
      return { started: false };
    }
    const customer = await stripe.customers.retrieve(account.stripe_customer_id);
    const card = 'deleted' in customer ? null : idOf(customer.invoice_settings?.default_payment_method as any);
    if (!card) {
      await stopTopUp(accountId, 'there is no saved card.');
      return { started: false };
    }
    try {
      const intent = await stripe.paymentIntents.create({
        amount: pack.cents, currency: 'usd', customer: account.stripe_customer_id, payment_method: card,
        off_session: true, confirm: true, description: `${pack.credits.toLocaleString('en-US')} Videmak credits (automatic top-up)`,
        metadata: { videmak_kind: 'credits_topup', videmak_account_id: accountId, pack: pack.id },
      }, { idempotencyKey: `topup:${accountId}:${month.cents}:${Math.floor(Date.now() / 600_000)}` });
      if (intent.status === 'succeeded') {
        await grantCredits({ accountId, kind: 'topup', credits: pack.credits, amountCents: intent.amount, reference: `payment:${intent.id}`, note: 'Automatic top-up' });
        return { started: true, paid: true };
      }
      await stopTopUp(accountId, 'your bank asked for a confirmation we cannot do automatically. Buy credits once by hand.');
      return { started: true, paid: false };
    } catch (error) {
      await stopTopUp(accountId, (error as Error).message || 'the card was declined.');
      return { started: true, paid: false };
    }
  } finally {
    toppingUp.delete(accountId);
  }
}

/** Credits for a top-up payment the webhook reports (if the direct grant above was missed). */
export async function grantForPayment(intent: Stripe.PaymentIntent) {
  if (intent.metadata?.videmak_kind !== 'credits_topup' || intent.status !== 'succeeded') return { granted: false };
  const pack = packById(intent.metadata.pack ?? '');
  const accountId = intent.metadata.videmak_account_id;
  if (!pack || !accountId) return { granted: false };
  return grantCredits({ accountId, kind: 'topup', credits: pack.credits, amountCents: intent.amount, reference: `payment:${intent.id}`, note: 'Automatic top-up' });
}

// ------------------------------------------------------------------ the console

const SERVICE_ORDER = Object.keys(SERVICES);

/** Everything the keys-and-credits page shows. */
export async function creditOverview(accountId: string) {
  await grantStarter(accountId).catch((error) => console.error('starter credits failed', error));
  const [current, keys, usage, ledger, [account]] = await Promise.all([
    wallet(accountId),
    sql`select id, name, prefix, mode, monthly_credit_cap, created_at, last_used_at, revoked_at,
          (select coalesce(sum(free_milli + paid_milli), 0)::float / 1000 from usage_events e
           where e.api_key_id = k.id and e.created_at >= date_trunc('month', now() at time zone 'utc')) as credits_this_month
        from api_keys k where account_id = ${accountId} order by revoked_at nulls first, created_at desc`,
    sql<{ service: string; quantity: number; calls: number; free: number; paid: number }[]>`
      select service, sum(quantity)::float as quantity, count(*)::int as calls,
             sum(free_milli)::float / 1000 as free, sum(paid_milli)::float / 1000 as paid
      from usage_events where account_id = ${accountId} and api_key_id is not null
        and created_at >= date_trunc('month', now() at time zone 'utc')
      group by service order by service`,
    sql`select kind, credits_milli::float / 1000 as credits, amount_cents, note, created_at from credit_ledger
        where account_id = ${accountId} order by created_at desc limit 12`,
    sql<{ topup_enabled: boolean; topup_threshold: number; topup_pack: string; topup_monthly_limit_cents: number; topup_error: string | null; stripe_customer_id: string | null }[]>`
      select topup_enabled, topup_threshold, topup_pack, topup_monthly_limit_cents, topup_error, stripe_customer_id from accounts where id = ${accountId}`,
  ]);
  let payments = false;
  try { payments = Boolean(stripeClient()); } catch { payments = false; }
  return {
    wallet: current,
    starter_credits: starterCredits(),
    keys,
    usage: usage
      .map((line) => ({ ...line, label: SERVICES[line.service as ServiceName]?.label ?? line.service, credits: Math.round((line.free + line.paid) * 1000) / 1000 }))
      .sort((a, b) => SERVICE_ORDER.indexOf(a.service) - SERVICE_ORDER.indexOf(b.service)),
    ledger,
    topup: account ? {
      enabled: account.topup_enabled, threshold: account.topup_threshold, pack: account.topup_pack,
      monthly_limit_usd: account.topup_monthly_limit_cents / 100, error: account.topup_error,
    } : null,
    payments_enabled: payments,
    ...publicPrices(),
  };
}
