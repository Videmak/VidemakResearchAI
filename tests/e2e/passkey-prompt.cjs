// After signing in with a password, the app offers a passkey once: "Not now" hides it until the
// next sign-in, "Don't show again" for good; never on the sign-in pages, nor for someone who
// already has a passkey. Writes /shots/passkey-prompt-*.png.
//   (node localproxy.cjs &) ; BASE=http://localhost:8080 node passkey-prompt.cjs
const { chromium, devices } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const PASSWORD = 'correct-horse-9';
const results = [];
const appears = (locator) => locator.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`); };

(async () => {
  const account = await signIn(BASE, 'passkeyprompt', 'Prompt Tester');
  const email = account.user.email;
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));
  const prompt = page.getByRole('dialog', { name: 'Sign in faster with a passkey' });

  const signInWithPassword = async () => {
    await page.goto(`${BASE}/login?next=/account`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email address').waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/account/, { timeout: 20000 });
  };
  const signOut = async () => {
    await page.evaluate(() => { localStorage.removeItem('videmak_token'); localStorage.removeItem('videmak_user'); document.cookie = 'videmak_signed_in=; path=/; max-age=0'; });
  };

  // 1. First sign-in: the card appears on the next page, not on /login.
  await signInWithPassword();
  check('after sign-in: passkey card shows', await appears(prompt));
  await page.screenshot({ path: `${OUT}/passkey-prompt-desktop.png` });
  const text = (await prompt.innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('card has Create passkey, Not now and Don\'t show again', /Create passkey/.test(text) && /Not now/.test(text) && /Don.t show again/.test(text), text.slice(0, 140));

  // 2. Not now: gone, and not back on the next page of the same session.
  await prompt.getByRole('button', { name: 'Not now' }).click();
  check('Not now hides it', !(await prompt.isVisible().catch(() => false)));
  await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  check('not shown again in the same visit', !(await prompt.isVisible().catch(() => false)));

  // 3. Next sign-in: back; Don't show again keeps it away for good.
  await signOut();
  await signInWithPassword();
  check('next sign-in: shown again', await appears(prompt));
  await prompt.getByRole('button', { name: "Don't show again" }).click();
  await signOut();
  await signInWithPassword();
  await page.waitForTimeout(3000);
  check("after Don't show again: not shown", !(await prompt.isVisible().catch(() => false)));

  // 4. Someone who already has a passkey is not asked.
  const second = await signIn(BASE, 'passkeyowner', 'Has Passkey');
  const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await other.route('**/api/auth/sign-in-methods/me', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ json: { ...body, passkeys: [{ id: 'p1', name: 'Laptop', created_at: new Date().toISOString(), last_used_at: null, backed_up: true }] } });
  });
  const otherPage = await other.newPage();
  await otherPage.goto(`${BASE}/login?next=/account`, { waitUntil: 'domcontentloaded' });
  await otherPage.getByLabel('Email address').waitFor({ timeout: 20000 });
  await otherPage.waitForTimeout(500);
  await otherPage.getByLabel('Email address').fill(second.user.email);
  await otherPage.getByRole('button', { name: 'Continue' }).click();
  await otherPage.getByLabel('Password').fill(PASSWORD);
  await otherPage.getByRole('button', { name: 'Sign in' }).click();
  await otherPage.waitForURL(/\/account/, { timeout: 20000 });
  await otherPage.waitForTimeout(3500);
  check('has a passkey already: not asked', !(await otherPage.getByRole('dialog', { name: 'Sign in faster with a passkey' }).isVisible().catch(() => false)));
  await other.close();

  // 5. Phone: the card sits above the tab bar.
  const phone = await browser.newContext(devices['iPhone 13']);
  const phonePage = await phone.newPage();
  await phonePage.goto(`${BASE}/login?next=/editor`, { waitUntil: 'domcontentloaded' });
  await phonePage.getByLabel('Email address').waitFor({ timeout: 20000 });
  await phonePage.waitForTimeout(800);
  await phonePage.getByLabel('Email address').fill(second.user.email);
  await phonePage.getByRole('button', { name: 'Continue' }).click();
  await phonePage.getByLabel('Password').fill(PASSWORD);
  await phonePage.getByRole('button', { name: 'Sign in' }).click();
  await phonePage.waitForURL(/\/editor/, { timeout: 20000 });
  const phonePrompt = phonePage.getByRole('dialog', { name: 'Sign in faster with a passkey' });
  check('phone: card shows', await appears(phonePrompt));
  await phonePage.waitForTimeout(800);
  await phonePage.screenshot({ path: `${OUT}/passkey-prompt-phone.png` });
  await phone.close();

  console.log('errors', errors);
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
