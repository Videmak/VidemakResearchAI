// Accounts and plans on CitedEvidence, against a CitedEvidence site with test users: sign-in only
// through CitedEvidence (sign-up there too), Premium and up gets in, Basic and no plan get the
// plans notice and no AI or new documents, a subscription bought here still counts (the account
// is linked by its verified email), someone signed in from before connects CitedEvidence to keep
// their account, and /pricing goes to CitedEvidence. Turns the setting on for
// the run and off again; writes /shots/ce-*.png.
//   CE_URL, CE_CLIENT_ID, CE_CLIENT_SECRET: an app registered at CE_URL/oauth/register with the
//   redirect http://localhost:8080/api/auth/oauth/citedevidence/callback (listed in
//   OAUTH_FIRST_PARTY_CLIENTS there); CE_TOKEN_PREMIUM / _BASIC / _NONE: CitedEvidence session
//   tokens of users on Premium, Basic and no plan; DATABASE_URL: this site's database.
//   (node localproxy.cjs &) ; BASE=http://localhost:8080 node citedevidence-accounts.cjs
const { chromium, devices } = require('playwright');
const { Client } = require('pg');
const { signIn } = require('./e2e-auth.cjs');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const CE_URL = (process.env.CE_URL || '').replace(/\/+$/, '');
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(token, path, init = {}) {
  const response = await fetch(BASE + path, {
    ...init, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

(async () => {
  for (const name of ['CE_URL', 'CE_CLIENT_ID', 'CE_CLIENT_SECRET', 'CE_TOKEN_PREMIUM', 'CE_TOKEN_BASIC', 'CE_TOKEN_NONE', 'DATABASE_URL']) {
    if (!process.env[name]) throw new Error(`${name} is not set`);
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  // An admin to change the settings, and a Videmak subscriber whose email matches the "no plan"
  // CitedEvidence user: both made while email sign-up is still on.
  const admin = await signIn(BASE, 'ceadmin');
  await db.query('update users set is_admin = true where id = $1', [admin.user.id]);
  const subscriberEmail = 'fixloop-vidce-none@example.invalid';
  await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: subscriberEmail, password: 'correct-horse-9' }) });
  const { rows: [subscriber] } = await db.query('select id, account_id from users where email = $1', [subscriberEmail]);
  const earlier = await signIn(BASE, 'ceearlier');
  await db.query("update accounts set plan = 'plus', plan_source = 'stripe', plan_status = 'active', plan_period_end = now() + interval '30 days' where id = $1", [subscriber.account_id]);
  // Earlier runs: start each CitedEvidence user unlinked.
  await db.query("delete from user_identities where provider = 'citedevidence' and email like 'fixloop-vidce-%'");
  await db.query("delete from citedevidence_links where email like 'fixloop-vidce-%'");

  const save = (values) => call(admin.token, '/api/admin/settings', { method: 'PUT', body: JSON.stringify({ values }) });
  const saved = await save({
    citedevidenceUrl: CE_URL, citedevidenceClientId: process.env.CE_CLIENT_ID, citedevidenceClientSecret: process.env.CE_CLIENT_SECRET,
    citedevidenceAccounts: 'on', citedevidenceMinTier: 'pro',
  });
  check('admin turns on accounts and plans on CitedEvidence', saved.status === 200, String(saved.status));

  const browser = await chromium.launch();
  try {
    const methods = (await call(null, '/api/auth/methods')).body;
    check('methods: CitedEvidence only', methods.accounts === 'citedevidence' && methods.citedevidence && !methods.password && !methods.passkeys && !methods.google,
      JSON.stringify({ accounts: methods.accounts, password: methods.password, citedevidence: methods.citedevidence }));
    check('methods: Premium and up, plans on CitedEvidence', methods.citedevidence_plans?.included_with === 'CitedEvidence Premium and up'
      && methods.citedevidence_plans.pricing_url.startsWith(`${CE_URL}/pricing`), methods.citedevidence_plans?.included_with);
    const register = await call(null, '/api/auth/register', { method: 'POST', body: JSON.stringify({ email: `ce-${Date.now()}@example.test`, password: 'correct-horse-9' }) });
    check('email sign-up is refused', register.status === 403, String(register.status));

    /** A browser signed in to CitedEvidence as one of its test users. */
    async function ceBrowser(tag, phone = false) {
      const ceToken = process.env[`CE_TOKEN_${tag.toUpperCase()}`];
      const context = await browser.newContext(phone ? devices['iPhone 13'] : { viewport: { width: 1440, height: 900 } });
      const ceHost = new URL(CE_URL).hostname;
      await context.addCookies([{ name: 'auth_token', value: ceToken, domain: `.${ceHost.split('.').slice(-2).join('.')}`, path: '/', secure: true, sameSite: 'Lax' }]);
      await context.addInitScript(([host, value]) => { if (location.hostname === host) { try { localStorage.setItem('auth_token', value); } catch { /* blocked */ } } }, [ceHost, ceToken]);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));
      return { context, page, errors };
    }

    // Signed in to Videmak from before the switch: no plan until they connect CitedEvidence, which keeps their account.
    const before = (await call(earlier.token, '/api/auth/me')).body;
    check('earlier session: no access, not linked yet', before?.has_access === false && before.citedevidence_linked === false, JSON.stringify(before));
    {
      const { context, page, errors } = await ceBrowser('premium');
      await context.addInitScript(([token, user]) => { if (location.port === '8080') { localStorage.setItem('videmak_token', JSON.stringify(token)); localStorage.setItem('videmak_user', JSON.stringify(user)); } }, [earlier.token, earlier.user]);
      await context.addCookies([{ name: 'videmak_signed_in', value: '1', url: BASE }]);
      await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
      await page.screenshot({ path: `${OUT}/ce-connect-before.png`, fullPage: true });
      await page.getByRole('button', { name: /Connect CitedEvidence/ }).first().click();
      const connected = await page.waitForURL((url) => url.pathname === '/account' && url.hash.includes('connected=citedevidence'), { timeout: 90_000 }).then(() => true).catch(() => false);
      check('earlier session: Connect CitedEvidence comes back connected', connected, page.url().slice(0, 120));
      const after = (await call(earlier.token, '/api/auth/me')).body;
      check('earlier session: same account, now with access', after?.id === earlier.user.id && after.has_access === true && after.citedevidence_linked === true, JSON.stringify(after));
      check('earlier session: no page errors', errors.length === 0, errors.join(' | '));
      await context.close();
    }

    /** Signs in through CitedEvidence as one of its test users; returns the page and Videmak session. */
    async function ceSignIn(tag, phone = false) {
      const { context, page, errors } = await ceBrowser(tag, phone);
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      const button = page.getByRole('button', { name: /Continue with CitedEvidence/ });
      const only = await button.isVisible() && (await page.locator('#auth-email').count()) === 0;
      check(`${tag}: sign-in page offers only CitedEvidence`, only);
      await page.screenshot({ path: `${OUT}/ce-login-${phone ? 'phone' : 'desktop'}.png` });
      await button.click();
      const back = await page.waitForURL((url) => url.origin === new URL(BASE).origin && url.pathname.startsWith('/editor'), { timeout: 90_000 }).then(() => true).catch(() => false);
      if (!back) await page.screenshot({ path: `${OUT}/ce-stuck-${tag}.png` });
      check(`${tag}: CitedEvidence signs them straight back in (no consent screen)`, back, page.url().slice(0, 120));
      const token = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('videmak_token') || 'null'); } catch { return null; } });
      return { context, page, token, errors };
    }

    // Premium on CitedEvidence: in (to the account it was connected to above).
    const premium = await ceSignIn('premium');
    const premiumMe = (await call(premium.token, '/api/auth/me')).body;
    check('premium: has access through CitedEvidence', premiumMe?.has_access === true && premiumMe.plan === 'citedevidence', JSON.stringify({ plan: premiumMe?.plan, has_access: premiumMe?.has_access }));
    check('premium: signs in to the connected account', premiumMe?.id === earlier.user.id, `${premiumMe?.id} vs ${earlier.user.id}`);
    const { rows: [link] } = await db.query('select l.plan_tier, l.plan_name, l.refresh_token_encrypted is not null as has_refresh, i.provider from citedevidence_links l join user_identities i on i.user_id = l.user_id and i.provider = $2 where l.user_id = $1', [premiumMe?.id, 'citedevidence']);
    check('premium: link saved (tier pro, refresh token kept encrypted)', link?.plan_tier === 'pro' && link.has_refresh, JSON.stringify(link));
    const created = await call(premium.token, '/api/ai-editor/documents', { method: 'POST', body: JSON.stringify({ title: 'CE premium test' }) });
    check('premium: may create documents', created.status === 201, String(created.status));
    const checkout = await call(premium.token, '/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan: 'plus', interval: 'month' }) });
    check('premium: Videmak checkout is closed (plans on CitedEvidence)', checkout.status === 409, String(checkout.status));
    await premium.page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
    const planCard = await premium.page.locator('#plan').innerText().catch(() => '');
    check('premium: Account shows the CitedEvidence plan', /CitedEvidence Premium/.test(planCard) && /Manage on CitedEvidence/.test(planCard), planCard.replace(/\s+/g, ' ').slice(0, 120));
    check('premium: no plans notice', !(await premium.page.getByText('Videmak is included with CitedEvidence Premium and up').first().isVisible().catch(() => false)));
    await premium.page.screenshot({ path: `${OUT}/ce-account-premium.png`, fullPage: true });
    check('premium: no page errors', premium.errors.length === 0, premium.errors.join(' | '));
    await premium.context.close();

    // Basic on CitedEvidence: signed in, but no AI, Library or new documents; told where to upgrade.
    for (const phone of [false, true]) {
      const basic = await ceSignIn('basic', phone);
      const tag = `basic ${phone ? 'phone' : 'desktop'}`;
      const me = (await call(basic.token, '/api/auth/me')).body;
      check(`${tag}: no access`, me?.has_access === false && me.plan === 'none', JSON.stringify({ plan: me?.plan, has_access: me?.has_access }));
      if (!phone) {
        const doc = await call(basic.token, '/api/ai-editor/documents', { method: 'POST', body: JSON.stringify({ title: 'CE basic test' }) });
        check(`${tag}: new documents refused with the plan message`, doc.status === 402 && /included with CitedEvidence Premium and up/.test(doc.body?.detail || doc.body?.message || ''), `${doc.status} ${JSON.stringify(doc.body).slice(0, 120)}`);
        const chat = await call(basic.token, '/api/ai-editor/assist/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
        check(`${tag}: AI refused before any model call`, chat.status === 402, String(chat.status));
        const limits = (await call(basic.token, '/api/library/limits')).body;
        check(`${tag}: no Library room`, limits?.pdfs_limit === 0 && limits.zotero_import === false, JSON.stringify(limits).slice(0, 120));
      }
      await basic.page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
      const notice = basic.page.getByText('Videmak is included with CitedEvidence Premium and up').first();
      check(`${tag}: plans notice shown`, await notice.isVisible().catch(() => false));
      const plansLink = await basic.page.getByRole('link', { name: /See CitedEvidence plans/ }).first().getAttribute('href').catch(() => '');
      check(`${tag}: plans link goes to CitedEvidence pricing`, (plansLink || '').startsWith(`${CE_URL}/pricing`), plansLink || '');
      check(`${tag}: no sideways scroll`, (await basic.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
      await basic.page.screenshot({ path: `${OUT}/ce-account-basic-${phone ? 'phone' : 'desktop'}.png`, fullPage: true });
      if (!phone) {
        await basic.page.getByRole('button', { name: /I’ve upgraded/ }).first().click();
        const still = await basic.page.getByText('No plan that includes Videmak yet').first().waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
        check(`${tag}: "I've upgraded" rechecks and says nothing changed`, still);
        await basic.page.locator('aside').getByRole('button', { name: 'Upgrade' }).click();
        const dialog = basic.page.getByRole('dialog', { name: 'Plans' });
        check(`${tag}: Upgrade opens the CitedEvidence plans dialog`, await dialog.isVisible().catch(() => false));
        await basic.page.screenshot({ path: `${OUT}/ce-upgrade-dialog.png` });
      }
      check(`${tag}: no page errors`, basic.errors.length === 0, basic.errors.join(' | '));
      await basic.context.close();
    }

    // No CitedEvidence plan, but a Videmak subscription under the same email: linked, and still in.
    const kept = await ceSignIn('none');
    const keptMe = (await call(kept.token, '/api/auth/me')).body;
    check('subscriber: CitedEvidence sign-in joins their Videmak account', keptMe?.id === subscriber.id, `${keptMe?.id} vs ${subscriber.id}`);
    check('subscriber: their Videmak subscription still counts', keptMe?.has_access === true && keptMe.plan === 'plus', JSON.stringify({ plan: keptMe?.plan, has_access: keptMe?.has_access }));
    await kept.context.close();

    // /pricing is CitedEvidence's (the page caches the setting for up to a minute).
    let pricing = null;
    for (let tries = 0; tries < 8; tries += 1) {
      const response = await fetch(`${BASE}/pricing`, { redirect: 'manual' });
      pricing = `${response.status} ${response.headers.get('location') || ''}`;
      if ([307, 308].includes(response.status)) break;
      await wait(10_000);
    }
    check('/pricing redirects to CitedEvidence pricing', /^30[78] /.test(pricing) && pricing.includes(`${CE_URL}/pricing`), pricing);
  } finally {
    // Back to normal sign-in for every other test (the keys stay for the next run).
    const off = await save({ citedevidenceAccounts: null });
    check('setting turned off again', off.status === 200, String(off.status));
    const after = (await call(null, '/api/auth/methods')).body;
    check('methods: email sign-in back', after?.password === true && after.accounts === null, JSON.stringify({ password: after?.password, accounts: after?.accounts }));
    await db.query("update accounts set plan = 'free', plan_source = 'default', plan_status = 'none', plan_period_end = null where id = $1", [subscriber.account_id]);
    await browser.close();
    await db.end();
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
