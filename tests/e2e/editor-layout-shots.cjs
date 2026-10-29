// Layout check for an open document: menu bar, one-row toolbar with the ⋮ overflow, the
// side rail and its panels, the status bar, the folded app nav and the first paragraph's
// handles. Writes /shots/layout-*.png and prints overlaps and console errors.
// Runs in the Playwright container: BASE=http://videmak-router:8080 node editor-layout-shots.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const email = `layout-${Date.now()}@example.test`;

const text = (t, styles = {}) => ({ type: 'text', text: t, styles });
const block = (type, content, props = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });
const SAMPLE = [
  block('heading', [text('Research Proposal on Malaria in Pregnancy')], { level: 1 }),
  block('paragraph', [text('Proposed Title: ', { bold: true }), text('Malaria in Pregnancy: Burden, Determinants, and Preventive Strategies in Endemic Settings')]),
  block('heading', [text('Introduction')], { level: 2 }),
  block('paragraph', [text('Malaria in pregnancy remains one of the most persistent public health challenges in endemic regions, particularly across sub-Saharan Africa where transmission is stable and access to antenatal prevention is uneven.')]),
];

// Does any element of `a` overlap any element of `b` on screen?
async function overlaps(page, a, b) {
  return page.evaluate(([sa, sb]) => {
    // Only what is on screen: tools waiting behind ⋮ are laid out but hidden.
    const shown = (el) => el.offsetParent && getComputedStyle(el).visibility !== 'hidden';
    const ra = [...document.querySelectorAll(sa)].filter(shown).map((el) => el.getBoundingClientRect());
    const rb = [...document.querySelectorAll(sb)].filter(shown).map((el) => el.getBoundingClientRect());
    return ra.some((x) => rb.some((y) => x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom));
  }, [a, b]);
}

(async () => {
  const { token, user } = await signIn(BASE, 'e2e');
  const id = crypto.randomUUID();
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ id, title: 'Untitled document', blocks: SAMPLE }) });

  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  for (const width of [1440, 1280, 1024]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [token, user]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
    const shot = (name) => page.screenshot({ path: `${OUT}/layout-${width}-${name}.png` });
    await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);
    await shot('1-closed');

    // First paragraph: hover it and check its handles are free.
    const first = page.locator('.bn-block-content').first();
    await first.hover();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/layout-${width}-2-first-handles.png`, clip: { x: 0, y: 100, width, height: 300 } });

    for (const [label, name] of [['Comments', '3-comments'], ['AI Chat', '4-chat'], ['Find papers', '5-papers']]) {
      await page.locator(`nav[aria-label="Document tools"] button[aria-label="${label}"]`).click();
      await page.waitForTimeout(900);
      await shot(name);
    }
    console.log(width, 'toolbar row overlaps panel:', await overlaps(page, '[data-testid="editor-toolbar-row"] > :not([data-wrapped])', '.ce-assistant-panel'));
    console.log(width, 'header overlaps panel:', await overlaps(page, 'header button', '.ce-assistant-panel'));
    const more = page.locator('button[aria-label="More tools"]');
    if (await more.count()) {
      await more.click();
      await page.waitForTimeout(500);
      await shot('6-more-tools');
      await page.locator('button[aria-label="Fewer tools"]').click();
    } else console.log(width, 'no overflow (all tools fit)');
    // Clicking the open tool again closes its panel.
    await page.locator('nav[aria-label="Document tools"] button[aria-label="Find papers"]').click();
    await page.waitForTimeout(600);
    console.log(width, 'panel closed by rail:', (await page.locator('.ce-assistant-panel').count()) === 0);
    await page.locator('nav[aria-label="Document tools"] button[aria-label="Outline"]').click();
    await page.waitForTimeout(600);
    await shot('7-outline');
    await page.locator('nav[aria-label="Document tools"] button[aria-label="Hide outline"]').click();
    const menu = page.locator('header').getByRole('button', { name: 'File', exact: true });
    if (await menu.count()) { await menu.click(); await page.waitForTimeout(400); await shot('8-file-menu'); await page.keyboard.press('Escape'); }
    if (width === 1440) {
      await page.locator('button[aria-label="Hide menu"]').click();
      await page.waitForTimeout(600);
      await shot('9-nav-folded');
      await page.locator('header button[aria-label="Menu"]').click();
      await page.waitForTimeout(600);
    }
    console.log(width, 'errors', JSON.stringify(errors));
    await context.close();
  }
  await browser.close();
})();
