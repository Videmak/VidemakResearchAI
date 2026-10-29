// Exports a document that uses every editor feature through File › Download Word / PDF /
// LaTeX / text (the buttons people use), after setting Page setup (running head, page numbers)
// and adding a comment and a tracked change in the UI. Files land in /shots/export/ for the
// Word (OpenXML), PDF and LaTeX checks. Secure context via localproxy.cjs.
//   node localproxy.cjs & sleep 1; BASE=http://localhost:8080 node audit-exports.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = `${process.env.OUT || '/shots'}/export`;
fs.mkdirSync(OUT, { recursive: true });

const text = (value, styles = {}) => ({ type: 'text', text: value, styles });
const block = (type, content = [], props = {}, children = []) => ({ id: crypto.randomUUID(), type, props, content, children });
const cite = (bibtex, shown) => ({ type: 'aiCitation', props: { citationId: crypto.randomUUID(), base64: Buffer.from(bibtex).toString('base64'), displayText: shown, bibliography: '', style: 'apa', url: '' } });
const cell = (content, props = {}) => ({ type: 'tableCell', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left', colspan: 1, rowspan: 1, ...props }, content });
const WALKER = '@article{walker2005,\n  title={Sleep, Memory, and Plasticity},\n  author={Walker, Matthew P. and Stickgold, Robert},\n  journal={Annual Review of Psychology},\n  volume={57},\n  pages={139--166},\n  year={2005},\n  doi={10.1146/annurev.psych.56.091103.070307}\n}';
const RASCH = "@article{rasch2013,\n  title={About Sleep's Role in Memory},\n  author={Rasch, Bj{\\\"o}rn and Born, Jan},\n  journal={Physiological Reviews},\n  volume={93},\n  number={2},\n  pages={681--766},\n  year={2013},\n  doi={10.1152/physrev.00032.2012}\n}";
// A 240×120 PNG bar chart, encoded here (zlib + CRC) so the test needs no image files.
function chartPng(width = 240, height = 120) {
  const zlib = require('zlib');
  const rows = [];
  const bars = [[20, 70], [80, 40], [140, 95], [200, 60]];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3, 255);
    row[0] = 0;
    for (const [x0, h] of bars) {
      if (y < height - h) continue;
      for (let x = x0; x < x0 + 30; x += 1) row.set([37, 99, 235], 1 + x * 3);
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = chartPng();

(async () => {
  const auth = await signIn(BASE, 'export');
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'chart.png');
  const asset = await (await fetch(`${BASE}/api/ai-editor/assets`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` }, body: form })).json();
  console.log('uploaded image asset:', asset.url);

  const blocks = [
    block('heading', [text('Sleep and Memory in University Students')], { level: 1, wordStyle: 'Title' }),
    block('heading', [text('Introduction')], { level: 1 }),
    block('paragraph', [
      text('Sleep is no longer viewed as a passive state. '), text('Bold', { bold: true }), text(', '), text('italic', { italic: true }), text(', '),
      text('underlined', { underline: true }), text(', '), text('struck', { strike: true }), text(', '), text('red', { textColor: '#C01C28' }), text(', '),
      text('highlighted', { backgroundColor: '#FFFF00' }), text(', '), text('Arial 14', { fontFamily: 'Arial', fontSize: '14pt' }), text(', x'), text('2', { superscript: true }),
      text(', H'), text('2', { subscript: true }), text('O and '), { type: 'link', href: 'https://example.org/sleep', content: [text('a link')] },
      text('. Slow-wave sleep supports consolidation '), cite(WALKER, '(Walker & Stickgold, 2005)'), text(' and replay '), cite(RASCH, '(Rasch & Born, 2013)'),
      text('. A footnote'), { type: 'footnote', props: { text: 'Defined as at least 7 hours per night.', kind: 'footnote' } },
      text(' and inline math '), { type: 'aiMath', props: { latex: '\\frac{a}{b}', displayMode: 'false' } }, text('. Kept '),
      text('inserted', { suggestionInsert: '1|Ada Lovelace|' }), text(' and '), text('deleted ', { suggestionDelete: '2|Ada Lovelace|' }), text('words.'),
    ], { textAlignment: 'justify', lineSpacing: '2', indentFirst: '36' }),
    block('paragraph', [text('Indented paragraph with space before.')], { indentLeft: '36', spaceBefore: '12' }),
    block('heading', [text('Methods')], { level: 2 }),
    block('bulletListItem', [text('First bullet')], {}, [block('bulletListItem', [text('Nested bullet')], {}, [block('numberedListItem', [text('Nested number')])])]),
    block('bulletListItem', [text('Second bullet')]),
    block('numberedListItem', [text('Step one')]),
    block('numberedListItem', [text('Step two')]),
    block('checkListItem', [text('Ethics approved')], { checked: true }),
    block('checkListItem', [text('Data collected')], { checked: false }),
    block('quote', [text('“Sleep is the golden chain that ties health and our bodies together.”')]),
    block('codeBlock', [text('mean_sleep <- mean(df$hours)\nprint(mean_sleep)')], { language: 'r' }),
    block('equation', [], { latex: '\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i' }),
    block('paragraph', [text('Table 1', { bold: true })]),
    block('paragraph', [text('Participant characteristics', { italic: true })]),
    { id: crypto.randomUUID(), type: 'table', props: { textColor: 'default' }, content: { type: 'tableContent', headerRows: 1, columnWidths: [160, 120, 120, 90], rows: [
      { cells: [cell([text('Group')], { backgroundColor: '#D9E2F3' }), cell([text('Measure')], { colspan: 2 }), cell([text('n')], { textAlignment: 'center' })] },
      { cells: [cell([text('Students')], { rowspan: 2 }), cell([text('Sleep (h)')]), cell([text('6.4')]), cell([text('120')])] },
      { cells: [cell([text('GPA')]), cell([text('3.1')]), cell([text('118')])] },
      { cells: [cell([text('Staff')]), cell([text('Sleep (h)')]), cell([text('7.1')]), cell([text('40')])] },
    ] }, children: [] },
    block('image', [], { url: asset.url, caption: 'Figure 1. Mean sleep by group.', previewWidth: 360, name: 'chart.png' }),
    block('divider'),
    block('pageBreak'),
    block('tableOfContents'),
    block('heading', [text('Discussion')], { level: 1 }),
    block('paragraph', [text('Short sleep was associated with lower grades.')]),
  ];
  const id = crypto.randomUUID();
  const created = await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Sleep and Memory in University Students', blocks }) });
  console.log('document created:', created.status);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('response', (r) => { if (/word\/export|convert/.test(r.url())) console.log('export call', r.status(), r.url().replace(BASE, '')); });
  await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.bn-editor').waitFor({ timeout: 30000 }).catch(async () => {
    await page.screenshot({ path: `${OUT}/editor-failed.png` });
    console.log('EDITOR DID NOT OPEN. errors:', JSON.stringify(errors), '| page text:', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300));
    process.exit(1);
  });
  await page.waitForTimeout(3000);
  console.log('citations rendered:', await page.locator('[data-inline-content-type="aiCitation"]').count(), '| References heading:', await page.locator('h1,h2,h3', { hasText: /^References$/ }).count(), '| katex:', await page.locator('.bn-editor .katex').count(), '| tables:', await page.locator('.bn-editor table').count(), '| images:', await page.locator('.bn-editor img').count());
  await page.screenshot({ path: `${OUT}/editor-top.png` });

  // A comment on "Short sleep".
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.bn-block-content')].find((n) => n.textContent.startsWith('Short sleep'));
    const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 11);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    document.querySelector('.bn-editor').focus();
  });
  await page.keyboard.press('Control+Alt+m');
  await page.waitForTimeout(800);
  const box = page.locator('[aria-label="New comment"]:visible').first();
  if (await box.count()) {
    await box.click();
    await page.keyboard.type('Report the effect size here.');
    await page.waitForTimeout(300);
    await page.locator('.ce-assistant-panel button:visible', { hasText: /^Comment$/ }).click();
    await page.waitForTimeout(2500);
  } else console.log('no New comment box');
  console.log('comments in panel:', await page.locator('.ce-assistant-panel').innerText().then((t) => (t.match(/Report the effect size/g) || []).length).catch(() => 0));
  await page.keyboard.press('Escape');

  // Page setup: running head and page numbers (the dialog says they go into the Word and PDF files).
  await page.locator('header').getByRole('button', { name: 'File', exact: true }).click();
  await page.locator('button:visible', { has: page.locator('span:text-is("Page setup")') }).click();
  const dialog = page.locator('[role="dialog"][aria-label="Page setup"]');
  await dialog.waitFor();
  await dialog.locator('input[placeholder^="e.g. Running head"]').fill('SLEEP AND MEMORY');
  const numbers = dialog.locator('select').last();
  const numberOptions = await numbers.locator('option').allInnerTexts();
  await numbers.selectOption({ index: Math.min(1, numberOptions.length - 1) });
  console.log('page number options:', JSON.stringify(numberOptions));
  await page.screenshot({ path: `${OUT}/page-setup.png` });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1500);

  const download = async (label, file) => {
    await page.locator('header').getByRole('button', { name: 'File', exact: true }).click();
    await page.waitForTimeout(200);
    const waiting = page.waitForEvent('download', { timeout: 120000 });
    const t0 = Date.now();
    await page.locator('button:visible', { has: page.locator(`span:text-is("${label}")`) }).click();
    const result = await waiting;
    await result.saveAs(`${OUT}/${file}`);
    console.log(`${label}: ${result.suggestedFilename()} → ${file}, ${fs.statSync(`${OUT}/${file}`).size} bytes in ${Date.now() - t0} ms`);
    await page.waitForTimeout(800);
  };
  await download('Download Word', 'audit.docx');
  await download('Download PDF', 'audit.pdf');
  await download('Download LaTeX', 'audit-latex.zip');
  await download('Download text', 'audit.txt');
  // The ⋯ menu's copies of the same commands.
  await page.locator('header button[aria-label="More"]').click();
  const waiting = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('button:visible', { hasText: 'Download Word' }).last().click();
  await (await waiting).saveAs(`${OUT}/audit-more-menu.docx`);
  console.log('⋯ › Download Word:', fs.statSync(`${OUT}/audit-more-menu.docx`).size, 'bytes');
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
