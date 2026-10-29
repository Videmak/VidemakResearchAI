import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { sql } from '../db.js';

/**
 * Plans and what each one allows. Plans live in the database (Admin › Plans); the limit KEYS
 * live here because the server enforces them. A count limit is { amount, per }, amount null
 * meaning unlimited; a total is a number or null; a feature is true/false.
 */
export const LIMIT_DEFS = {
  autocomplete: { kind: 'count', label: 'AI autocompletes', noun: 'AI autocompletes' },
  ai_edit: { kind: 'count', label: 'AI edits', noun: 'AI edits' },
  chat: { kind: 'count', label: 'AI chat messages', noun: 'AI chat messages' },
  review: { kind: 'count', label: 'Review checks', noun: 'review checks' },
  write: { kind: 'count', label: 'Write with AI drafts', noun: 'Write with AI drafts' },
  library_pdfs: { kind: 'total', label: 'PDFs in Library', noun: 'PDFs in your Library' },
  latex_export: { kind: 'feature', label: 'LaTeX export', noun: 'LaTeX export' },
} as const;

export type LimitKey = keyof typeof LIMIT_DEFS;
export type CountLimit = { amount: number | null; per: 'day' | 'month' };
export type Limits = {
  autocomplete: CountLimit;
  ai_edit: CountLimit;
  chat: CountLimit;
  review: CountLimit;
  write: CountLimit;
  library_pdfs: number | null;
  latex_export: boolean;
};

export type PlanRow = {
  id: string; name: string; tagline: string; sort_order: number; is_default: boolean; is_public: boolean; featured: boolean;
  checkout: 'self_serve' | 'contact'; contact_url: string | null; monthly_cents: number; yearly_cents: number; currency: string;
  trial_days: number; limits: Partial<Limits>; stripe_product_id: string | null; stripe_monthly_price_id: string | null;
  stripe_yearly_price_id: string | null; stripe_mode: string | null;
};
export type PlanFeature = { label: string; included: boolean };

const UNLIMITED: CountLimit = { amount: null, per: 'month' };
const UNLIMITED_LIMITS: Limits = {
  autocomplete: UNLIMITED, ai_edit: UNLIMITED, chat: UNLIMITED, review: UNLIMITED, write: UNLIMITED, library_pdfs: null, latex_export: true,
};

/** Fills a stored limits object with unlimited defaults for any missing key. */
export function normalizeLimits(raw: unknown): Limits {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const count = (key: keyof Limits): CountLimit => {
    const item = value[key];
    if (!item || typeof item !== 'object') return UNLIMITED;
    const amount = item.amount === null || item.amount === undefined || item.amount === '' ? null : Math.max(0, Math.floor(Number(item.amount)));
    return { amount: Number.isFinite(amount as number) || amount === null ? amount : null, per: item.per === 'day' ? 'day' : 'month' };
  };
  const pdfs = value.library_pdfs;
  return {
    autocomplete: count('autocomplete'),
    ai_edit: count('ai_edit'),
    chat: count('chat'),
    review: count('review'),
    write: count('write'),
    library_pdfs: pdfs === null || pdfs === undefined || pdfs === '' ? null : Math.max(0, Math.floor(Number(pdfs))),
    latex_export: value.latex_export === undefined ? true : Boolean(value.latex_export),
  };
}

/** The plans Videmak starts with: Free, Plus, Pro and Team. Prices in cents. */
export const DEFAULT_PLANS: (Omit<PlanRow, 'stripe_product_id' | 'stripe_monthly_price_id' | 'stripe_yearly_price_id' | 'stripe_mode' | 'limits'> & { limits: Limits; features: PlanFeature[] })[] = [
  {
    id: 'free', name: 'Free', tagline: 'Try everything, with daily limits', sort_order: 0, is_default: true, is_public: true, featured: false,
    checkout: 'self_serve', contact_url: null, monthly_cents: 0, yearly_cents: 0, currency: 'usd', trial_days: 0,
    limits: {
      autocomplete: { amount: 10, per: 'day' }, ai_edit: { amount: 3, per: 'day' }, chat: { amount: 5, per: 'day' },
      review: { amount: 3, per: 'day' }, write: { amount: 1, per: 'day' }, library_pdfs: 10, latex_export: false,
    },
    features: [
      { label: 'The full editor, on any device', included: true },
      { label: '10 AI autocompletes a day', included: true },
      { label: '5 AI chat messages and 3 AI edits a day', included: true },
      { label: '3 review checks and 1 Write with AI draft a day', included: true },
      { label: 'Unlimited citations in every style', included: true },
      { label: '10 PDFs in your Library', included: true },
      { label: 'Word and PDF export', included: true },
      { label: 'LaTeX export', included: false },
    ],
  },
  {
    id: 'plus', name: 'Plus', tagline: 'For students writing every week', sort_order: 1, is_default: false, is_public: true, featured: false,
    checkout: 'self_serve', contact_url: null, monthly_cents: 1200, yearly_cents: 9600, currency: 'usd', trial_days: 0,
    limits: {
      autocomplete: { amount: 5000, per: 'month' }, ai_edit: { amount: 500, per: 'month' }, chat: { amount: 500, per: 'month' },
      review: { amount: 30, per: 'month' }, write: { amount: 20, per: 'month' }, library_pdfs: null, latex_export: true,
    },
    features: [
      { label: 'Everything in Free', included: true },
      { label: '5,000 AI autocompletes a month', included: true },
      { label: '500 AI edits and 500 chat messages a month', included: true },
      { label: '30 review checks a month', included: true },
      { label: '20 Write with AI drafts a month', included: true },
      { label: 'Unlimited PDFs in your Library', included: true },
      { label: 'Word, PDF and LaTeX export', included: true },
    ],
  },
  {
    id: 'pro', name: 'Pro', tagline: 'Unlimited, for theses and papers', sort_order: 2, is_default: false, is_public: true, featured: true,
    checkout: 'self_serve', contact_url: null, monthly_cents: 2900, yearly_cents: 22800, currency: 'usd', trial_days: 0,
    limits: UNLIMITED_LIMITS,
    features: [
      { label: 'Everything in Plus, without limits', included: true },
      { label: 'Unlimited AI autocomplete, edits and chat', included: true },
      { label: 'Unlimited review checks and peer review', included: true },
      { label: 'Unlimited Write with AI drafts', included: true },
      { label: 'Unlimited PDFs in your Library', included: true },
      { label: 'Word, PDF and LaTeX export', included: true },
      { label: 'Priority support', included: true },
    ],
  },
  {
    id: 'team', name: 'Team', tagline: 'For labs, departments and writing groups', sort_order: 3, is_default: false, is_public: true, featured: false,
    checkout: 'contact', contact_url: 'mailto:hello@videmak.net?subject=Videmak%20Team', monthly_cents: 0, yearly_cents: 0, currency: 'usd', trial_days: 0,
    limits: UNLIMITED_LIMITS,
    features: [
      { label: 'Everything in Pro for each member', included: true },
      { label: 'One invoice for the whole group', included: true },
      { label: 'Volume pricing', included: true },
      { label: 'Onboarding and priority support', included: true },
    ],
  },
];

/** Creates the default plans the first time (an empty plans table). */
export async function seedPlans() {
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from plans`;
  if (count > 0) return false;
  await sql.begin(async (tx) => {
    for (const plan of DEFAULT_PLANS) {
      await tx`
        insert into plans (id, name, tagline, sort_order, is_default, is_public, featured, checkout, contact_url, monthly_cents, yearly_cents, currency, trial_days, limits)
        values (${plan.id}, ${plan.name}, ${plan.tagline}, ${plan.sort_order}, ${plan.is_default}, ${plan.is_public}, ${plan.featured}, ${plan.checkout},
                ${plan.contact_url}, ${plan.monthly_cents}, ${plan.yearly_cents}, ${plan.currency}, ${plan.trial_days}, ${tx.json(plan.limits as any)})`;
      for (const [index, feature] of plan.features.entries()) {
        await tx`insert into plan_features (plan_id, label, included, sort_order) values (${plan.id}, ${feature.label}, ${feature.included}, ${index})`;
      }
    }
  });
  return true;
}

// Plans change rarely: a short cache keeps every AI request from reading them.
let cache: { at: number; plans: PlanRow[]; features: Map<string, PlanFeature[]> } | null = null;
export function forgetPlans() {
  cache = null;
}

export async function loadPlans() {
  if (cache && Date.now() - cache.at < 30_000) return cache;
  const plans = await sql<PlanRow[]>`select * from plans order by sort_order, id`;
  const rows = await sql<{ plan_id: string; label: string; included: boolean }[]>`select plan_id, label, included from plan_features order by plan_id, sort_order, id`;
  const features = new Map<string, PlanFeature[]>();
  for (const row of rows) features.set(row.plan_id, [...(features.get(row.plan_id) || []), { label: row.label, included: row.included }]);
  cache = { at: Date.now(), plans, features };
  return cache;
}

export type AccountPlan = {
  plan_id: string | null; plan_status: string; plan_source: string; plan_interval: string | null; plan_period_end: Date | null;
  plan_cancel_at_period_end: boolean; plan_subscription_id: string | null;
};

/** Subscriptions in these states keep their plan (past_due: Stripe is still retrying the card). */
export const LIVE_STATUSES = ['active', 'trialing', 'past_due'];

/** The plan an account has right now: a live subscription, a plan an admin gave, or the default. */
export async function effectivePlan(accountId: string): Promise<{ plan: PlanRow; limits: Limits; account: AccountPlan }> {
  const { plans } = await loadPlans();
  const [account] = await sql<AccountPlan[]>`
    select plan as plan_id, plan_status, plan_source, plan_interval, plan_period_end, plan_cancel_at_period_end, plan_subscription_id
    from accounts where id = ${accountId}`;
  const fallback = plans.find((plan) => plan.is_default) ?? plans[0];
  const chosen = account && (account.plan_source === 'admin' || (account.plan_source === 'stripe' && LIVE_STATUSES.includes(account.plan_status)))
    ? plans.find((plan) => plan.id === account.plan_id)
    : undefined;
  const plan = chosen ?? fallback;
  // No plans at all (a fresh install before seeding): nothing is limited.
  return { plan, limits: plan ? normalizeLimits(plan.limits) : UNLIMITED_LIMITS, account };
}

const periodOf = (per: 'day' | 'month', now = new Date()) => (per === 'day' ? now.toISOString().slice(0, 10) : now.toISOString().slice(0, 7));

export class PlanLimitError extends HTTPException {
  constructor(message: string, readonly key: LimitKey, readonly plan: string) {
    super(402, { message });
  }
}

function limitMessage(key: LimitKey, plan: PlanRow, limit: CountLimit | number) {
  const noun = LIMIT_DEFS[key].noun;
  if (typeof limit === 'number') return `Your ${plan.name} plan includes ${limit.toLocaleString('en-US')} ${noun}. Upgrade for more.`;
  if (limit.amount === 0) return `${LIMIT_DEFS[key].label} are not part of the ${plan.name} plan. Upgrade to use them.`;
  const when = limit.per === 'day' ? "today's" : "this month's";
  return `You have used ${when} ${limit.amount?.toLocaleString('en-US')} ${noun} on the ${plan.name} plan. Upgrade for more.`;
}

/** Refuses (402) when a counted action is used up; returns what is left (null: unlimited). */
export async function checkQuota(accountId: string, key: Exclude<LimitKey, 'library_pdfs' | 'latex_export'>): Promise<number | null> {
  const { plan, limits } = await effectivePlan(accountId);
  const limit = limits[key];
  if (limit.amount === null) return null;
  const [row] = await sql<{ amount: number }[]>`select amount from plan_usage where account_id = ${accountId} and key = ${key} and period = ${periodOf(limit.per)}`;
  const used = row?.amount ?? 0;
  if (used >= limit.amount) throw new PlanLimitError(limitMessage(key, plan, limit), key, plan.id);
  return limit.amount - used;
}

/** Counts a use (after it succeeded). Counted for both periods so a plan change keeps history. */
export async function countUse(accountId: string, key: LimitKey, amount = 1) {
  const now = new Date();
  for (const period of [periodOf('day', now), periodOf('month', now)]) {
    await sql`
      insert into plan_usage (account_id, key, period, amount) values (${accountId}, ${key}, ${period}, ${amount})
      on conflict (account_id, key, period) do update set amount = plan_usage.amount + excluded.amount`;
  }
}

/** Refuses (402) a feature the plan does not include. */
export async function requireFeature(accountId: string, key: 'latex_export') {
  const { plan, limits } = await effectivePlan(accountId);
  if (!limits[key]) throw new PlanLimitError(`${LIMIT_DEFS[key].label} is part of the paid plans. Upgrade to use it.`, key, plan.id);
}

/** Refuses (402) one more Library PDF when the plan's total is reached. */
export async function checkLibraryRoom(accountId: string, userId: string, adding = 1) {
  const { plan, limits } = await effectivePlan(accountId);
  if (limits.library_pdfs === null) return;
  // PDFs only: saved references without a file stay unlimited.
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from library_documents where user_id = ${userId} and file_type = 'pdf'`;
  if (count + adding > limits.library_pdfs) throw new PlanLimitError(limitMessage('library_pdfs', plan, limits.library_pdfs), 'library_pdfs', plan.id);
}

/** This period's use of each counted limit, for the account page and the pricing dialog. */
export async function usageSummary(accountId: string) {
  const { plan, limits, account } = await effectivePlan(accountId);
  const now = new Date();
  const rows = await sql<{ key: string; period: string; amount: number }[]>`
    select key, period, amount from plan_usage where account_id = ${accountId} and period in (${periodOf('day', now)}, ${periodOf('month', now)})`;
  const used = (key: string, per: 'day' | 'month') => rows.find((row) => row.key === key && row.period === periodOf(per, now))?.amount ?? 0;
  const counts = (['autocomplete', 'ai_edit', 'chat', 'review', 'write'] as const).map((key) => ({
    key, label: LIMIT_DEFS[key].label, used: used(key, limits[key].per), limit: limits[key].amount, per: limits[key].per,
  }));
  return { plan, limits, account, counts };
}

/** A plan as the pricing dialog and page show it. */
export function publicPlan(plan: PlanRow, features: PlanFeature[]) {
  return {
    id: plan.id, name: plan.name, tagline: plan.tagline, featured: plan.featured, is_default: plan.is_default, checkout: plan.checkout,
    contact_url: plan.contact_url, monthly_cents: plan.monthly_cents, yearly_cents: plan.yearly_cents, currency: plan.currency,
    trial_days: plan.trial_days, limits: normalizeLimits(plan.limits), features,
    purchasable: plan.checkout === 'self_serve' && !plan.is_default && Boolean(plan.stripe_monthly_price_id || plan.stripe_yearly_price_id),
    has_monthly: Boolean(plan.stripe_monthly_price_id) || plan.is_default, has_yearly: Boolean(plan.stripe_yearly_price_id) || plan.is_default,
  };
}

type CountKey = Exclude<LimitKey, 'library_pdfs' | 'latex_export'>;

/**
 * Route guard for a counted action: refuses (402) when the plan's allowance is used up, and
 * counts the use only when the answer was a success (`counted` can look at the JSON, e.g. an
 * empty suggestion is not counted). `applies` limits it to some requests (Write with AI counts
 * a draft once, at its first step).
 */
export function planQuota(
  key: CountKey,
  options: { applies?: (c: Context) => Promise<boolean> | boolean; counted?: (body: any) => boolean } = {},
) {
  return createMiddleware(async (c, next) => {
    const user = c.get('user') as { account_id: string } | undefined;
    if (!user) return next();
    const applies = options.applies ? await options.applies(c) : true;
    if (!applies) return next();
    await checkQuota(user.account_id, key);
    await next();
    if (c.res.status >= 400) return;
    if (options.counted && (c.res.headers.get('content-type') || '').includes('application/json')) {
      const body = await c.res.clone().json().catch(() => null);
      if (!options.counted(body)) return;
    }
    await countUse(user.account_id, key).catch((error) => console.error('plan usage not counted', error));
  });
}
