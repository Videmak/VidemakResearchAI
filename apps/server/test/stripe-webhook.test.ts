import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'test-secret-for-stripe-webhook-0123456789';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  // A fake postgres.js: records every query; stripe_events inserts return a row only the first time.
  const queries: { text: string; values: unknown[] }[] = [];
  const seen = new Set<unknown>();
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    queries.push({ text, values });
    if (text.includes('insert into stripe_events') || text.includes('insert into credit_ledger')) {
      const key = text.includes('credit_ledger') ? values[4] : values[0];
      if (seen.has(key)) return Promise.resolve([]);
      seen.add(key);
      return Promise.resolve([{ id: key }]);
    }
    if (text.includes('update accounts set credits_milli')) return Promise.resolve([{ credits_milli: '2000000' }]);
    return Promise.resolve([]);
  };
  return { queries, seen, sql: Object.assign(tx, { begin: (run: (t: typeof tx) => unknown) => run(tx) }) };
});

vi.mock('../src/db.js', () => ({ sql: db.sql }));

import { Hono } from 'hono';
import Stripe from 'stripe';
import { stripeWebhookRoutes } from '../src/routes/stripeWebhook.js';

const app = new Hono().route('/api/stripe', stripeWebhookRoutes());

function event(type: string, object: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: `evt_${type}_${Math.random().toString(36).slice(2)}`, object: 'event', type, created: 1_793_200_000, livemode: false, data: { object }, ...extra };
}

async function send(body: unknown, secret = 'whsec_test_secret') {
  const payload = JSON.stringify(body);
  const header = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
  return app.request('/api/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': header, 'content-type': 'application/json' } });
}

const updates = () => db.queries.filter((query) => query.text.includes('update accounts'));

describe('Stripe webhook', () => {
  beforeEach(() => { db.queries.length = 0; });

  it('rejects a payload signed with another secret', async () => {
    const response = await send(event('invoice.paid', { customer: 'cus_1' }), 'whsec_wrong');
    expect(response.status).toBe(400);
    expect(db.queries).toHaveLength(0);
  });

  const paidCheckout = (id: string) => event('checkout.session.completed', {
    id, object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: 2990,
    metadata: { videmak_kind: 'credits', videmak_account_id: 'acc_1', pack: 'credits_2000' },
  });
  const ledger = () => db.queries.filter((query) => query.text.includes('insert into credit_ledger'));

  it('adds the credits of a paid credit pack', async () => {
    const response = await send(paidCheckout('cs_1'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0].values).toEqual(expect.arrayContaining(['acc_1', 'purchase', 2_000_000, 2990, 'checkout:cs_1']));
    expect(updates().some((query) => query.values.includes(2_000_000))).toBe(true);
  });

  it('handles a repeated event only once', async () => {
    const body = paidCheckout('cs_2');
    await send(body);
    const again = await send(body);
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(ledger()).toHaveLength(1);
  });

  it('grants a payment once even when two events report it', async () => {
    await send(paidCheckout('cs_3'));
    await send(paidCheckout('cs_3'));
    expect(updates().filter((query) => query.text.includes('credits_milli'))).toHaveLength(1);
  });

  it('adds an automatic top-up the direct grant missed', async () => {
    await send(event('payment_intent.succeeded', { id: 'pi_1', status: 'succeeded', amount: 11900, metadata: { videmak_kind: 'credits_topup', videmak_account_id: 'acc_2', pack: 'credits_10000' } }));
    expect(ledger()[0].values).toEqual(expect.arrayContaining(['acc_2', 'topup', 10_000_000, 11900, 'payment:pi_1']));
  });

  it('ignores payments that are not Videmak credits', async () => {
    await send(event('payment_intent.succeeded', { id: 'pi_2', status: 'succeeded', amount: 500, metadata: {} }));
    await send(event('checkout.session.completed', { id: 'cs_4', mode: 'payment', payment_status: 'unpaid', metadata: { videmak_kind: 'credits', videmak_account_id: 'acc_3', pack: 'credits_2000' } }));
    expect(ledger()).toHaveLength(0);
  });

  it('ignores live-mode events until live payments are switched on', async () => {
    const response = await send(event('invoice.paid', { customer: 'cus_4' }, { livemode: true }));
    expect(await response.json()).toEqual({ received: true, ignored: 'live mode' });
    expect(db.queries).toHaveLength(0);
  });

  it('records events it does not act on', async () => {
    const response = await send(event('customer.created', { id: 'cus_5' }));
    expect(response.status).toBe(200);
    expect(updates()).toHaveLength(0);
    expect(db.queries.some((query) => query.text.includes('insert into stripe_events'))).toBe(true);
  });
});
