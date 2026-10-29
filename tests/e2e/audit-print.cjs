// What File › Print prints: the document page rendered with print styles (menus, rail, panels
// hidden; pages, footnotes and references kept). Writes /shots/print.pdf and print.png.
//   node localproxy.cjs & sleep 1; BASE=http://localhost:8080 node audit-print.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const text = (t, styles = {}) => ({ type: 'text', text: t, styles });
const block = (type, content = [], props = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });

(async () => {
  const auth = await signIn(BASE, 'e2e');
  const id = crypto.randomUUID();
  const paragraphs = Array.from({ length: 14 }, (_, i) => block('paragraph', [text(`Paragraph ${i + 1}. Sleep supports memory consolidation in students, and short sleep is associated with lower grades across several cohorts and study designs.`)]));
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Print audit', blocks: [block('heading', [text('Print audit')], { level: 1 }), ...paragraphs, block('paragraph', [text('With a note'), { type: 'footnote', props: { text: 'A printed footnote.', kind: 'footnote' } }, text('.')])] }) });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  const page = await context.newPage();
  await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.bn-editor').waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(500);
  const visible = await page.evaluate(() => {
    const shown = (el) => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    return {
      header: shown(document.querySelector('header')),
      appNav: shown(document.querySelector('aside[aria-label="App"]')),
      rail: shown(document.querySelector('nav[aria-label="Document tools"]')),
      toolbar: shown(document.querySelector('[data-testid="editor-toolbar-row"]')),
      statusBar: [...document.querySelectorAll('button')].some((b) => shown(b) && b.getAttribute('aria-label') === 'Zoom in'),
      pill: [...document.querySelectorAll('button')].some((b) => shown(b) && b.textContent.includes('AI suggest')),
    };
  });
  console.log('shown in print:', JSON.stringify(visible), '| printed notes:', JSON.stringify(await page.locator('.ce-print-notes li').allInnerTexts()));
  await page.pdf({ path: `${OUT}/print.pdf`, format: 'A4', printBackground: true });
  await page.screenshot({ path: `${OUT}/print.png`, fullPage: false });
  await browser.close();
})();
