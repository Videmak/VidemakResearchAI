import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-secret-for-plan-limits-0123456789abcd';
  // A fake postgres.js holding just what plan checks read: plans, one account, usage, Library size.
  const state = {
    plans: [] as Record<string, unknown>[],
    account: { plan_id: 'free', plan_status: 'none', plan_source: 'default', plan_interval: null, plan_period_end: null, plan_cancel_at_period_end: false, plan_subscription_id: null } as Record<string, unknown>,
    usage: new Map<string, number>(),
    libraryPdfs: 0,
  };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('from plans')) return Promise.resolve(state.plans);
    if (text.includes('from plan_features')) return Promise.resolve([]);
    if (text.includes('from accounts')) return Promise.resolve([state.account]);
    if (text.includes('select amount from plan_usage')) {
      const amount = state.usage.get(`${values[1]}|${values[2]}`);
      return Promise.resolve(amount === undefined ? [] : [{ amount }]);
    }
    if (text.includes('insert into plan_usage')) {
      const key = `${values[1]}|${values[2]}`;
      state.usage.set(key, (state.usage.get(key) ?? 0) + Number(values[3]));
      return Promise.resolve([]);
    }
    if (text.includes('from library_documents')) return Promise.resolve([{ count: state.libraryPdfs }]);
    return Promise.resolve([]);
  };
  return { state, sql: Object.assign(sql, { begin: (run: (t: typeof sql) => unknown) => run(sql), json: (value: unknown) => value }) };
});

vi.mock('../src/db.js', () => ({ sql: db.sql }));

import { Hono } from 'hono';
import {
  DEFAULT_PLANS, PlanLimitError, checkLibraryRoom, checkQuota, countUse, effectivePlan, forgetPlans, planQuota, requireFeature,
} from '../src/lib/plans.js';

const ACCOUNT = 'acc-1';

beforeEach(() => {
  db.state.plans = DEFAULT_PLANS.map(({ features: _features, ...plan }) => ({ ...plan, stripe_product_id: null, stripe_monthly_price_id: null, stripe_yearly_price_id: null, stripe_mode: null }));
  db.state.account = { plan_id: 'free', plan_status: 'none', plan_source: 'default', plan_interval: null, plan_period_end: null, plan_cancel_at_period_end: false, plan_subscription_id: null };
  db.state.usage.clear();
  db.state.libraryPdfs = 0;
  forgetPlans();
});

describe('which plan an account has', () => {
  it('is the default plan without a subscription, the subscribed plan while it is live, and the default again once it ends', async () => {
    expect((await effectivePlan(ACCOUNT)).plan.id).toBe('free');
    db.state.account = { ...db.state.account, plan_id: 'pro', plan_source: 'stripe', plan_status: 'active' };
    expect((await effectivePlan(ACCOUNT)).plan.id).toBe('pro');
    db.state.account = { ...db.state.account, plan_status: 'past_due' };
    expect((await effectivePlan(ACCOUNT)).plan.id).toBe('pro');
    db.state.account = { ...db.state.account, plan_status: 'canceled' };
    expect((await effectivePlan(ACCOUNT)).plan.id).toBe('free');
    db.state.account = { ...db.state.account, plan_id: 'plus', plan_source: 'admin', plan_status: 'active' };
    expect((await effectivePlan(ACCOUNT)).plan.id).toBe('plus');
  });
});

describe('counted limits', () => {
  it('lets a Free account use 10 autocompletes a day, then refuses with a reason', async () => {
    for (let index = 0; index < 10; index += 1) {
      expect(await checkQuota(ACCOUNT, 'autocomplete')).toBe(10 - index);
      await countUse(ACCOUNT, 'autocomplete');
    }
    const error = await checkQuota(ACCOUNT, 'autocomplete').catch((caught) => caught);
    expect(error).toBeInstanceOf(PlanLimitError);
    expect(error.status).toBe(402);
    expect(error.message).toBe("You have used today's 10 AI autocompletes on the Free plan. Upgrade for more.");
  });

  it('counts Plus by the month and never limits Pro', async () => {
    db.state.account = { ...db.state.account, plan_id: 'plus', plan_source: 'stripe', plan_status: 'active' };
    expect(await checkQuota(ACCOUNT, 'chat')).toBe(500);
    await countUse(ACCOUNT, 'chat', 500);
    await expect(checkQuota(ACCOUNT, 'chat')).rejects.toThrow("this month's 500 AI chat messages on the Plus plan");
    db.state.account = { ...db.state.account, plan_id: 'pro' };
    forgetPlans();
    expect(await checkQuota(ACCOUNT, 'chat')).toBeNull();
  });
});

describe('features and totals', () => {
  it('keeps LaTeX export for paid plans and stops the 11th PDF on Free', async () => {
    await expect(requireFeature(ACCOUNT, 'latex_export')).rejects.toBeInstanceOf(PlanLimitError);
    db.state.libraryPdfs = 9;
    await expect(checkLibraryRoom(ACCOUNT, 'user-1')).resolves.toBeUndefined();
    db.state.libraryPdfs = 10;
    await expect(checkLibraryRoom(ACCOUNT, 'user-1')).rejects.toThrow('Your Free plan includes 10 PDFs in your Library');
    db.state.account = { ...db.state.account, plan_id: 'plus', plan_source: 'stripe', plan_status: 'trialing' };
    await expect(requireFeature(ACCOUNT, 'latex_export')).resolves.toBeUndefined();
    await expect(checkLibraryRoom(ACCOUNT, 'user-1')).resolves.toBeUndefined();
  });
});

describe('planQuota on a route', () => {
  const app = new Hono<{ Variables: { user: { account_id: string } } }>();
  app.use('*', async (c, next) => { c.set('user', { account_id: ACCOUNT }); await next(); });
  app.post('/suggest', planQuota('autocomplete', { counted: (body) => Boolean(body?.text) }), async (c) => {
    const { text } = await c.req.json();
    return c.json({ text });
  });
  app.onError((error, c) => (error instanceof PlanLimitError
    ? c.json({ detail: error.message, code: 'plan_limit', limit: error.key }, 402)
    : c.json({ detail: 'error' }, 500)));
  const post = (text: string) => app.request('/suggest', { method: 'POST', body: JSON.stringify({ text }), headers: { 'content-type': 'application/json' } });

  it('counts only useful answers and answers 402 with the limit once used up', async () => {
    expect((await post('')).status).toBe(200);
    expect(db.state.usage.size).toBe(0);
    for (let index = 0; index < 10; index += 1) expect((await post('A sentence.')).status).toBe(200);
    const refused = await post('One more.');
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ code: 'plan_limit', limit: 'autocomplete' });
  });
});
