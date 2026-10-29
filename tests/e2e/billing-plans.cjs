// Plans and billing end to end, Stripe TEST mode only: plans on /pricing and in the pricing
// pop-up, Free limits (402 plan_limit), Checkout for Plus with Stripe's published test card,
// cards (add, default, remove), switching to Pro yearly, cancel/resume. Writes /shots/bill-*.png
// and the test person to /shots/bill-user.json for billing-plans-2.cjs (renew, pay invoice).
//   (node localproxy.cjs &) ; BASE=http://localhost:8080 DATABASE_URL=… node billing-plans.cjs
// Stripe sends people back to PUBLIC_URL; those pages are rewritten to BASE so the whole run
// stays on the local address.
const fs = require('fs');
const { chromium, devices } = require('playwright');
const { Client } = require('pg');
const { signIn } = require('./e2e-auth.cjs');
const BASE = process.env.BASE || 'http://localhost:8080';
const PUBLIC = process.env.PUBLIC_URL || BASE;
const OUT = process.env.OUT || '/shots';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`); };

async function api(token, path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

/** Fills Stripe's hosted Checkout page (test mode) with a published test card and submits. */
async function payOnStripe(page, number, name) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
  await page.waitForLoadState('domcontentloaded');
  const cardField = page.locator('#cardNumber');
  if (!(await cardField.isVisible({ timeout: 8000 }).catch(() => false))) {
    // Several payment methods: pick Card in the accordion.
    for (const choice of [page.getByRole('radio', { name: /^Card/ }), page.locator('[data-testid="card-accordion-item-button"]'), page.getByText('Card', { exact: true })]) {
      if (await choice.first().isVisible().catch(() => false)) { await choice.first().click(); break; }
    }
  }
  await cardField.waitFor({ timeout: 30000 });
  await cardField.fill(number);
  await page.locator('#cardExpiry').fill('12 / 34');
  await page.locator('#cardCvc').fill('123');
  const holder = page.locator('#billingName');
  if (await holder.isVisible().catch(() => false)) await holder.fill(name);
  const zip = page.locator('#billingPostalCode');
  if (await zip.isVisible().catch(() => false)) await zip.fill('10001');
  const link = page.locator('#enableStripePass');
  if (await link.isChecked().catch(() => false)) await link.uncheck().catch(() => {});
  await page.screenshot({ path: `${OUT}/bill-stripe-${name.replace(/\W+/g, '-').toLowerCase()}.png` });
  await page.locator('[data-testid="hosted-payment-submit-button"], button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.href.includes('checkout.stripe.com'), { timeout: 90000 });
}

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const auth = await signIn(BASE, 'billing', 'Grace Hopper');
  const token = auth.token;
  const [{ account_id: accountId }] = (await db.query('select account_id from users where id = $1', [auth.user.id])).rows;
  console.log('test person', auth.user.email);

  // Plans from the API.
  const plans = (await api(null, '/api/plans')).body.plans;
  check('four public plans', plans.map((plan) => plan.id).join(',') === 'free,plus,pro,team', plans.map((plan) => plan.id).join(','));
  check('Plus and Pro can be bought', plans.filter((plan) => plan.purchasable).map((plan) => plan.id).join(',') === 'plus,pro');
  check('signed-in plan is Free', (await api(token, '/api/auth/me')).body.plan === 'free');

  // Free limits on the server.
  const latex = await api(token, '/api/ai-editor/word/export', { method: 'POST', body: JSON.stringify({ title: 'T', blocks: [], format: 'latex' }) });
  check('Free: LaTeX export refused with plan_limit', latex.status === 402 && latex.body?.code === 'plan_limit', `${latex.status} ${latex.body?.detail}`);
  const today = new Date().toISOString().slice(0, 10);
  await db.query(`insert into plan_usage (account_id, key, period, amount) values ($1, 'autocomplete', $2, 10)
    on conflict (account_id, key, period) do update set amount = 10`, [accountId, today]);
  const complete = await api(token, '/api/ai-editor/assist/complete', { method: 'POST', body: JSON.stringify({ text: 'Sleep helps memory', document_id: null }) });
  check('Free: 11th autocomplete today refused', complete.status === 402 && complete.body?.code === 'plan_limit', complete.body?.detail);
  await db.query(`insert into plan_usage (account_id, key, period, amount) values ($1, 'review', $2, 0)
    on conflict (account_id, key, period) do nothing`, [accountId, today]);

  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const open = async (options, signedIn = true) => {
    const context = await browser.newContext(options);
    if (signedIn) await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [token, auth.user]);
    // Stripe returns to PUBLIC_URL: keep it on the local address.
    if (PUBLIC !== BASE) await context.route(`${PUBLIC}/**`, (route) => route.fulfill({ status: 302, headers: { location: route.request().url().replace(PUBLIC, BASE) } }));
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(error.message.slice(0, 200)));
    return { context, page };
  };
  const dialog = (page) => page.getByRole('dialog', { name: 'Choose your plan' });

  // /pricing, signed out: four cards, the yearly toggle changes the price.
  for (const [label, options] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['phone', devices['iPhone 13']]]) {
    const { context, page } = await open(options, false);
    await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' });
    const plusCard = page.locator('section[aria-labelledby="plan-plus"]');
    const yearly = (await plusCard.innerText()).replace(/\s+/g, ' ');
    await page.getByRole('button', { name: 'Monthly' }).click();
    const monthly = (await plusCard.innerText()).replace(/\s+/g, ' ');
    check(`/pricing ${label}: toggle switches Plus price`, /\$8/.test(yearly) && /\$12/.test(monthly), `${yearly.slice(0, 60)} → ${monthly.slice(0, 60)}`);
    check(`/pricing ${label}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    await page.screenshot({ path: `${OUT}/bill-pricing-${label}.png`, fullPage: true });
    if (label === 'desktop') {
      const href = await page.locator('section[aria-labelledby="plan-pro"] a').first().getAttribute('href');
      check('/pricing signed out: Pro goes to sign-up with the plan', href === '/signup?plan=pro&interval=month', href);
    }
    await context.close();
  }

  const { context, page } = await open({ viewport: { width: 1440, height: 1000 } });

  // Account page and the pricing pop-up.
  await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
  await page.getByText('Your plan').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const usageText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  check('account: Free plan with usage meters', /Free/.test(usageText) && /10 \/ 10 today/.test(usageText), usageText.slice(0, 160));
  await page.screenshot({ path: `${OUT}/bill-account-free.png`, fullPage: true });
  await page.locator('main').getByRole('button', { name: 'Upgrade' }).first().click();
  await dialog(page).waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  check('pop-up: opens with plans', (await dialog(page).locator('section').count()) === 4);
  check('pop-up: Free shows Your plan', /Your plan/.test(await dialog(page).locator('section[aria-labelledby="plan-free"]').innerText()));
  await page.screenshot({ path: `${OUT}/bill-dialog-yearly.png` });
  await dialog(page).getByRole('button', { name: 'Monthly' }).click();
  await page.screenshot({ path: `${OUT}/bill-dialog-monthly.png` });
  await page.keyboard.press('Escape');
  check('pop-up: Escape closes', !(await dialog(page).isVisible().catch(() => false)));

  // Sidebar Upgrade and the editor's limit card both open the same pop-up.
  await page.locator('aside').getByRole('button', { name: 'Upgrade' }).click();
  check('sidebar Upgrade opens the pop-up', await dialog(page).isVisible({ timeout: 5000 }).catch(() => false));
  await page.keyboard.press('Escape');

  // Buy Plus monthly through Stripe Checkout (test card 4242…).
  await page.locator('main').getByRole('button', { name: 'Upgrade' }).first().click();
  await dialog(page).getByRole('button', { name: 'Monthly' }).click();
  await dialog(page).getByRole('button', { name: 'Upgrade to Plus' }).click();
  try {
    await payOnStripe(page, '4242424242424242', 'Grace Hopper');
    await page.getByText(/Payment received/).waitFor({ timeout: 45000 });
    check('Checkout: back on the account page with the plan on', true);
  } catch (error) {
    check('Checkout: Stripe test payment', false, error.message.slice(0, 200));
    await page.screenshot({ path: `${OUT}/bill-checkout-failed.png` });
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/bill-account-plus.png`, fullPage: true });
  const me = (await api(token, '/api/auth/me')).body;
  check('after Checkout: plan is Plus', me.plan === 'plus', me.plan);
  const latex2 = await api(token, '/api/ai-editor/word/export', { method: 'POST', body: JSON.stringify({ title: 'T', blocks: [], format: 'latex' }) });
  check('Plus: LaTeX export allowed', latex2.status !== 402, String(latex2.status));
  const complete2 = await api(token, '/api/ai-editor/assist/complete', { method: 'POST', body: JSON.stringify({ text: 'Sleep helps memory', document_id: null }) });
  check('Plus: autocomplete no longer refused', complete2.status !== 402, String(complete2.status));

  // Cards: add a Mastercard through Stripe's setup page, make it the default, remove the Visa.
  await page.getByRole('button', { name: 'Add card' }).click();
  try {
    await payOnStripe(page, '5555555555554444', 'Grace B Hopper');
    await page.getByText('Card added.').waitFor({ timeout: 45000 });
  } catch (error) {
    check('add card through Stripe', false, error.message.slice(0, 200));
  }
  await page.waitForTimeout(1200);
  let billing = (await api(token, '/api/billing')).body;
  check('two saved cards', billing.cards.length === 2, billing.cards.map((card) => `${card.brand} ${card.last4}${card.default ? ' default' : ''}`).join(', '));
  await page.screenshot({ path: `${OUT}/bill-cards-two.png`, fullPage: true });
  const master = billing.cards.find((card) => card.brand === 'mastercard');
  if (master && !master.default) {
    await page.getByRole('button', { name: 'Make default' }).first().click();
    await page.getByText('Default card changed.').waitFor({ timeout: 20000 }).catch(() => {});
    billing = (await api(token, '/api/billing')).body;
    check('Mastercard is the default', billing.cards[0]?.brand === 'mastercard' && billing.cards[0].default);
  }
  const visa = billing.cards.find((card) => card.brand === 'visa');
  if (visa) {
    await page.getByRole('button', { name: `Remove card ending ${visa.last4}` }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByText('Card removed.').waitFor({ timeout: 20000 }).catch(() => {});
    billing = (await api(token, '/api/billing')).body;
    check('Visa removed, Mastercard left', billing.cards.length === 1 && billing.cards[0].brand === 'mastercard');
  }
  const refusal = await api(token, `/api/billing/cards/${billing.cards[0]?.id}`, { method: 'DELETE' });
  check('the only card paying for the plan cannot be removed', refusal.status === 422, refusal.body?.detail);
  await page.screenshot({ path: `${OUT}/bill-cards-one.png`, fullPage: true });

  // Switch to Pro yearly in the pop-up (charged to the default card, no Stripe page).
  await page.getByRole('button', { name: 'Change plan' }).click();
  await dialog(page).getByRole('button', { name: 'Switch to Pro' }).click();
  await dialog(page).getByText(/You're on Pro now/).waitFor({ timeout: 45000 }).catch(() => {});
  await page.screenshot({ path: `${OUT}/bill-dialog-switched.png` });
  await dialog(page).getByRole('button', { name: 'Done' }).click().catch(() => {});
  billing = (await api(token, '/api/billing')).body;
  check('switched to Pro yearly', billing.plan.id === 'pro' && billing.subscription.interval === 'year', `${billing.plan.id} ${billing.subscription?.interval}`);

  // Cancel at the end of the period, then keep the plan.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Cancel plan' }).click();
  await page.getByRole('button', { name: 'Not writing right now' }).click();
  await page.screenshot({ path: `${OUT}/bill-cancel-confirm.png` });
  await page.locator('main').getByRole('button', { name: 'Cancel plan' }).last().click();
  await page.getByText(/Your plan is cancelled/).waitFor({ timeout: 20000 }).catch(() => {});
  billing = (await api(token, '/api/billing')).body;
  check('cancel at period end', billing.subscription.cancel_at_period_end === true && billing.plan.id === 'pro');
  await page.screenshot({ path: `${OUT}/bill-cancelled.png`, fullPage: true });
  await page.getByRole('button', { name: 'Keep my plan' }).click();
  await page.getByText(/renew as usual/).waitFor({ timeout: 20000 }).catch(() => {});
  billing = (await api(token, '/api/billing')).body;
  check('resume', billing.subscription.cancel_at_period_end === false);
  check('invoices listed', billing.invoices.length >= 2, `${billing.invoices.length} invoices`);
  await page.screenshot({ path: `${OUT}/bill-account-pro.png`, fullPage: true });

  // Phone layout of the account page.
  const phone = await open(devices['iPhone 13']);
  await phone.page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
  await phone.page.waitForTimeout(1500);
  check('account phone: no sideways scroll', (await phone.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  await phone.page.screenshot({ path: `${OUT}/bill-account-phone.png`, fullPage: true });
  await phone.context.close();

  console.log('page errors:', page.errors);
  fs.writeFileSync(`${OUT}/bill-user.json`, JSON.stringify({ token, user: auth.user, accountId }));
  await context.close();
  await browser.close();
  await db.end();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
