// After billing-plans.cjs and stripe-prep (subscription ended, one open invoice), Stripe TEST mode:
// renew the ended plan with the saved card, pay the open invoice, Admin › Plans (edit features,
// give a plan by email), and the Documents drawer. Writes /shots/bill2-*.png.
//   (node localproxy.cjs &) ; BASE=http://localhost:8080 DATABASE_URL=… node billing-plans-2.cjs
const fs = require('fs');
const crypto = require('crypto');
const { chromium, devices } = require('playwright');
const { Client } = require('pg');
const { signIn } = require('./e2e-auth.cjs');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`); };

async function api(token, path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  return { status: response.status, body: await response.json().catch(() => null) };
}

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const person = JSON.parse(fs.readFileSync(`${OUT}/bill-user.json`, 'utf8'));
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const open = async (auth, options = { viewport: { width: 1440, height: 1000 } }) => {
    const context = await browser.newContext(options);
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(error.message.slice(0, 200)));
    return { context, page };
  };

  // 1. The ended plan: Renew charges the saved card.
  {
    const { context, page } = await open(person);
    let billing = (await api(person.token, '/api/billing')).body;
    check('plan ended: back on Free', billing.plan.id === 'free' && billing.subscription.status === 'canceled', `${billing.plan.id} ${billing.subscription?.status}`);
    await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
    await page.getByText('Your plan').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/bill2-ended.png`, fullPage: true });
    const renew = page.getByRole('button', { name: /^Renew/ });
    check('ended plan shows Renew', await renew.isVisible().catch(() => false), await renew.innerText().catch(() => ''));
    await renew.click();
    await page.getByText('Active', { exact: true }).waitFor({ timeout: 45000 }).catch(() => {});
    billing = (await api(person.token, '/api/billing')).body;
    check('renewed with the saved card', billing.plan.id === 'pro' && billing.subscription.status === 'active', `${billing.plan.id} ${billing.subscription?.status}`);

    // 2. The open invoice: Pay now.
    const due = billing.open_invoices[0];
    check('an open invoice is listed', Boolean(due), due ? `${due.number} ${due.amount_due}` : 'none');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Your plan').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/bill2-invoice-due.png`, fullPage: true });
    if (due) {
      await page.getByRole('button', { name: 'Pay now' }).first().click();
      await page.waitForTimeout(6000);
      billing = (await api(person.token, '/api/billing')).body;
      const paid = billing.invoices.find((invoice) => invoice.id === due.id);
      check('Pay now pays the open invoice', paid?.status === 'paid', paid?.status);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Your plan').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/bill2-renewed.png`, fullPage: true });
    console.log('page errors:', page.errors);
    await context.close();
  }

  // 3. Admin › Plans.
  {
    const admin = await signIn(BASE, 'plansadmin', 'Ada Admin');
    await db.query('update users set is_admin = true where id = $1', [admin.user.id]);
    admin.user.is_admin = true;
    const { context, page } = await open(admin);
    await page.goto(`${BASE}/admin?section=plans`, { waitUntil: 'domcontentloaded' });
    await page.locator('main').getByRole('button', { name: /^Team/ }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/bill2-admin-plans.png`, fullPage: true });
    check('admin: four plans listed', (await page.locator('main').innerText()).includes('Talk to us'));

    // Edit Plus: add a feature, save, see it in /api/plans, take it out again.
    await page.locator('main').getByRole('button', { name: /^Plus/ }).first().click();
    const editor = page.getByRole('dialog');
    await editor.waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${OUT}/bill2-admin-editor.png` });
    await editor.getByRole('textbox', { name: 'New feature' }).fill('Email support');
    await editor.getByRole('textbox', { name: 'New feature' }).press('Enter');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(3000);
    let plus = (await api(null, '/api/plans')).body.plans.find((plan) => plan.id === 'plus');
    check('admin: new feature on pricing', plus.features.some((feature) => feature.label === 'Email support'), plus.features.length + ' features');
    await page.locator('main').getByRole('button', { name: /^Plus/ }).first().click();
    await editor.waitFor({ timeout: 10000 });
    const count = await editor.getByRole('textbox', { name: /^Feature \d+/ }).count();
    await editor.getByRole('button', { name: 'Remove' }).nth(count - 1).click();
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(3000);
    plus = (await api(null, '/api/plans')).body.plans.find((plan) => plan.id === 'plus');
    check('admin: feature removed again', !plus.features.some((feature) => feature.label === 'Email support') && plus.purchasable, plus.features.length + ' features');

    // Give Pro to a Free person by email, then take it back.
    const free = await signIn(BASE, 'gifted', 'Gift Person');
    await page.goto(`${BASE}/admin?section=subscribers`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Email' }).waitFor({ timeout: 20000 });
    await page.getByRole('textbox', { name: 'Email' }).fill(free.user.email);
    await page.getByRole('combobox', { name: 'Plan' }).selectOption('pro');
    await page.getByRole('button', { name: 'Give', exact: true }).click();
    await page.waitForTimeout(2000);
    check('given plan applies', (await api(free.token, '/api/auth/me')).body.plan === 'pro');
    const latex = await api(free.token, '/api/ai-editor/word/export', { method: 'POST', body: JSON.stringify({ title: 'T', blocks: [], format: 'latex' }) });
    check('given Pro: LaTeX export allowed', latex.status !== 402, String(latex.status));
    await page.screenshot({ path: `${OUT}/bill2-admin-given.png`, fullPage: true });
    const removed = await api(admin.token, '/api/admin/accounts/plan', { method: 'PUT', body: JSON.stringify({ email: free.user.email, plan: null }) });
    check('given plan removed', removed.status === 200 && (await api(free.token, '/api/auth/me')).body.plan === 'free');
    const notAdmin = await api(free.token, '/api/admin/plans');
    check('non-admins cannot read Admin › Plans', notAdmin.status === 403 || notAdmin.status === 401, String(notAdmin.status));

    const phone = await open(admin, devices['iPhone 13']);
    await phone.page.goto(`${BASE}/admin?section=plans`, { waitUntil: 'domcontentloaded' });
    await phone.page.waitForTimeout(1500);
    check('admin phone: no sideways scroll', (await phone.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    await phone.page.screenshot({ path: `${OUT}/bill2-admin-phone.png`, fullPage: true });
    await phone.context.close();
    console.log('admin page errors:', page.errors);
    await context.close();
  }

  // 4. Documents drawer: list and thumbnails, from the editor and from an app page.
  {
    const titles = ['Sleep and memory', 'Thesis chapter 2', 'Lab report draft'];
    for (const title of titles) {
      await api(person.token, '/api/ai-editor/documents', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), title, blocks: [{ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [{ type: 'text', text: `${title} text.`, styles: {} }], children: [] }] }) });
    }
    const { context, page } = await open(person);
    await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
    await page.locator('aside').getByRole('button', { name: 'Documents' }).click();
    const drawer = page.locator('.ce-tool-drawer');
    await drawer.getByText('Lab report draft').waitFor({ timeout: 20000 }).catch(() => {});
    check('app page: Documents opens the drawer with documents', (await drawer.innerText().catch(() => '')).includes('Thesis chapter 2'));
    await page.screenshot({ path: `${OUT}/bill2-docs-list.png` });
    await drawer.getByRole('button', { name: 'Thumbnail view' }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/bill2-docs-thumbs.png` });
    await drawer.getByText('Thesis chapter 2').first().click();
    await page.waitForURL(/\/editor\?doc=/, { timeout: 20000 }).catch(() => {});
    check('picking a document opens it', /\/editor\?doc=/.test(page.url()), page.url().replace(BASE, ''));
    await page.waitForTimeout(4000);
    // The docked drawer stays open on wide screens; close it, then open it from the editor's menu.
    check('drawer stays docked beside the opened document', await drawer.isVisible().catch(() => false));
    await drawer.getByRole('button', { name: 'Close panel' }).click().catch(() => {});
    await page.waitForTimeout(600);
    const nav = page.locator('aside[aria-label="App"]');
    await nav.getByRole('button', { name: 'Documents' }).click();
    await page.waitForTimeout(1200);
    check('editor: Documents in the menu opens the drawer', await drawer.isVisible().catch(() => false) && /Thesis chapter 2/.test(await drawer.innerText().catch(() => '')));
    await page.screenshot({ path: `${OUT}/bill2-docs-editor.png` });
    console.log('docs page errors:', page.errors);
    await context.close();
  }

  // 5. A Free person at today's AI Chat limit: the chat shows why and Upgrade opens the pop-up.
  {
    const free = await signIn(BASE, 'chatlimit', 'Chat Limit');
    const [{ account_id: accountId }] = (await db.query('select account_id from users where id = $1', [free.user.id])).rows;
    await db.query(`insert into plan_usage (account_id, key, period, amount) values ($1, 'chat', $2, 5)
      on conflict (account_id, key, period) do update set amount = 5`, [accountId, new Date().toISOString().slice(0, 10)]);
    const { context, page } = await open(free);
    await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
    await page.locator('aside').getByRole('button', { name: 'AI Chat' }).click();
    const box = page.getByRole('textbox', { name: 'Message Videmak AI' });
    await box.waitFor({ timeout: 20000 });
    await box.fill('What does sleep do for memory?');
    await page.getByRole('button', { name: 'Send' }).click();
    const card = page.locator('.ce-credits-upsell');
    await card.waitFor({ timeout: 30000 }).catch(() => {});
    const cardText = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ');
    check('chat at the limit shows the plan message', /5 AI chat messages on the Free plan/.test(cardText), cardText.slice(0, 120));
    await page.screenshot({ path: `${OUT}/bill2-chat-limit.png` });
    await card.getByRole('button', { name: 'Upgrade' }).click().catch(() => {});
    const dialog = page.getByRole('dialog', { name: 'Choose your plan' });
    const shown = await dialog.isVisible({ timeout: 8000 }).catch(() => false);
    check('Upgrade opens the pop-up with the reason', shown && /5 AI chat messages/.test(await dialog.innerText().catch(() => '')));
    await page.screenshot({ path: `${OUT}/bill2-chat-dialog.png` });
    await page.keyboard.press('Escape');

    // In a document: the header's Upgrade opens the pop-up above the editor header.
    const docId = crypto.randomUUID();
    await api(free.token, '/api/ai-editor/documents', { method: 'POST', body: JSON.stringify({ id: docId, title: 'Upgrade test', blocks: [] }) });
    await page.goto(`${BASE}/editor?doc=${docId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    await page.locator('header, [role="banner"], body').getByRole('button', { name: 'Upgrade' }).last().click();
    await dialog.waitFor({ timeout: 8000 }).catch(() => {});
    const onTop = await page.evaluate(() => {
      const box = document.querySelector('[role="dialog"][aria-labelledby="pricing-title"]')?.getBoundingClientRect();
      if (!box) return 'no dialog';
      const points = [[box.right - 40, box.top + 30], [box.right - 200, box.top + 120], [box.left + 40, box.top + 30]];
      return points.every(([x, y]) => document.elementFromPoint(x, y)?.closest('[role="dialog"]')) ? 'on top' : 'covered';
    });
    check('editor: pricing pop-up sits above the editor header', onTop === 'on top', onTop);
    await page.screenshot({ path: `${OUT}/bill2-editor-dialog.png` });
    console.log('chat page errors:', page.errors);
    await context.close();
  }

  await browser.close();
  await db.end();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
