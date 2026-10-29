// Stripe TEST mode set-up for billing-plans-2.cjs, run inside the staging server container:
//   docker exec -i -e ACCOUNT=<account id> -w /app videmak-server node --input-type=module < stripe-prep.mjs
// Ends the account's plan subscription now (as if it lapsed) and leaves one open $5 invoice.
const { loadSettings } = await import('/app/dist/lib/settings.js');
await loadSettings();
const { stripeClient } = await import('/app/dist/lib/stripeBilling.js');
const { syncPlanSubscription } = await import('/app/dist/lib/planBilling.js');
const { sql } = await import('/app/dist/db.js');

const stripe = stripeClient();
const [account] = await sql`select plan_subscription_id, stripe_customer_id from accounts where id = ${process.env.ACCOUNT}`;
if (!stripe || !account?.plan_subscription_id) throw new Error('No Stripe or no plan subscription');
const balance = await stripe.balance.retrieve();
if (balance.livemode) throw new Error('Refusing: live mode');

const ended = await stripe.subscriptions.cancel(account.plan_subscription_id);
await syncPlanSubscription(stripe, ended);
await stripe.invoiceItems.create({ customer: account.stripe_customer_id, amount: 500, currency: 'usd', description: 'Test balance' });
const invoice = await stripe.invoices.create({ customer: account.stripe_customer_id, collection_method: 'send_invoice', days_until_due: 7, pending_invoice_items_behavior: 'include' });
const open = await stripe.invoices.finalizeInvoice(invoice.id);
console.log('ended', ended.status, '| open invoice', open.status, open.amount_due);
process.exit(0);
