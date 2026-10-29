// Left menu tools open beside the page (no navigation): Library/Find papers in a left drawer, AI
// Chat on the right; the rail under the header, the Library's Collections, and the autocomplete
// Library limit picker. Writes /shots/nav-*.png.
//   BASE=http://videmak-router:8080 node editor-nav-tools.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://videmak-router:8080';
const OUT = process.env.OUT || '/shots';
(async () => {
  const auth = await signIn(BASE, 'nav');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` };
  await fetch(`${BASE}/api/library/folders`, { method: 'POST', headers, body: JSON.stringify({ name: 'Malaria papers' }) }).catch(() => {});
  const id = crypto.randomUUID();
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers, body: JSON.stringify({ id, title: 'Malaria in pregnancy', blocks: [{ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Malaria in pregnancy remains a major public health problem in Uganda.', styles: {} }], children: [] }] }) });
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
  const shot = (name) => page.screenshot({ path: `${OUT}/nav-${name}.png` });
  await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  const rail = await page.locator('nav[aria-label="Document tools"]').boundingBox();
  const toolbar = await page.locator('[data-testid="editor-toolbar-row"]').boundingBox();
  console.log('rail starts below the toolbar:', rail && toolbar ? Math.round(rail.y - (toolbar.y + toolbar.height)) : null, 'px');
  await shot('1-editor');
  const url = page.url();
  // The menu's AI Chat is the document's chat on the right; Library and Find papers slide in on the left.
  const nav = page.locator('aside[aria-label="App"]');
  const drawer = page.locator('.ce-tool-drawer');
  await nav.getByRole('button', { name: 'AI Chat' }).click();
  await page.waitForTimeout(700);
  console.log(`menu AI Chat → panel "${(await page.locator('.ce-assistant-panel h2:visible').innerText().catch(() => '')).trim()}", stayed in the editor: ${page.url() === url}`);
  await nav.getByRole('button', { name: 'Library' }).click();
  await page.waitForTimeout(700);
  console.log(`menu Library → left drawer ${await drawer.isVisible()} (tab "${await drawer.locator('[role="tab"][aria-selected="true"]').innerText()}"), menu replaced: ${!(await nav.isVisible())}, stayed: ${page.url() === url}`);
  await shot('2-library');
  await drawer.getByRole('button', { name: /Collections/ }).click();
  await page.waitForTimeout(500);
  await shot('3-collections');
  await drawer.getByRole('tab', { name: 'Find papers' }).click();
  await page.waitForTimeout(500);
  console.log(`drawer Find papers tab → search box: ${await drawer.getByRole('textbox', { name: 'Search papers' }).isVisible()}`);
  await drawer.getByRole('button', { name: 'Close panel' }).click();
  await page.waitForTimeout(500);
  console.log(`drawer closed, menu back: ${await nav.isVisible()}`);
  // The side rail's Library still opens beside the page on the right.
  await page.locator('nav[aria-label="Document tools"] button[aria-label="Library"]').click();
  await page.waitForTimeout(700);
  console.log(`rail Library → panel "${(await page.locator('.ce-assistant-panel h2:visible').innerText().catch(() => '')).trim()}"`);
  await page.locator('button[aria-label="Autocomplete settings"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Select sources' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Folders', exact: true }).click();
  await page.waitForTimeout(900);
  await shot('4-settings-picker');
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
