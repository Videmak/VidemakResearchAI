// Screenshot of the admin page (desktop + phone) for a quick visual check.
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080';
(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin-dev@example.test', password: 'correct-horse-9' }) });
  const { token, user } = await login.json();
  const browser = await chromium.launch();
  for (const [name, options] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['phone', devices['iPhone 13']]]) {
    const context = await browser.newContext(options);
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [token, user]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `/shots/admin-${name}.png`, fullPage: true });
    console.log(name, 'errors:', errors, 'overflowX:', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  }
  await browser.close();
})();
