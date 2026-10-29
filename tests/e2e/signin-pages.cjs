// The one sign-in form on /login and /signup, desktop and phone: social
// options first, then the email decides — new email → "Create your account" (name, then
// "Set your password"), existing password → "Welcome back", email linked to Google → notice
// with Google + "Continue with password". Provider answers and the email lookup are stubbed in
// the browser where the server has no keys; sign-up and password sign-in are real. Also the
// optional Cloudflare check (Cloudflare's public always-pass test key, browser only).
// Writes /shots/signin-*.png.
//   (node localproxy.cjs &) ; BASE=http://localhost:8080 node signin-pages.cjs
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const PASSWORD = 'correct-horse-9';
const ALL = { password: true, passkeys: true, google: true, microsoft: true, apple: false, turnstile_site_key: null };
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`); };

(async () => {
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const open = async (options, stubs = {}) => {
    const context = await browser.newContext(options);
    if (stubs.methods) await context.route('**/api/auth/methods', (route) => route.fulfill({ json: stubs.methods }));
    if (stubs.identify) await context.route('**/api/auth/identify', (route) => route.fulfill({ json: stubs.identify }));
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(error.message.slice(0, 200)));
    return { context, page };
  };
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const heading = (page) => page.getByRole('heading', { level: 1 }).innerText().catch(() => '');
  const continueWith = async (page, email) => {
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();
  };

  for (const [label, options] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', devices['iPhone 13']]]) {
    // Both addresses show the same first step; nothing to switch between sign in and sign up.
    for (const path of ['/login', '/signup']) {
      const { context, page } = await open(options);
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('Email address').waitFor({ timeout: 20000 });
      await page.waitForTimeout(600);
      const name = path.slice(1);
      check(`${name} ${label}: one first step`, (await heading(page)) === 'Welcome to Videmak' && await page.getByText('Sign in or create an account.').isVisible(), await heading(page));
      check(`${name} ${label}: no separate sign-up link`, (await page.getByText(/Create a free account|Already have an account/).count()) === 0);
      check(`${name} ${label}: no sideways scroll`, (await overflow(page)) <= 0);
      await page.screenshot({ path: `${OUT}/signin-${name}-${label}.png` });
      if (page.errors.length) console.log('errors', page.errors);
      await context.close();
    }

    // Social first (stubbed: Google + Microsoft + passkey), then email; a new email creates an account.
    const create = await open(options, { methods: ALL, identify: { next_step: 'signup', account_exists: false, linked: false, providers: [], password_available: false, passkey_available: false } });
    await create.page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await create.page.getByLabel('Email address').waitFor({ timeout: 20000 });
    await create.page.waitForTimeout(600);
    check(`social first ${label}: Google, Microsoft and passkey`, (await create.page.getByRole('group', { name: 'Ways to sign in' }).getByRole('button').count()) === 3);
    await create.page.screenshot({ path: `${OUT}/signin-social-${label}.png` });
    await continueWith(create.page, 'new-writer@example.com');
    await create.page.getByRole('heading', { name: 'Create your account' }).waitFor({ timeout: 10000 }).catch(() => {});
    check(`new email ${label}: Create your account, socials still on top, name optional`,
      (await heading(create.page)) === 'Create your account'
      && await create.page.getByRole('button', { name: 'Sign in with Google' }).isVisible()
      && await create.page.getByText('Optional').isVisible(), await heading(create.page));
    check(`new email ${label}: no sideways scroll`, (await overflow(create.page)) <= 0);
    await create.page.screenshot({ path: `${OUT}/signin-create-${label}.png` });
    await create.page.getByRole('button', { name: 'Continue' }).click();
    check(`new email ${label}: then Set your password`, (await heading(create.page)) === 'Set your password' && await create.page.getByLabel('Password').isVisible());
    await create.page.screenshot({ path: `${OUT}/signin-setpassword-${label}.png` });
    await create.context.close();

    // An email linked to Google: the notice, Google, and "Continue with password".
    const linked = await open(options, { methods: ALL, identify: { next_step: 'provider', account_exists: true, linked: true, providers: ['google'], password_available: true, passkey_available: false } });
    await linked.page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await linked.page.getByLabel('Email address').waitFor({ timeout: 20000 });
    await continueWith(linked.page, 'google-linked@example.com');
    await linked.page.getByRole('heading', { name: 'Welcome back' }).waitFor({ timeout: 10000 }).catch(() => {});
    const notice = await linked.page.getByRole('status').innerText().catch(() => '');
    check(`linked email ${label}: notice names Google and the password`, /linked to Google\. Continue with Google below, or use your password\./.test(notice), notice);
    check(`linked email ${label}: only Google offered, plus password`,
      (await linked.page.getByRole('group', { name: 'Ways to sign in' }).getByRole('button').count()) === 1
      && await linked.page.getByRole('button', { name: 'Continue with password' }).isVisible());
    await linked.page.screenshot({ path: `${OUT}/signin-linked-${label}.png` });
    await linked.page.getByRole('button', { name: 'Continue with password' }).click();
    check(`linked email ${label}: password step without a dead Forgot link`,
      await linked.page.getByLabel('Password').isVisible() && (await linked.page.getByText('Forgot password?').count()) === 0);
    await linked.page.screenshot({ path: `${OUT}/signin-password-${label}.png` });
    await linked.context.close();
  }

  // The optional Cloudflare check: Cloudflare's public always-pass test key (browser only).
  {
    const { context, page } = await open({ viewport: { width: 1440, height: 900 } }, {
      methods: { ...ALL, turnstile_site_key: '1x00000000000000000000AA' },
      identify: { next_step: 'signup', account_exists: false, linked: false, providers: [], password_available: false, passkey_available: false },
    });
    let sentToken = null;
    await context.route('**/api/auth/identify', async (route) => {
      sentToken = JSON.parse(route.request().postData() || '{}').turnstile_token || null;
      await route.fulfill({ json: { next_step: 'signup', account_exists: false, linked: false, providers: [], password_available: false, passkey_available: false } });
    });
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email address').waitFor({ timeout: 20000 });
    await page.getByLabel('Email address').fill('check@example.test');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Create your account' }).waitFor({ timeout: 30000 }).catch(() => {});
    check('security check: Continue goes on with a token', (await heading(page)) === 'Create your account' && Boolean(sentToken), sentToken ? 'token sent' : 'no token');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/signin-security-check.png` });
    await context.close();
  }

  // A real new account (plan chosen on /pricing), then a real password sign-in.
  const email = `signin-${Date.now()}@example.test`;
  {
    const { context, page } = await open({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/signup?plan=plus&interval=month`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email address').waitFor({ timeout: 20000 });
    await page.getByText('Plus plan selected.').waitFor({ timeout: 8000 }).catch(() => {});
    check('signup with a plan shows the plan note', await page.getByText('Plus plan selected.').isVisible());
    await continueWith(page, email);
    await page.getByLabel('Full name').waitFor({ timeout: 15000 });
    await page.getByLabel('Full name').fill('Signin Tester');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/account|checkout\.stripe\.com/, { timeout: 30000 }).catch(() => {});
    const url = page.url();
    check('new account goes on to the chosen plan', /\/account|checkout\.stripe\.com/.test(url), url.replace(BASE, '').slice(0, 80));
    await context.close();
  }
  {
    const { context, page } = await open({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/login?next=/account`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email address').waitFor({ timeout: 20000 });
    await continueWith(page, email.toUpperCase());
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor({ timeout: 15000 });
    check('existing email: Welcome back with its password', await page.getByLabel('Password').isVisible());
    await page.getByLabel('Password').fill('wrong-password-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('main').getByRole('alert').waitFor({ timeout: 20000 }).catch(() => {});
    const refused = await page.locator('main').getByRole('alert').innerText().catch(() => '');
    check('wrong password is refused', /do not match/.test(refused), refused);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/account', { timeout: 30000 }).catch(() => {});
    check('password sign-in goes to ?next=', new URL(page.url()).pathname === '/account', page.url().replace(BASE, ''));
    await page.getByRole('heading', { name: 'Sign-in methods' }).waitFor({ timeout: 20000 }).catch(() => {});
    check('account shows Sign-in methods', await page.getByRole('heading', { name: 'Sign-in methods' }).isVisible().catch(() => false));
    await page.getByRole('heading', { name: 'Sign-in methods' }).scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${OUT}/signin-account-methods.png` });
    // Signed in: /login carries on instead of showing the form.
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/editor/, { timeout: 20000 }).catch(() => {});
    check('signed-in visit to /login carries on', page.url().includes('/editor'), page.url().replace(BASE, ''));
    if (page.errors.length) console.log('errors', page.errors);
    await context.close();
  }
  // A provider error coming back from the callback is shown on /login.
  {
    const { context, page } = await open({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/login#error=${encodeURIComponent('Google sign-in was cancelled.')}`, { waitUntil: 'domcontentloaded' });
    await page.locator('main').getByRole('alert').waitFor({ timeout: 10000 }).catch(() => {});
    check('provider error is shown', (await page.locator('main').getByRole('alert').innerText().catch(() => '')).includes('cancelled'));
    check('no background passkey error on another address', (await page.locator('main').getByRole('alert').count()) === 1);
    const finish = await page.goto(`${BASE}/auth/finish#ticket=not-a-real-ticket`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Sign-in did not finish' }).waitFor({ timeout: 15000 }).catch(() => {});
    check('a bad ticket is refused', await page.getByRole('heading', { name: 'Sign-in did not finish' }).isVisible().catch(() => false), String(finish?.status()));
    await page.screenshot({ path: `${OUT}/signin-finish-error.png` });
    await context.close();
  }

  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
