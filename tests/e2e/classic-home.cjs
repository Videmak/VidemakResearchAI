// The classic videmak.net home (/), its policy pages and Contact Us, on desktop and phone: the
// copy, every main button going to CitedEvidence, the menu, the support button, old /en/ links
// and no sideways scroll; writes /shots/classic-*.png.
//   (node localproxy.cjs &) ; BASE=http://localhost:8080 node classic-home.cjs
const { chromium, devices } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const CE = 'https://citedevidence.com';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`); };
const hrefs = (locator) => locator.evaluateAll((links) => links.map((link) => link.href));

(async () => {
  const auth = await signIn(BASE, 'classic');
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
      const tag = `${device} signed-${state}`;
      const response = await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      check(`/ ${tag}: loads`, response?.status() === 200, String(response?.status()));
      check(`/ ${tag}: title`, (await page.title()) === 'Videmak Research AI - Do Hours of Research in minutes', await page.title());
      check(`/ ${tag}: heading`, (await page.locator('h1').innerText()) === 'Save hours of research with CitedEvidence AI');
      const body = await page.locator('main').innerText();
      for (const text of ['Videmak Research AI is now CitedEvidence', 'Move from searching to cited research output faster', 'Still need old Videmak documents?', 'Research guides, citation tutorials, and AI workflow articles', 'Ready to turn sources into cited research?']) {
        check(`/ ${tag}: says "${text.slice(0, 40)}"`, body.includes(text));
      }
      const main = await hrefs(page.locator('main a'));
      const all = await hrefs(page.locator('a'));
      check(`/ ${tag}: every link is a real URL`, all.every((href) => /^https?:\/\//.test(href) && !href.includes('function(')), all.filter((href) => href.includes('function(')).length + ' broken');
      check(`/ ${tag}: Start Using CitedEvidence ×3 to citedevidence.com`, (await hrefs(page.locator('main a', { hasText: 'Start Using CitedEvidence' }))).filter((href) => href.startsWith(CE)).length === 3);
      check(`/ ${tag}: 19 module links to CitedEvidence`, (await hrefs(page.locator('#citedevidence li a'))).filter((href) => href.startsWith(CE)).length === 19);
      const toCe = all.filter((href) => href.startsWith(CE));
      check(`/ ${tag}: every CitedEvidence link tagged utm_source=videmak`, toCe.length > 0 && toCe.every((href) => new URL(href).searchParams.get('utm_source') === 'videmak'), `${toCe.length} links`);
      check(`/ ${tag}: 6 guides + all articles to CitedEvidence help`, main.filter((href) => href.startsWith(`${CE}/help`)).length === 7);
      check(`/ ${tag}: archive buttons go to /login`, main.filter((href) => href === `${BASE}/login`).length === 2);
      check(`/ ${tag}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
      if (device === 'phone') {
        await page.getByRole('button', { name: 'Open menu' }).click();
        await page.locator('#classic-menu').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        check(`/ ${tag}: phone menu opens`, await page.locator('#classic-menu').isVisible());
        await page.screenshot({ path: `${OUT}/classic-home-${device}-${state}-menu.png` });
        await page.getByRole('button', { name: 'Close menu' }).click();
      }
      const account = page.locator(device === 'phone' ? '#classic-menu' : 'nav[aria-label="Main"]');
      if (device === 'phone') await page.getByRole('button', { name: 'Open menu' }).click();
      if (state === 'in') check(`/ ${tag}: Dashboard to /editor`, (await hrefs(account.getByRole('link', { name: 'Dashboard' }))).includes(`${BASE}/editor`));
      else check(`/ ${tag}: Sign In + Start on CitedEvidence`, (await hrefs(account.getByRole('link', { name: 'Sign In' }))).includes(`${BASE}/login`) && (await hrefs(account.getByRole('link', { name: 'Start on CitedEvidence' }))).some((href) => href.startsWith(`${CE}/register`)));
      if (device === 'phone') await page.getByRole('button', { name: 'Close menu' }).click();
      await page.getByRole('button', { name: /Get Support/ }).click();
      check(`/ ${tag}: support shows WhatsApp + ticket`, await page.getByRole('link', { name: /WhatsApp Chat/ }).isVisible() && (await hrefs(page.getByRole('link', { name: /Submit Ticket/ }))).includes(`${BASE}/contact`));
      await page.getByRole('button', { name: /Get Support/ }).click();
      await page.screenshot({ path: `${OUT}/classic-home-${device}-${state}.png`, fullPage: true });
      if (state === 'out') {
        for (const path of ['/page/terms-and-conditions', '/page/privacy_policy', '/page/data-deletion-policy', '/contact']) {
          const reply = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
          const h1 = await page.locator('h1').innerText().catch(() => '');
          check(`${path} ${tag}: loads with heading`, reply?.status() === 200 && h1.length > 0, `${reply?.status()} ${h1}`);
          check(`${path} ${tag}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
          await page.screenshot({ path: `${OUT}/classic${path.replace(/\//g, '-')}-${device}.png`, fullPage: true });
        }
        check(`/contact ${tag}: three cards`, (await page.locator('main li h2').allInnerTexts()).join() === 'Our Location,Email Us,Call Us');
      }
      check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '));
      await context.close();
    }
  }
  const old = await fetch(`${BASE}/en/contact`, { redirect: 'manual' });
  check('/en/contact redirects to /contact', old.status === 308 && new URL(old.headers.get('location'), BASE).pathname === '/contact', `${old.status} ${old.headers.get('location')}`);
  const missing = await fetch(`${BASE}/page/no-such-page`);
  check('/page/no-such-page is 404', missing.status === 404, String(missing.status));
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  check('sitemap lists /contact and the policy pages', ['/contact', '/page/privacy_policy'].every((path) => sitemap.includes(`${path}</loc>`)));
  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
