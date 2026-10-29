// Second toolbar pass: the results read from computed styles (font size, colours, link, line
// spacing, space before, indent, superscript), the overflowed tools, and the citation, equation
// and image inserts. Secure context via localproxy.cjs. Writes /shots/tb2-*.png.
//   node localproxy.cjs & sleep 1; BASE=http://localhost:8080 node audit-toolbar2.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';

const text = (t, styles = {}) => ({ type: 'text', text: t, styles });
const block = (type, content, props = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });
const SAMPLE = [
  block('heading', [text('Toolbar audit two')], { level: 1 }),
  block('paragraph', [text('Alpha beta gamma delta and more text for the audit.')]),
  block('paragraph', [text('Second paragraph with enough words to select and format.')]),
  block('bulletListItem', [text('First bullet item')]),
  block('bulletListItem', [text('Second bullet item')]),
  block('paragraph', [text('Closing paragraph for inserts.')]),
];

(async () => {
  const auth = await signIn(BASE, 'tb2');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  const log = (line) => console.log(line);
  const id = crypto.randomUUID();
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Toolbar audit two', blocks: SAMPLE }) });
  await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.bn-editor').waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);

  const select = (needle, from, to) => page.evaluate(([n, a, b]) => {
    const el = [...document.querySelectorAll('.bn-block-content')].find((node) => node.textContent.includes(n));
    if (!el) throw new Error(`no block with "${n}"`);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let offset = 0; let start = null; let end = null; let node;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (!start && a <= offset + len) start = [node, a - offset];
      if (!end && b <= offset + len) { end = [node, b - offset]; break; }
      offset += len;
    }
    const range = document.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.querySelector('.bn-editor').focus();
  }, [needle, from, to]);
  // Computed look of the text at `needle` (its first character) and of its block.
  const look = (needle) => page.evaluate((n) => {
    const el = [...document.querySelectorAll('.bn-block-content')].find((node) => node.textContent.includes(n));
    if (!el) return 'missing';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && !node.textContent.includes(n.slice(0, 4)));
    const span = node ? node.parentElement : el;
    const cs = getComputedStyle(span);
    const outer = el.closest('.bn-block');
    const bs = getComputedStyle(outer || el);
    const link = span.closest('a');
    return `font ${cs.fontFamily.split(',')[0]} ${cs.fontSize} color ${cs.color} bg ${cs.backgroundColor} va ${cs.verticalAlign}${link ? ' link ' + link.getAttribute('href') : ''} | block ${el.getAttribute('data-content-type')} line-height ${getComputedStyle(el).lineHeight} margin-top ${bs.marginTop} padding-left ${bs.paddingLeft} nested ${Boolean(el.closest('.bn-block-group .bn-block-group'))}`;
  }, needle);
  const tool = async (label) => {
    let button = page.locator(`[data-testid="editor-toolbar-row"] button[aria-label^="${label}"]:visible`).first();
    if (!(await button.count())) {
      const more = page.locator('button[aria-label="More tools"]:visible');
      if (await more.count()) { await more.click(); await page.waitForTimeout(300); }
      button = page.locator(`button[aria-label^="${label}"]:visible`).first();
    }
    return button;
  };
  const check = async (name, fn) => {
    try { log(`${name}: ${await fn()}`); } catch (error) { log(`${name}: ERROR ${error.message.split('\n')[0].slice(0, 180)}`); }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  };

  log(`start: ${await look('beta gamma')}`);
  await check('Font size 18', async () => { await select('Alpha beta', 6, 16); await (await tool('Font size')).click(); await page.waitForTimeout(300); await page.locator('button:visible', { hasText: /^18$/ }).last().click(); await page.waitForTimeout(300); return look('beta gamma'); });
  await check('Text color Red', async () => { await select('Alpha beta', 6, 16); await (await tool('Text color')).click(); await page.waitForTimeout(300); await page.locator('button[aria-label="red"]:visible, button[aria-label="Red"]:visible').first().click(); await page.waitForTimeout(300); return look('beta gamma'); });
  await check('Link', async () => {
    await select('Alpha beta', 6, 16);
    await (await tool('Insert link')).click();
    await page.waitForTimeout(400);
    await page.locator('input:visible').filter({ hasNot: page.locator('xx') }).evaluateAll((inputs) => inputs.map((i) => i.value));
    const url = page.locator('input:visible[value^="https://"], input:visible[placeholder*="https" i]').first();
    await url.fill('https://example.org/paper');
    await page.locator('button:visible', { hasText: /^Apply$/ }).last().click();
    await page.waitForTimeout(400);
    return look('beta gamma');
  });
  await check('Superscript', async () => {
    await select('Alpha beta', 0, 5);
    await (await tool('More text formats')).click();
    await page.waitForTimeout(300);
    const labels = await page.locator('button:visible').evaluateAll((nodes) => nodes.filter((n) => n.closest('[style*="position: fixed"]')).map((n) => n.getAttribute('aria-label') || n.textContent.trim()).slice(0, 6));
    await page.locator('button[aria-label^="Superscript"]:visible').first().click();
    await page.waitForTimeout(300);
    return `items [${labels.join(', ')}] → ${await look('Alpha')}`;
  });
  await check('Line spacing Double (cursor only)', async () => {
    await select('Second paragraph', 3, 3);
    await (await tool('Line and paragraph spacing')).click();
    await page.waitForTimeout(300);
    await page.locator('button:visible', { has: page.locator('span:text-is("Double")') }).last().click();
    await page.waitForTimeout(300);
    return look('Second paragraph');
  });
  await check('Space before', async () => {
    await select('Second paragraph', 3, 3);
    await (await tool('Line and paragraph spacing')).click();
    await page.waitForTimeout(300);
    await page.locator('button:visible', { has: page.locator('span:text-is("Add space before paragraph")') }).last().click();
    await page.waitForTimeout(300);
    const on = await look('Second paragraph');
    await (await tool('Line and paragraph spacing')).click();
    await page.waitForTimeout(300);
    const label = await page.locator('button:visible', { has: page.locator('span:text-is("Remove space before paragraph")') }).count();
    await page.keyboard.press('Escape');
    return `${on} | menu now offers "Remove space before": ${label > 0}`;
  });
  await check('Indent first paragraph', async () => {
    await select('Alpha beta', 2, 2);
    await (await tool('Increase indent')).click();
    await page.waitForTimeout(300);
    const one = await look('Alpha beta');
    await (await tool('Decrease indent')).click();
    await page.waitForTimeout(300);
    return `increase → ${one} || decrease → ${await look('Alpha beta')}`;
  });
  await check('Indent bullet', async () => {
    await select('Second bullet', 2, 2);
    await (await tool('Increase indent')).click();
    await page.waitForTimeout(300);
    const one = await look('Second bullet');
    await (await tool('Decrease indent')).click();
    await page.waitForTimeout(300);
    return `increase → ${one} || decrease → ${await look('Second bullet')}`;
  });
  await check('Spelling (overflow)', async () => {
    const before = await page.locator('.bn-editor').getAttribute('spellcheck');
    await (await tool('Spelling and grammar')).click();
    await page.waitForTimeout(300);
    const after = await page.locator('.bn-editor').getAttribute('spellcheck');
    await (await tool('Spelling and grammar')).click();
    return `${before} → ${after}`;
  });
  await page.screenshot({ path: `${OUT}/tb2-formats.png` });
  await check('Cite button', async () => {
    await select('Closing paragraph', 7, 7);
    await (await tool('Insert a citation')).click();
    await page.waitForTimeout(800);
    await page.keyboard.type('sleep memory');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/tb2-cite-menu.png` });
    const items = page.locator('.bn-suggestion-menu-item:visible, [role="option"]:visible');
    const n = await items.count();
    if (!n) return 'no citation results';
    const first = (await items.first().innerText()).replace(/\s+/g, ' ').slice(0, 80);
    await items.first().click();
    await page.waitForTimeout(1500);
    return `${n} results, picked "${first}" → citations in text: ${await page.locator('[data-inline-content-type="aiCitation"]').count()}, References heading: ${await page.locator('h1, h2, h3', { hasText: /^References$/ }).count()}`;
  });
  await check('Inline equation (Σ)', async () => {
    await select('Closing paragraph', 0, 0);
    await (await tool('Insert equation')).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/tb2-equation-input.png` });
    const input = page.locator('input:visible[aria-label="TeX"], input:visible[placeholder*="TeX" i], textarea:visible').first();
    await input.fill('E = mc^2');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    return `katex in text: ${await page.locator('.bn-editor .katex').count()}`;
  });
  await check('Image by URL', async () => {
    await select('Closing paragraph', 3, 3);
    await (await tool('Insert image')).click();
    await page.waitForTimeout(300);
    await page.locator('button:visible', { has: page.locator('span:text-is("By URL")') }).last().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/tb2-image-url.png` });
    const input = page.locator('[role="dialog"] input:visible, input:visible[placeholder^="https"]').first();
    await input.fill(`${BASE}/icon.svg`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    return `images in doc: ${await page.locator('.bn-editor img').count()}`;
  });
  await check('Image upload', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGP4z8CAB+GTG8HSALfKY52fTcuYAAAAAElFTkSuQmCC', 'base64');
    await select('Closing paragraph', 3, 3);
    await (await tool('Insert image')).click();
    await page.waitForTimeout(300);
    const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('button:visible', { has: page.locator('span:text-is("Upload from computer")') }).last().click();
    await (await chooser).setFiles({ name: 'red.png', mimeType: 'image/png', buffer: png });
    await page.waitForTimeout(3000);
    const srcs = await page.locator('.bn-editor img').evaluateAll((imgs) => imgs.map((i) => `${i.getAttribute('src').slice(0, 60)} (${i.naturalWidth}px)`));
    return `images: ${srcs.join(' ; ')}`;
  });
  await page.screenshot({ path: `${OUT}/tb2-final.png`, fullPage: false });
  log(`errors ${JSON.stringify(errors)}`);
  await browser.close();
})();
