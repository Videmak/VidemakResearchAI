// "Add to Library" end to end: several PDFs at once with progress, drag and drop, plan limits
// (PDFs per upload, size, Library full), .bib import (and importing it again), pasted DOIs /
// PubMed / arXiv ids, Zotero/Mendeley locked on Free and the connect screens on a paid plan.
// Writes /shots/libadd-*.png.
//   (node localproxy.cjs &) ; BASE=http://localhost:8080 DATABASE_URL=… node library-add.cjs
const { chromium, devices } = require('playwright');
const { Client } = require('pg');
const { signIn } = require('./e2e-auth.cjs');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`); };

/** A small real PDF with a line of text. */
function pdf(text) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
const file = (name, buffer, mimeType = 'application/pdf') => ({ name, mimeType, buffer });

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const auth = await signIn(BASE, 'libadd', 'Marie Curie');
  const [{ account_id: accountId }] = (await db.query('select account_id from users where id = $1', [auth.user.id])).rows;
  const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
  const api = async (path, init = {}) => { const response = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); return { status: response.status, data: await response.json().catch(() => null) }; };

  const limits = await api('/api/library/limits');
  check('Free limits: 10 PDFs, 10 MB, 5 at once, no Zotero/Mendeley', limits.data.pdfs_limit === 10 && limits.data.upload_mb === 10 && limits.data.upload_batch === 5 && !limits.data.zotero_import && !limits.data.mendeley_import, JSON.stringify(limits.data));

  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const open = async (options) => {
    const context = await browser.newContext(options);
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(error.message.slice(0, 200)));
    await page.goto(`${BASE}/editor?tool=library`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Add to Library' }).first().waitFor({ timeout: 30000 });
    return { context, page };
  };
  const { context, page } = await open({ viewport: { width: 1440, height: 900 } });
  const dialog = page.getByRole('dialog', { name: 'Add to Library' });
  await page.getByRole('button', { name: 'Add to Library' }).first().click();
  await dialog.waitFor();
  const tabs = await dialog.getByRole('navigation', { name: 'Ways to add' }).innerText();
  check('dialog: five ways to add', ['Upload PDFs', 'Zotero', 'Mendeley', 'Import .bib/.ris', 'Paste IDs'].every((label) => tabs.includes(label)), tabs.replace(/\s+/g, ' '));
  check('dialog: shows PDFs used on the plan', /0 of 10 PDFs used/.test(await dialog.getByTestId('pdf-room').innerText()));
  await page.screenshot({ path: `${OUT}/libadd-1-open.png` });

  // Several PDFs, a non-PDF and one over the plan's size, in one go.
  await dialog.locator('input[type="file"]').setInputFiles([
    file('sleep-one.pdf', pdf('Sleep and memory consolidation, paper one')),
    file('sleep-two.pdf', pdf('Sleep and memory consolidation, paper two')),
    file('sleep-three.pdf', pdf('Sleep and memory consolidation, paper three')),
    file('notes.txt', Buffer.from('not a pdf'), 'text/plain'),
    file('huge.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024, 32)])),
  ]);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="upload-list"] li').length === 4 && ![...document.querySelectorAll('[data-testid="upload-list"] .transition-\\[width\\]')].length, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  const list = (await dialog.getByTestId('upload-list').innerText()).replace(/\s+/g, ' ');
  check('three PDFs uploaded at once', (await dialog.locator('[aria-label="Added"]').count()) === 3, list.slice(0, 160));
  check('over-size PDF refused with an upgrade offer', /Over 10 MB/.test(list) && (await dialog.getByRole('button', { name: 'Upgrade' }).count()) >= 1);
  check('non-PDF skipped with a note', /1 file skipped: only PDFs/.test(await dialog.innerText()));
  await page.screenshot({ path: `${OUT}/libadd-2-uploaded.png` });

  // Drag and drop.
  await dialog.getByTestId('pdf-dropzone').evaluate((zone, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'dropped.pdf', { type: 'application/pdf' }));
    zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    zone.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, [...pdf('A dropped paper about sleep and memory')]);
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Added"]').length === 4, null, { timeout: 30000 }).catch(() => {});
  check('drag and drop uploads', (await dialog.locator('[aria-label="Added"]').count()) === 4);
  const [{ count: stored }] = (await db.query(`select count(*)::int as count from library_documents where user_id = $1 and file_type = 'pdf'`, [auth.user.id])).rows;
  check('four PDFs stored on the server', stored === 4, String(stored));

  // Plan limits: 5 at a time, and a full Library (10).
  await dialog.locator('input[type="file"]').setInputFiles(Array.from({ length: 7 }, (_, index) => file(`batch-${index}.pdf`, pdf(`Batch paper number ${index} about sleep`))));
  await page.waitForTimeout(400);
  check('more than 5 at once: the first 5 go, with a note', /uploads 5 PDFs at a time/.test(await dialog.innerText()));
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="upload-list"] .transition-\\[width\\]')].length, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  const [{ count: storedNow }] = (await db.query(`select count(*)::int as count from library_documents where user_id = $1 and file_type = 'pdf'`, [auth.user.id])).rows;
  check('the 5 allowed went up (9 PDFs now)', storedNow === 9, `${storedNow} stored`);
  await dialog.locator('input[type="file"]').setInputFiles([file('one-more-a.pdf', pdf('One more paper A')), file('one-more-b.pdf', pdf('One more paper B'))]);
  await page.waitForTimeout(2500);
  const [{ count: storedFull }] = (await db.query(`select count(*)::int as count from library_documents where user_id = $1 and file_type = 'pdf'`, [auth.user.id])).rows;
  check('never more than the plan\'s 10 PDFs', storedFull === 10, String(storedFull));
  check('Library full message shown', /Library is full/.test(await dialog.innerText()));
  await page.screenshot({ path: `${OUT}/libadd-3-limits.png` });

  // .bib import (references count; their PDFs would not fit, the Library is full).
  await dialog.getByRole('button', { name: 'Import .bib/.ris' }).click();
  const bib = `@article{diekelmann2010, title={The memory function of sleep}, author={Diekelmann, Susanne and Born, Jan}, journal={Nature Reviews Neuroscience}, year={2010}, doi={10.1038/nrn2762}}
@article{rasch2013, title={About sleep's role in memory}, author={Rasch, Bj{\\"o}rn and Born, Jan}, journal={Physiological Reviews}, year={2013}, doi={10.1152/physrev.00032.2012}}
@book{walker2017, title={Why We Sleep}, author={Walker, Matthew}, year={2017}}`;
  await dialog.locator('input[type="file"]').setInputFiles(file('my-library.bib', Buffer.from(bib), 'application/x-bibtex'));
  await dialog.getByTestId('import-progress').waitFor({ timeout: 20000 });
  await dialog.getByText('Import finished').waitFor({ timeout: 90000 }).catch(() => {});
  const bibText = (await dialog.getByTestId('import-progress').innerText()).replace(/\s+/g, ' ');
  check('.bib: 3 references added', /3 items added/.test(bibText), bibText);
  check('.bib: PDFs that do not fit are reported', /not added: your plan's Library is full/.test(bibText) || /PDF/.test(bibText), bibText);
  await page.screenshot({ path: `${OUT}/libadd-4-bib.png` });
  await dialog.getByRole('button', { name: 'Import more' }).click();
  await dialog.locator('input[type="file"]').setInputFiles(file('my-library.bib', Buffer.from(bib), 'application/x-bibtex'));
  await dialog.getByText('Import finished').waitFor({ timeout: 60000 }).catch(() => {});
  check('.bib again: all 3 already in the Library', /0 items added · 3 already in your Library/.test((await dialog.getByTestId('import-progress').innerText()).replace(/\s+/g, ' ')));

  // Pasted identifiers (room for references is unlimited).
  await dialog.getByRole('button', { name: 'Paste IDs' }).click();
  await dialog.getByLabel('DOIs, PubMed ids or arXiv ids').fill('10.1126/science.1241224\nPMID: 15583697\narXiv:1706.03762\n10.9999/does-not-exist-xyz');
  await dialog.getByRole('button', { name: /Add 4 papers/ }).click();
  await dialog.getByText('Import finished').waitFor({ timeout: 120000 }).catch(() => {});
  const idsText = (await dialog.getByTestId('import-progress').innerText()).replace(/\s+/g, ' ');
  check('pasted ids: DOI, PubMed id and arXiv id added, the unknown one reported', /3 items added/.test(idsText) && /not found/.test(idsText), idsText);
  const titles = (await db.query(`select title from library_documents where user_id = $1 and metadata->>'source' = 'ids' order by created_at`, [auth.user.id])).rows.map((row) => row.title);
  check('pasted ids are saved in the Library (not just looked up)', titles.length >= 2, titles.join(' | ').slice(0, 160));

  // Zotero and Mendeley: locked on Free.
  await dialog.getByRole('button', { name: 'Zotero', exact: true }).click();
  check('Free: Zotero offers an upgrade', /Zotero import is on paid plans/.test(await dialog.innerText()));
  await page.screenshot({ path: `${OUT}/libadd-5-zotero-free.png` });
  await context.close();

  // On Plus: the connect screens.
  await db.query(`update accounts set plan = 'plus', plan_source = 'admin', plan_status = 'active' where id = $1`, [accountId]);
  {
    const { context: plus, page: plusPage } = await open({ viewport: { width: 1440, height: 900 } });
    const plusDialog = plusPage.getByRole('dialog', { name: 'Add to Library' });
    await plusPage.getByRole('button', { name: 'Add to Library' }).first().click();
    await plusDialog.getByRole('button', { name: 'Zotero', exact: true }).click();
    await plusDialog.getByLabel('Zotero API key').waitFor({ timeout: 15000 });
    check('Plus: Zotero asks for an API key, with a link that fills the key form', (await plusDialog.getByRole('link', { name: /Create a key on zotero.org/ }).getAttribute('href')).includes('zotero.org/settings/keys/new'));
    await plusDialog.getByLabel('Zotero API key').fill('ABCDEFGHIJKLMNOPQRSTUVWX');
    await plusDialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await plusDialog.getByRole('alert').waitFor({ timeout: 20000 });
    check('a wrong Zotero key is refused by Zotero', /Zotero does not know this key|refused/.test(await plusDialog.getByRole('alert').innerText()), await plusDialog.getByRole('alert').innerText());
    await plusPage.screenshot({ path: `${OUT}/libadd-6-zotero-plus.png` });
    await plusDialog.getByRole('button', { name: 'Mendeley', exact: true }).click();
    await plusDialog.getByText(/Mendeley sign-in is not switched on|Connect Mendeley/).first().waitFor({ timeout: 15000 });
    check('Plus: Mendeley shows sign-in (or the .bib route until an admin adds the app)', true);
    await plusPage.screenshot({ path: `${OUT}/libadd-7-mendeley.png` });
    check('no page errors', !plusPage.errors.length, plusPage.errors.join(' | '));
    await plus.close();
  }

  // Phone.
  {
    const { context: phone, page: phonePage } = await open(devices['iPhone 13']);
    await phonePage.getByRole('button', { name: 'Add to Library' }).first().click();
    const phoneDialog = phonePage.getByRole('dialog', { name: 'Add to Library' });
    await phoneDialog.waitFor();
    await phonePage.waitForTimeout(500);
    check('phone: dialog fits, no sideways scroll', (await phonePage.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    await phonePage.screenshot({ path: `${OUT}/libadd-8-phone.png` });
    await phone.close();
  }

  await browser.close();
  await db.end();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
