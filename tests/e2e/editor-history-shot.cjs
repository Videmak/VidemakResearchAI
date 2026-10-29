// Screenshot of the version history (with a saved and an AI version) at 1440. Writes /shots/history-*.png.
// BASE=http://localhost:8080 node editor-history-shot.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
(async () => {
  const auth = await signIn(BASE, 'history');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` };
  const id = crypto.randomUUID();
  const para = (t) => ({ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [{ type: 'text', text: t, styles: {} }], children: [] });
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers, body: JSON.stringify({ id, title: 'Malaria in pregnancy', blocks: [para('Malaria in pregnancy remains a major public health problem.')] }) });
  await fetch(`${BASE}/api/ai-editor/documents/${id}/versions`, { method: 'POST', headers, body: JSON.stringify({ label: 'First draft' }) });
  await fetch(`${BASE}/api/ai-editor/documents/${id}`, { method: 'PUT', headers, body: JSON.stringify({ blocks: [para('Malaria in pregnancy remains a major public health problem.'), para('Intermittent preventive treatment reduces placental infection.')] }) });
  await fetch(`${BASE}/api/ai-editor/documents/${id}/versions`, { method: 'POST', headers, body: JSON.stringify({ reason: 'ai' }) });
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  const page = await context.newPage();
  await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/history-0.png` });
  await page.locator('header button[aria-label="More"]').click({ timeout: 8000 });
  await page.getByRole('button', { name: 'Version history' }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/history-1.png` });
  const items = page.locator('[role="dialog"] li button, [role="dialog"] [data-version-id]');
  if (await items.count() > 1) { await items.nth(1).click(); await page.waitForTimeout(1500); await page.screenshot({ path: `${OUT}/history-2.png` }); }
  await browser.close();
})();
