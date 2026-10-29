// Screenshots of the signed-in app pages (desktop 1440 and iPhone 13) for comparison with the mockups.
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080';
(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin-dev@example.test', password: 'correct-horse-9' }) });
  const { token, user } = await login.json();
  const browser = await chromium.launch();
  for (const [kind, options] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', devices['iPhone 13']]]) {
    const context = await browser.newContext(options);
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [token, user]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
    for (const path of ['/library', '/papers', '/chat', '/account']) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (path === '/papers') {
        await page.fill('input[aria-label="Search papers"]', 'sleep memory consolidation');
        await page.click('button[type="submit"]');
        await page.waitForTimeout(4000);
      }
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `/shots/app-${kind}${path.replace('/', '-')}.png` });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      console.log(kind, path, 'overflowX', overflow);
    }
    console.log(kind, 'errors', errors);
    await context.close();
  }
  await browser.close();
})();
