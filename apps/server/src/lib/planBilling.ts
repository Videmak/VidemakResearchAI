import type Stripe from 'stripe';
import { sql } from '../db.js';
import { settings } from './settings.js';
import { forgetPlans, loadPlans, LIVE_STATUSES, type PlanRow } from './plans.js';

/**
 * Plan subscriptions on Stripe: a product per plan with a monthly and a yearly price, Stripe
 * Checkout for buying (cards, 3-D Secure and receipts handled by Stripe), and the account's
 * plan kept in step with the subscription (here and from the webhook).
 */
export type Interval = 'month' | 'year';

const appUrl = (path: string) => `${settings().publicUrl.replace(/\/$/, '')}${path}`;
const idOf = (value: string | { id: string } | null | undefined) => (typeof value === 'string' ? value : value?.id ?? null);

/** Creates or updates the plan's Stripe product and prices. Prices cannot change in Stripe, so
 * a new amount makes a new price and the old one is archived (current subscribers keep theirs). */
export async function syncPlanToStripe(stripe: Stripe, planId: string) {
  const [plan] = await sql<PlanRow[]>`select * from plans where id = ${planId}`;
  if (!plan) throw new Error('No such plan');
  if (plan.is_default || plan.checkout !== 'self_serve') return plan;
  let productId = plan.stripe_product_id;
  if (productId) {
    await stripe.products.update(productId, { name: `Videmak ${plan.name}`, description: plan.tagline || undefined, active: true });
  } else {
    productId = (await stripe.products.create({ name: `Videmak ${plan.name}`, description: plan.tagline || undefined, metadata: { videmak_plan: plan.id } })).id;
  }
  const ensurePrice = async (current: string | null, cents: number, interval: Interval) => {
    if (cents <= 0) {
      if (current) await stripe.prices.update(current, { active: false }).catch(() => undefined);
      return null;
    }
    if (current) {
      const price = await stripe.prices.retrieve(current).catch(() => null);
      if (price && price.unit_amount === cents && price.currency === plan.currency && price.recurring?.interval === interval && price.active) return current;
      if (price?.active) await stripe.prices.update(current, { active: false });
    }
    const created = await stripe.prices.create({
      product: productId!, currency: plan.currency, unit_amount: cents, recurring: { interval },
      nickname: `${plan.name} ${interval === 'month' ? 'monthly' : 'yearly'}`, metadata: { videmak_plan: plan.id, interval },
    });
    return created.id;
  };
  const monthly = await ensurePrice(plan.stripe_monthly_price_id, plan.monthly_cents, 'month');
  const yearly = await ensurePrice(plan.stripe_yearly_price_id, plan.yearly_cents, 'year');
  const mode = (await stripe.balance.retrieve()).livemode ? 'live' : 'test';
  const [updated] = await sql<PlanRow[]>`
    update plans set stripe_product_id = ${productId}, stripe_monthly_price_id = ${monthly}, stripe_yearly_price_id = ${yearly},
      stripe_mode = ${mode}, updated_at = now() where id = ${plan.id} returning *`;
  forgetPlans();
  return updated;
}

/** The account's Stripe customer (created on first use). */
export async function ensureCustomer(stripe: Stripe, accountId: string) {
  const [account] = await sql<{ name: string; stripe_customer_id: string | null }[]>`select name, stripe_customer_id from accounts where id = ${accountId}`;
  if (!account) throw new Error('No such account');
  if (account.stripe_customer_id) return account.stripe_customer_id;
  const [owner] = await sql<{ email: string; full_name: string | null }[]>`select email, full_name from users where account_id = ${accountId} order by created_at limit 1`;
  const customer = await stripe.customers.create({
    email: owner?.email, name: owner?.full_name || account.name || undefined, metadata: { videmak_account_id: accountId },
  });
  // Another request may have created one at the same moment: keep the first.
  const [saved] = await sql<{ stripe_customer_id: string }[]>`
    update accounts set stripe_customer_id = coalesce(stripe_customer_id, ${customer.id}) where id = ${accountId} returning stripe_customer_id`;
  return saved.stripe_customer_id;
}

const priceFor = (plan: PlanRow, interval: Interval) => (interval === 'year' ? plan.stripe_yearly_price_id : plan.stripe_monthly_price_id);

/** Checkout for a new subscription, or a plan change on the live one (charged or credited now). */
export async function startPlanPurchase(stripe: Stripe, accountId: string, planId: string, interval: Interval) {
  const { plans } = await loadPlans();
  const plan = plans.find((item) => item.id === planId);
  // Hidden plans (carried over from the previous app) stay with the people already on them.
  const [current] = await sql<{ plan: string | null }[]>`select plan from accounts where id = ${accountId}`;
  if (!plan || plan.checkout !== 'self_serve' || plan.is_default || (!plan.is_public && current?.plan !== plan.id)) throw new Error('This plan cannot be bought online.');
  const price = priceFor(plan, interval);
  if (!price) throw new Error(`${plan.name} has no ${interval === 'year' ? 'yearly' : 'monthly'} price yet.`);
  const customer = await ensureCustomer(stripe, accountId);
  const [account] = await sql<{ plan_subscription_id: string | null; plan_status: string }[]>`
    select plan_subscription_id, plan_status from accounts where id = ${accountId}`;
  if (account?.plan_subscription_id && LIVE_STATUSES.includes(account.plan_status)) {
    const subscription = await stripe.subscriptions.retrieve(account.plan_subscription_id);
    if (LIVE_STATUSES.includes(subscription.status)) {
      const item = subscription.items.data[0];
      const updated = await stripe.subscriptions.update(subscription.id, {
        items: [{ id: item.id, price }],
        proration_behavior: 'always_invoice',
        cancel_at_period_end: false,
        metadata: { ...subscription.metadata, videmak_kind: 'plan', videmak_plan: plan.id, videmak_account_id: accountId },
      });
      await syncPlanSubscription(stripe, updated);
      return { changed: true as const };
    }
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    allowed_payment_method_types: ['card'],
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    client_reference_id: accountId,
    subscription_data: {
      metadata: { videmak_kind: 'plan', videmak_plan: plan.id, videmak_account_id: accountId },
      ...(plan.trial_days > 0 ? { trial_period_days: plan.trial_days } : {}),
    },
    success_url: appUrl('/account?billing=success&session={CHECKOUT_SESSION_ID}'),
    cancel_url: appUrl('/account?billing=cancelled'),
  });
  return { url: session.url! };
}

/** Writes a plan subscription's state to its account (newer events win; others are ignored). */
export async function syncPlanSubscription(stripe: Stripe, subscription: Stripe.Subscription, eventAt?: Date) {
  const customer = idOf(subscription.customer as any);
  let accountId = subscription.metadata?.videmak_account_id || null;
  if (!accountId && customer) {
    const [owner] = await sql<{ id: string }[]>`select id from accounts where stripe_customer_id = ${customer}`;
    accountId = owner?.id ?? null;
  }
  if (!accountId) return null;
  const { plans } = await loadPlans();
  const item = subscription.items.data[0];
  const priceId = item?.price?.id;
  const plan = plans.find((candidate) => candidate.id === subscription.metadata?.videmak_plan)
    ?? plans.find((candidate) => candidate.stripe_monthly_price_id === priceId || candidate.stripe_yearly_price_id === priceId);
  if (!plan) return null;
  const interval = item?.price?.recurring?.interval === 'year' ? 'year' : 'month';
  // An ended subscription shows the day it ended, not the period it would have run to.
  const periodEnd = subscription.ended_at ?? (item as any)?.current_period_end ?? (subscription as any).current_period_end;
  const at = eventAt ?? new Date();
  // A live subscription replaces whatever was there; an ended one only updates the same subscription.
  const [row] = await sql<{ id: string }[]>`
    update accounts set plan = ${plan.id}, plan_subscription_id = ${subscription.id}, plan_status = ${subscription.status},
      plan_interval = ${interval}, plan_period_end = ${periodEnd ? new Date(periodEnd * 1000) : null},
      plan_cancel_at_period_end = ${Boolean(subscription.cancel_at_period_end || subscription.cancel_at)},
      plan_source = 'stripe', plan_event_at = ${at}
    where id = ${accountId}
      and (plan_subscription_id is null or plan_subscription_id = ${subscription.id} or ${LIVE_STATUSES.includes(subscription.status)}::boolean)
      and (plan_event_at is null or plan_event_at <= ${at} or plan_subscription_id is distinct from ${subscription.id})
    returning id`;
  // A first card (from Checkout) becomes the customer's default for later invoices.
  const paymentMethod = idOf(subscription.default_payment_method as any);
  if (row && customer && paymentMethod) {
    const current = await stripe.customers.retrieve(customer);
    if (!('deleted' in current) && !current.invoice_settings?.default_payment_method) {
      await stripe.customers.update(customer, { invoice_settings: { default_payment_method: paymentMethod } });
    }
  }
  return row ? accountId : null;
}

/** After Checkout returns: the session's subscription or new card, saved at once (no waiting for the webhook). */
export async function completeCheckout(stripe: Stripe, accountId: string, sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription', 'setup_intent'] });
  const [account] = await sql<{ stripe_customer_id: string | null }[]>`select stripe_customer_id from accounts where id = ${accountId}`;
  if (!account?.stripe_customer_id || idOf(session.customer as any) !== account.stripe_customer_id) throw new Error('This checkout belongs to another account.');
  if (session.mode === 'subscription' && session.subscription && typeof session.subscription === 'object') {
    await syncPlanSubscription(stripe, session.subscription as Stripe.Subscription);
    return { kind: 'subscription' as const };
  }
  if (session.mode === 'setup' && session.setup_intent && typeof session.setup_intent === 'object') {
    const paymentMethod = idOf((session.setup_intent as Stripe.SetupIntent).payment_method as any);
    if (paymentMethod) await setDefaultCard(stripe, accountId, paymentMethod, { onlyIfNone: true });
    return { kind: 'card' as const };
  }
  return { kind: 'none' as const };
}

/** Saved cards, the default first. */
export async function listCards(stripe: Stripe, customer: string) {
  const [methods, record] = await Promise.all([
    stripe.customers.listPaymentMethods(customer, { type: 'card', limit: 20 }),
    stripe.customers.retrieve(customer),
  ]);
  const defaultId = !('deleted' in record) ? idOf(record.invoice_settings?.default_payment_method as any) : null;
  return methods.data
    .map((method) => ({
      id: method.id, brand: method.card?.brand ?? 'card', last4: method.card?.last4 ?? '••••', exp_month: method.card?.exp_month ?? 0,
      exp_year: method.card?.exp_year ?? 0, name: method.billing_details?.name ?? null, funding: method.card?.funding ?? null,
      default: method.id === defaultId,
    }))
    .sort((a, b) => Number(b.default) - Number(a.default));
}

/** Stripe's secure page for adding a card (no card numbers ever reach Videmak). */
export async function startAddCard(stripe: Stripe, accountId: string) {
  const customer = await ensureCustomer(stripe, accountId);
  const session = await stripe.checkout.sessions.create({
    mode: 'setup', customer, currency: 'usd',
    // Cards only: the account page manages cards (wallets like Apple Pay still offer their cards).
    allowed_payment_method_types: ['card'],
    success_url: appUrl('/account?billing=card&session={CHECKOUT_SESSION_ID}'),
    cancel_url: appUrl('/account?billing=cancelled'),
  });
  return session.url!;
}

async function ownedCard(stripe: Stripe, customer: string, paymentMethod: string) {
  const method = await stripe.paymentMethods.retrieve(paymentMethod);
  if (idOf(method.customer as any) !== customer) throw new Error('This card is not on your account.');
  return method;
}

/** The card future invoices (and the plan subscription) are charged to. */
export async function setDefaultCard(stripe: Stripe, accountId: string, paymentMethod: string, options: { onlyIfNone?: boolean } = {}) {
  const customer = await ensureCustomer(stripe, accountId);
  await ownedCard(stripe, customer, paymentMethod);
  if (options.onlyIfNone) {
    const record = await stripe.customers.retrieve(customer);
    if (!('deleted' in record) && record.invoice_settings?.default_payment_method) return;
  }
  await stripe.customers.update(customer, { invoice_settings: { default_payment_method: paymentMethod } });
  const [account] = await sql<{ plan_subscription_id: string | null; plan_status: string }[]>`select plan_subscription_id, plan_status from accounts where id = ${accountId}`;
  if (account?.plan_subscription_id && LIVE_STATUSES.includes(account.plan_status)) {
    await stripe.subscriptions.update(account.plan_subscription_id, { default_payment_method: paymentMethod });
  }
}

/** Removes a card; the card a live subscription pays with stays until another one is the default. */
export async function removeCard(stripe: Stripe, accountId: string, paymentMethod: string) {
  const customer = await ensureCustomer(stripe, accountId);
  await ownedCard(stripe, customer, paymentMethod);
  const cards = await listCards(stripe, customer);
  const [account] = await sql<{ plan_status: string; plan_source: string }[]>`select plan_status, plan_source from accounts where id = ${accountId}`;
  const paying = account?.plan_source === 'stripe' && LIVE_STATUSES.includes(account.plan_status);
  if (paying && cards.find((card) => card.id === paymentMethod)?.default) {
    throw new Error(cards.length > 1 ? 'Make another card the default first: your plan is charged to this one.' : 'Add another card first: your plan is charged to this one.');
  }
  await stripe.paymentMethods.detach(paymentMethod);
}

/** Cancel at the end of the paid period (the plan stays until then), or undo that. */
export async function setCancelAtPeriodEnd(stripe: Stripe, accountId: string, cancel: boolean, reason?: string) {
  const [account] = await sql<{ plan_subscription_id: string | null }[]>`select plan_subscription_id from accounts where id = ${accountId}`;
  if (!account?.plan_subscription_id) throw new Error('There is no subscription to change.');
  const subscription = await stripe.subscriptions.update(account.plan_subscription_id, {
    cancel_at_period_end: cancel,
    ...(cancel && reason ? { cancellation_details: { comment: reason.slice(0, 500) } } : {}),
  });
  await syncPlanSubscription(stripe, subscription);
}

/** Starts the plan again after it ended: charged to the default card, or through Checkout. */
export async function renewPlan(stripe: Stripe, accountId: string) {
  const [account] = await sql<{ plan_id: string | null; plan_interval: string | null; plan_status: string; plan_source: string }[]>`
    select plan as plan_id, plan_interval, plan_status, plan_source from accounts where id = ${accountId}`;
  if (!account?.plan_id || account.plan_source === 'default') throw new Error('Choose a plan first.');
  if (account.plan_source === 'stripe' && LIVE_STATUSES.includes(account.plan_status)) throw new Error('Your plan is still active.');
  const interval: Interval = account.plan_interval === 'year' ? 'year' : 'month';
  const { plans } = await loadPlans();
  const plan = plans.find((item) => item.id === account.plan_id);
  const price = plan ? priceFor(plan, interval) : null;
  if (!plan || !price) throw new Error('This plan is no longer offered. Choose another one.');
  const customer = await ensureCustomer(stripe, accountId);
  const record = await stripe.customers.retrieve(customer);
  const card = !('deleted' in record) ? idOf(record.invoice_settings?.default_payment_method as any) : null;
  if (card) {
    try {
      const subscription = await stripe.subscriptions.create({
        customer, items: [{ price }], default_payment_method: card, payment_behavior: 'error_if_incomplete',
        metadata: { videmak_kind: 'plan', videmak_plan: plan.id, videmak_account_id: accountId },
      });
      await syncPlanSubscription(stripe, subscription);
      return { renewed: true as const };
    } catch (error) {
      // Declined or needs 3-D Secure: Stripe's page handles both.
      console.warn('renewal with the saved card failed:', (error as Error).message);
    }
  }
  return startPlanPurchase(stripe, accountId, plan.id, interval);
}

const invoiceSubscription = (invoice: Stripe.Invoice) =>
  idOf((invoice as any).parent?.subscription_details?.subscription ?? (invoice as any).subscription);

/** Recent invoices and the ones still to pay. */
export async function listInvoices(stripe: Stripe, customer: string) {
  const invoices = await stripe.invoices.list({ customer, limit: 24 });
  return invoices.data
    .filter((invoice) => invoice.status !== 'draft')
    .map((invoice) => ({
      id: invoice.id!, number: invoice.number, status: invoice.status, total: invoice.total, amount_due: invoice.amount_remaining,
      currency: invoice.currency, created: invoice.created, due_date: invoice.due_date, hosted_url: invoice.hosted_invoice_url,
      pdf: invoice.invoice_pdf, description: invoice.lines.data[0]?.description ?? null, subscription: invoiceSubscription(invoice),
    }));
}

/** Pays an open invoice with a saved card (default unless given); Stripe's page if it needs more. */
export async function payInvoice(stripe: Stripe, accountId: string, invoiceId: string, paymentMethod?: string) {
  const customer = await ensureCustomer(stripe, accountId);
  const invoice = await stripe.invoices.retrieve(invoiceId);
  if (idOf(invoice.customer as any) !== customer) throw new Error('This invoice is not on your account.');
  if (invoice.status !== 'open') throw new Error('This invoice has nothing left to pay.');
  if (paymentMethod) await ownedCard(stripe, customer, paymentMethod);
  try {
    const paid = await stripe.invoices.pay(invoiceId, paymentMethod ? { payment_method: paymentMethod } : {});
    const subscription = invoiceSubscription(paid);
    if (subscription) await syncPlanSubscription(stripe, await stripe.subscriptions.retrieve(subscription)).catch(() => undefined);
    return { paid: paid.status === 'paid', hosted_url: paid.status === 'paid' ? null : paid.hosted_invoice_url };
  } catch (error) {
    return { paid: false, error: (error as Error).message, hosted_url: invoice.hosted_invoice_url };
  }
}

export { invoiceSubscription };
