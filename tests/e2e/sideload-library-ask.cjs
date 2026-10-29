// Save two search results from the left drawer, see them in the Library tab, and "Ask" about one:
// the AI Chat opens on the right with the source attached. Writes /shots/side-lib-*.png.
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const BASE = process.env.BASE || 'http://videmak-router:8080';
const OUT = process.env.OUT || '/shots';
(async () => {
  const auth = await signIn(BASE, 'lib');
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  const drawer = page.locator('.ce-tool-drawer');
  await page.goto(`${BASE}/editor?tool=papers`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await drawer.getByRole('textbox', { name: 'Search papers' }).fill('sleep and memory consolidation');
  await page.keyboard.press('Enter');
  await drawer.locator('.ce-paper-card').first().waitFor({ timeout: 45000 });
  for (const index of [0, 1]) {
    await drawer.locator('.ce-paper-card').nth(index).getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(2500);
  }
  console.log('toasts', JSON.stringify(await page.locator('[role="status"]').allInnerTexts()));
  await page.screenshot({ path: `${OUT}/side-lib-1-saved.png` });
  await drawer.getByRole('tab', { name: 'Library' }).click();
  await page.waitForTimeout(2500);
  const rows = drawer.locator('[role="tabpanel"][aria-label="Library"] article');
  await rows.first().waitFor({ timeout: 20000 }).catch(() => {});
  console.log('library rows', await rows.count(), '|', (await drawer.innerText()).replace(/\s+/g, ' ').slice(0, 220));
  await page.screenshot({ path: `${OUT}/side-lib-2-library.png` });
  await rows.first().getByRole('button', { name: 'Ask' }).click();
  await page.waitForTimeout(1200);
  const chat = page.locator('.ce-chat-sideload');
  console.log('chat open', await chat.isVisible(), '| attached', JSON.stringify(await chat.locator('span', { hasText: '@' }).allInnerTexts()));
  await page.screenshot({ path: `${OUT}/side-lib-3-ask.png` });
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
