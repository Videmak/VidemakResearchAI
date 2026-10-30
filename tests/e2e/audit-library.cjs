// Library end to end: upload a PDF with the drawer's Upload button, wait until it is processed,
// cite it in a document from the rail's Library, and ask about it in the document chat.
//   node localproxy.cjs & sleep 1; PDF=/shots/export/audit.pdf BASE=http://localhost:8080 node audit-library.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const PDF = process.env.PDF || '/shots/export/audit.pdf';
/** The PDF to upload: the one an earlier export audit wrote, else a small built-in one. */
function samplePdf() {
  if (fs.existsSync(PDF)) return fs.readFileSync(PDF);
  const text = 'Sleep supports memory consolidation through replay during slow-wave sleep.';
  const stream = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => { const at = body.length; body += `${index + 1} 0 obj\n${object}\nendobj\n`; return at; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
const P = (t) => ({ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [{ type: 'text', text: t, styles: {} }], children: [] });

(async () => {
  const auth = await signIn(BASE, 'lib2');
  const id = crypto.randomUUID();
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Library audit', blocks: [P('Sleep matters for students.')] }) });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  const log = (line) => console.log(line);
  await page.goto(`${BASE}/editor?tool=library`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const drawer = page.locator('.ce-tool-drawer');
  // Add opens the Add to Library dialog; its drop zone takes the PDF.
  await drawer.getByRole('button', { name: 'Add to Library' }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('pdf-dropzone').click();
  await (await chooser).setFiles({ name: 'sleep-study.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
  await page.locator('[aria-label="Added"]').first().waitFor({ timeout: 60000 });
  await page.getByRole('dialog', { name: 'Add to Library' }).getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(1500);
  log(`after upload: toasts ${JSON.stringify(await page.locator('[role="status"]').allInnerTexts())} | rows ${await drawer.locator('article').count()} | ${(await drawer.innerText()).replace(/\s+/g, ' ').slice(0, 160)}`);
  // Processing: poll the API (the drawer shows "Processing" until done).
  const t0 = Date.now();
  let status = '';
  while (Date.now() - t0 < 180000) {
    const list = await (await fetch(`${BASE}/api/library/documents?page_size=5`, { headers: { Authorization: `Bearer ${auth.token}` } })).json().catch(() => ({}));
    const doc = (list.documents || [])[0];
    status = doc ? `${doc.processing_status} "${doc.title || doc.filename}"` : 'none';
    if (doc && !['pending', 'processing', 'reprocessing'].includes(String(doc.processing_status))) break;
    await page.waitForTimeout(4000);
  }
  log(`processed in ${Math.round((Date.now() - t0) / 1000)} s: ${status}`);
  await page.screenshot({ path: `${OUT}/lib-drawer.png` });

  // Cite it in a document from the rail's Library.
  await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.bn-editor').waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.locator('.bn-block-content', { hasText: 'Sleep matters' }).click();
  await page.keyboard.press('End');
  await page.locator('nav[aria-label="Document tools"] button[aria-label="Library"]').click();
  await page.waitForTimeout(2000);
  const panel = page.locator('.ce-assistant-panel');
  await panel.locator('article:visible').first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `${OUT}/lib-panel-empty.png` });
    log(`rail Library panel: ${(await panel.innerText().catch(() => 'no panel')).replace(/\s+/g, ' ').slice(0, 200)}`);
  });
  const doc = (await (await fetch(`${BASE}/api/library/documents?page_size=5`, { headers: { Authorization: `Bearer ${auth.token}` } })).json()).documents[0];
  log(`library record: ${JSON.stringify({ title: doc.title, authors: doc.authors, year: doc.publication_date, status: doc.processing_status, pages: doc.page_count, chunks: doc.chunk_count, type: doc.file_type })}`);
  await panel.locator('article:visible').first().getByRole('button', { name: 'Cite' }).click();
  await page.waitForTimeout(2500);
  log(`cited: ${await page.locator('[data-inline-content-type="aiCitation"]').count()} | in text: ${await page.locator('[data-inline-content-type="aiCitation"]').first().innerText().catch(() => '')} | sentence: ${await page.locator('.bn-block-content').first().innerText()}`);
  await page.screenshot({ path: `${OUT}/lib-cited.png` });
  // Ask about it in the document chat.
  await panel.locator('article:visible').first().getByRole('button', { name: 'Ask' }).click();
  await page.waitForTimeout(800);
  log(`chat attached: ${(await panel.innerText()).includes('@')} `);
  await panel.getByRole('textbox').fill('In one sentence, what is this source about?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.ce-assistant-panel button[aria-label="Stop"]'), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(800);
  log(`answer: ${JSON.stringify((await panel.locator('.ce-chat-markdown').last().innerText().catch(() => '')).slice(0, 220))}`);
  await page.screenshot({ path: `${OUT}/lib-ask.png` });
  log(`errors ${JSON.stringify(errors)}`);
  await browser.close();
})();
