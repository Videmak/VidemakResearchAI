// Every Admin section on desktop and phone (screenshots /shots/admin-<section>-<size>.png), with a
// sideways-scroll check, the plan editor, a connection test and, if present, a sign-in switch.
//   (node localproxy.cjs &) ; BASE=http://localhost:8080 DATABASE_URL=… node admin-sections.cjs
const { chromium, devices } = require('playwright');
const { Client } = require('pg');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const PASSWORD = 'correct-horse-9';

async function adminSession(db) {
  // A fresh admin when sign-up allows it, else an earlier test admin (sign-up is rate limited).
  const email = `adminui-${Date.now()}@example.test`;
  const registered = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, full_name: 'Ada Admin' }) });
  let login = registered.status === 429 ? null : await registered.json();
  if (!login) {
    const { rows } = await db.query("select email from users where email like 'plansadmin-%@example.test' or email like 'adminui-%@example.test' order by created_at desc limit 1");
    const response = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: rows[0].email, password: PASSWORD }) });
    login = await response.json();
  }
  await db.query('update users set is_admin = true where id = $1', [login.user.id]);
  login.user.is_admin = true;
  return login;
}

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const auth = await adminSession(db);
  const browser = await chromium.launch();
  const sections = ['overview', 'plans', 'subscribers', 'activity', 'signin', 'ai', 'papers', 'billing', 'cloud'];
  for (const [size, options] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['phone', devices['iPhone 13']]]) {
    const context = await browser.newContext(options);
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));
    for (const section of sections) {
      await page.goto(`${BASE}/admin?section=${section}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const heading = await page.locator('main h2').first().innerText().catch(() => '');
      console.log(`${size} ${section}: heading "${heading}" | overflowX ${overflow}`);
      await page.screenshot({ path: `${OUT}/admin-${section}-${size}.png`, fullPage: true });
    }
    if (size === 'desktop') {
      await page.goto(`${BASE}/admin?section=plans`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await page.locator('main').getByRole('button', { name: /^Pro/ }).first().click();
      await page.getByRole('dialog').waitFor({ timeout: 10000 });
      await page.screenshot({ path: `${OUT}/admin-plan-editor-desktop.png` });
      await page.keyboard.press('Escape');
      await page.goto(`${BASE}/admin?section=papers`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Test connection' }).click();
      await page.waitForTimeout(6000);
      console.log('papers test:', (await page.locator('main section').first().innerText()).replace(/\s+/g, ' ').match(/(Works[^|]{0,60}|Not working[^|]{0,60})/)?.[0] ?? 'no result');
      await page.screenshot({ path: `${OUT}/admin-papers-tested-desktop.png`, fullPage: true });
      await page.goto(`${BASE}/admin?section=signin`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const switches = page.locator('main [role="switch"]');
      console.log('sign-in switches:', await switches.count());
      // A select change shows Save changes / Discard; discard it again.
      await page.goto(`${BASE}/admin?section=ai`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const model = page.locator('#setting-llmModel');
      if (await model.count()) {
        await model.fill(`${await model.inputValue()} `);
        console.log('dirty footer:', await page.getByRole('button', { name: 'Save changes' }).isVisible());
        await page.screenshot({ path: `${OUT}/admin-ai-dirty-desktop.png`, fullPage: true });
        await page.getByRole('button', { name: 'Discard' }).click();
      }
    }
    console.log(size, 'errors:', errors);
    await context.close();
  }
  await browser.close();
  await db.end();
})().catch((error) => { console.error(error); process.exit(1); });
