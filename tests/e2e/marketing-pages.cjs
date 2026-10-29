// Public pages are separate pages now: /, /features, /how-it-works, /pricing on desktop and
// phone, signed out and signed in. Checks the active menu item, the free-plan strip (signed out
// only), Dashboard when signed in, no sideways scroll and no page errors; writes /shots/pages-*.png.
//   (node localproxy.cjs &) ; BASE=http://localhost:8080 node marketing-pages.cjs
const { chromium, devices } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`); };
const PAGES = [
  { path: '/', menu: null, heading: 'Write your paper faster' },
  { path: '/features', menu: 'Features', heading: 'Everything you need to write a paper' },
  { path: '/how-it-works', menu: 'How it works', heading: 'From blank page to cited paper' },
  { path: '/pricing', menu: 'Pricing', heading: null },
];

(async () => {
  const auth = await signIn(BASE, 'pages');
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  for (const [device, options] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', devices['iPhone 13']]]) {
    for (const state of ['out', 'in']) {
      const context = await browser.newContext(options);
      if (state === 'in') {
        await context.addCookies([{ name: 'videmak_signed_in', value: '1', url: BASE }]);
        await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
      }
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));
      for (const item of PAGES) {
        const response = await page.goto(`${BASE}${item.path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        const tag = `${item.path} ${device} signed-${state}`;
        check(`${tag}: loads`, response?.status() === 200, String(response?.status()));
        const h1 = (await page.locator('h1').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
        if (item.heading) check(`${tag}: heading`, h1.startsWith(item.heading), h1);
        check(`${tag}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
        const header = page.locator('header');
        const strip = await page.getByText('card required').first().isVisible().catch(() => false);
        check(`${tag}: free-plan strip ${state === 'in' ? 'hidden' : 'shown'}`, state === 'in' ? !strip : strip);
        if (device === 'desktop') {
          const current = await header.locator('nav[aria-label="Main"]').first().locator('a[aria-current="page"]').allInnerTexts();
          check(`${tag}: active menu item`, item.menu ? current.join() === item.menu : current.length === 0, current.join() || 'none');
          const dashboard = await header.getByRole('link', { name: 'Dashboard' }).isVisible().catch(() => false);
          check(`${tag}: ${state === 'in' ? 'Dashboard shown' : 'Sign in shown'}`, state === 'in' ? dashboard : !dashboard && await header.getByRole('link', { name: 'Sign in' }).isVisible());
        }
        await page.screenshot({ path: `${OUT}/pages${item.path === '/' ? '-home' : item.path.replace(/\//g, '-')}-${device}-${state}.png`, fullPage: true });
      }
      if (device === 'phone' && state === 'out') {
        // The phone menu goes to the pages, and marks the open one.
        await page.goto(`${BASE}/features`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Open menu' }).click();
        const sheet = page.locator('dialog#site-menu');
        await sheet.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        const current = (await sheet.locator('a[aria-current="page"]').allInnerTexts()).map((text) => text.split('\n')[0]);
        check('phone menu: Features marked on /features', current.join() === 'Features', current.join());
        await page.screenshot({ path: `${OUT}/pages-phone-menu.png` });
        await sheet.getByRole('link', { name: 'How it works' }).click();
        await page.waitForURL(/\/how-it-works$/, { timeout: 10000 }).catch(() => {});
        check('phone menu: How it works opens its page', page.url().endsWith('/how-it-works'), page.url().replace(BASE, ''));
      }
      if (device === 'desktop' && state === 'out') {
        // Home teaser cards and links go to the new pages.
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('link', { name: /Find papers/ }).first().click();
        await page.waitForURL(/\/features#find-papers$/, { timeout: 10000 }).catch(() => {});
        check('home card opens /features#find-papers', page.url().endsWith('/features#find-papers'), page.url().replace(BASE, ''));
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('link', { name: 'See how it works' }).click();
        await page.waitForURL(/\/how-it-works$/, { timeout: 10000 }).catch(() => {});
        check('home "See how it works" opens /how-it-works', page.url().endsWith('/how-it-works'));
        await page.locator('footer').getByRole('link', { name: 'Features' }).click();
        await page.waitForURL(/\/features$/, { timeout: 10000 }).catch(() => {});
        check('footer Features opens /features', page.url().endsWith('/features'));
      }
      check(`${device} signed-${state}: no page errors`, errors.length === 0, errors.join(' | '));
      await context.close();
    }
  }
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  check('sitemap lists /features and /how-it-works', sitemap.includes('/features</loc>') && sitemap.includes('/how-it-works</loc>'));
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
