import { Hono } from 'hono';
import Stripe from 'stripe';
import { sql } from '../db.js';
import { settings } from '../lib/settings.js';
import { billingMode, stripeClient } from '../lib/stripeBilling.js';
import { invoiceSubscription, syncPlanSubscription } from '../lib/planBilling.js';
import { grantForPayment, grantForSession } from '../lib/credits.js';

/** Events to select in Stripe → Developers → Webhooks (also shown on the admin page). */
export const WEBHOOK_EVENTS = [
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.overdue',
  'invoice.marked_uncollectible',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'checkout.session.completed',
  'payment_intent.succeeded',
] as const;

/** The plan subscription an event is about, if any (plan subscriptions carry videmak_kind=plan). */
async function planSubscriptionOf(event: Stripe.Event): Promise<string | null> {
  const object = event.data.object as any;
  if (event.type.startsWith('customer.subscription.')) {
    if (object.metadata?.videmak_kind === 'plan') return object.id;
    // Subscriptions carried over from the previous app have no Videmak metadata: known by their id.
    const [account] = await sql`select id from accounts where plan_subscription_id = ${object.id}`;
    return account ? object.id : null;
  }
  if (event.type === 'checkout.session.completed') return object.mode === 'subscription' ? customerOf(object.subscription) : null;
  if (event.type.startsWith('invoice.')) {
    const subscription = invoiceSubscription(object);
    if (!subscription) return null;
    // Invoices carry their subscription's metadata; the account check covers older invoices.
    if (object.parent?.subscription_details?.metadata?.videmak_kind === 'plan') return subscription;
    const [account] = await sql`select id from accounts where plan_subscription_id = ${subscription}`;
    return account ? subscription : null;
  }
  return null;
}

const customerOf = (value: string | { id: string } | null | undefined) => (typeof value === 'string' ? value : value?.id ?? null);

/**
 * Stripe webhook: POST /api/stripe/webhook. Verifies the signature with the signing secret
 * from the admin page and handles each event once: plan subscriptions keep the account's plan,
 * paid credit purchases and automatic top-ups add credits.
 */
export function stripeWebhookRoutes() {
  const app = new Hono();

  app.post('/webhook', async (c) => {
    const secret = settings().stripeWebhookSecret;
    if (!secret) return c.json({ detail: 'Stripe webhook signing secret is not set (admin page → Billing).' }, 503);
    const payload = await c.req.text();
    let event: Stripe.Event;
    try {
      event = await Stripe.webhooks.constructEventAsync(payload, c.req.header('stripe-signature') ?? '', secret);
    } catch {
      return c.json({ detail: 'Invalid Stripe signature' }, 400);
    }
    // Events from the other mode (live while testing, or test once live): acknowledge, change nothing.
    if (event.livemode !== (billingMode() === 'live')) return c.json({ received: true, ignored: event.livemode ? 'live mode' : 'test mode' });

    const planSubscription = await planSubscriptionOf(event);
    const [fresh] = await sql`insert into stripe_events (id, type) values (${event.id}, ${event.type}) on conflict do nothing returning id`;
    if (!fresh) return c.json({ received: true, duplicate: true });
    try {
      if (planSubscription) {
        const stripe = stripeClient();
        if (stripe) await syncPlanSubscription(stripe, await stripe.subscriptions.retrieve(planSubscription), new Date(event.created * 1000));
      } else if (event.type === 'checkout.session.completed') {
        await grantForSession(event.data.object);
      } else if (event.type === 'payment_intent.succeeded') {
        await grantForPayment(event.data.object);
      }
    } catch (error) {
      // Stripe retries on 5xx; credits are granted once per payment whichever attempt lands.
      console.error('stripe webhook handling failed', event.type, event.id, (error as Error).message);
      await sql`delete from stripe_events where id = ${event.id}`;
      return c.json({ detail: 'Handling failed; retry.' }, 500);
    }
    return c.json({ received: true });
  });

  return app;
}
