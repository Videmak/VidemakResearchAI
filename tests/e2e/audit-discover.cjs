// Lists every control in an open document (menu bar menus and their items, toolbar, ⋮ overflow,
// header ⋯ menu, rail, status bar, slash menu, block side menu) as JSON for the button audit.
//   BASE=http://videmak-router:8080 node audit-discover.cjs > /shots/controls.json
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://videmak-router:8080';

const text = (t) => ({ type: 'text', text: t, styles: {} });
const block = (type, content, props = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });

(async () => {
  const auth = await signIn(BASE, 'disc');
  const id = crypto.randomUUID();
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Audit', blocks: [block('heading', [text('Audit')], { level: 1 }), block('paragraph', [text('First paragraph of the audit document.')])] }) });
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  const page = await context.newPage();
  await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  const out = {};
  const describe = (selector) => page.$$eval(selector, (nodes) => nodes.filter((n) => n.offsetParent).map((n) => (n.getAttribute('aria-label') || n.getAttribute('title') || n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));

  out.header = await describe('header button, header a, header input');
  out.toolbar = await describe('[data-testid="editor-toolbar-row"] button, [data-testid="editor-toolbar-row"] select, [data-testid="editor-toolbar-row"] input');
  out.rail = await describe('nav[aria-label="Document tools"] button');
  out.statusBar = await page.$$eval('button, select', (nodes) => nodes.filter((n) => n.offsetParent && n.getBoundingClientRect().top > window.innerHeight - 40).map((n) => (n.getAttribute('aria-label') || n.getAttribute('title') || n.textContent || '').replace(/\s+/g, ' ').trim()));

  // Menu bar menus.
  out.menus = {};
  for (const name of ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Citations', 'AI']) {
    const trigger = page.locator('header').getByRole('button', { name, exact: true });
    if (!(await trigger.count())) { out.menus[name] = 'MISSING'; continue; }
    await trigger.click();
    await page.waitForTimeout(400);
    out.menus[name] = await page.$$eval('[role="menu"] [role="menuitem"], [role="menu"] button, [data-menu-panel] button', (nodes) => nodes.filter((n) => n.offsetParent).map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()));
    // Sub-menus: hover each item with an arrow.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  // Header ⋯ menu.
  await page.locator('header button[aria-label="More"]').click();
  await page.waitForTimeout(300);
  out.moreMenu = await page.$$eval('[role="menu"] button, [role="menuitem"]', (nodes) => nodes.filter((n) => n.offsetParent).map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()));
  await page.keyboard.press('Escape');
  // ⋮ toolbar overflow (if any).
  const moreTools = page.locator('button[aria-label="More tools"]');
  if (await moreTools.count() && await moreTools.isVisible()) {
    await moreTools.click();
    await page.waitForTimeout(300);
    out.overflowTools = await describe('[data-testid="editor-toolbar-row"] button, [data-overflow-tools] button');
    await page.locator('button[aria-label="Fewer tools"]').click().catch(() => {});
  }
  // Slash menu on a new empty paragraph.
  const para = page.locator('.bn-block-content', { hasText: 'First paragraph' }).first();
  await para.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.waitForTimeout(600);
  out.slash = await page.$$eval('.bn-suggestion-menu-item, [role="option"]', (nodes) => nodes.map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  // Block side menu.
  await para.hover();
  await page.waitForTimeout(500);
  out.sideMenu = await describe('.bn-side-menu button, [data-block-side-menu] button');
  // Selection toolbar.
  await para.click({ clickCount: 3 });
  await page.waitForTimeout(600);
  out.selectionToolbar = await describe('.bn-formatting-toolbar button, [data-selection-toolbar] button, .bn-toolbar button');
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
