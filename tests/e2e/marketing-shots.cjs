// Screenshots of the public pages (desktop 1440 + iPhone 13), plus overflow and console checks.
// BASE=http://localhost:8080 node marketing-shots.cjs [tag] [paths...]
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080';
const TAG = process.argv[2] || 'm';
const PATHS = process.argv.slice(3).length ? process.argv.slice(3) : ['/', '/pricing', '/login', '/signup', '/forgot-password'];
(async () => {
  const browser = await chromium.launch();
  for (const [kind, options] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', devices['iPhone 13']]]) {
    const context = await browser.newContext(options);
    for (const path of PATHS) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 240)}`); });
      page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
      await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 90000 }).catch((e) => errors.push('goto: ' + e.message.slice(0, 120)));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1200);
      const name = path === '/' ? 'home' : path.slice(1).replace(/\//g, '-');
      await page.screenshot({ path: `/shots/${TAG}-${name}-${kind}.png`, fullPage: true });
      const info = await page.evaluate(() => {
        const doc = document.documentElement;
        const wide = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1 && getComputedStyle(el).position !== 'fixed').slice(0, 5).map((el) => `${el.tagName}.${String(el.className).slice(0, 60)} r=${Math.round(el.getBoundingClientRect().right)}`);
        const h = [...document.querySelectorAll('h1,h2,h3')].map((el) => el.tagName + ':' + el.textContent.trim().slice(0, 40));
        const h1 = document.querySelector('h1');
        return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, wide, headings: h.slice(0, 30), h1: h1 && getComputedStyle(h1).fontSize + ' ' + getComputedStyle(h1).fontFamily.slice(0, 40) };
      });
      console.log(JSON.stringify({ kind, path, ...info, errors }));
      await page.close();
    }
    await context.close();
  }
  await browser.close();
})();
