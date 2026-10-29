// The toolbar, button by button, with the result each one promises checked in the document
// (bold wraps the text, Heading 2 turns the block into an h2, red text is red, …), then every
// dropdown's items listed. Secure context via localproxy.cjs. Writes /shots/tb-*.png.
//   node localproxy.cjs & sleep 1; BASE=http://localhost:8080 node audit-toolbar.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';

const text = (t, styles = {}) => ({ type: 'text', text: t, styles });
const block = (type, content, props = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });
const SAMPLE = [
  block('heading', [text('Toolbar audit')], { level: 1 }),
  block('paragraph', [text('Alpha beta gamma delta. '), text('Bold words', { bold: true }), text(' and more text for the audit.')]),
  block('paragraph', [text('Second paragraph with enough words to select and format.')]),
];

(async () => {
  const auth = await signIn(BASE, 'tb');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addInitScript(([t, u]) => {
    localStorage.setItem('videmak_token', JSON.stringify(t));
    localStorage.setItem('videmak_user', JSON.stringify(u));
    window.__printed = 0;
    window.print = () => { window.__printed += 1; };
  }, [auth.token, auth.user]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  const log = (line) => console.log(line);

  const fresh = async () => {
    const id = crypto.randomUUID();
    await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Toolbar audit', blocks: SAMPLE }) });
    await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.bn-editor').waitFor({ timeout: 30000 });
    await page.waitForTimeout(2000);
  };
  // Selects `from`..`to` characters of the paragraph containing `needle`.
  const select = (needle, from, to) => page.evaluate(([n, a, b]) => {
    const el = [...document.querySelectorAll('.bn-block-content')].find((node) => node.textContent.includes(n));
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
  const selectBetaGamma = async () => { await select('Alpha beta', 6, 16); await page.waitForTimeout(250); };
  const caretIn = async (needle) => { await select(needle, 3, 3); await page.waitForTimeout(250); };
  const tool = (label) => page.locator(`[data-testid="editor-toolbar-row"] button[aria-label^="${label}"]`).first();
  const pick = async (name) => {
    const option = page.locator('button:visible, [role="option"]:visible, [role="menuitem"]:visible', { hasText: name }).last();
    await option.click();
    await page.waitForTimeout(400);
  };
  // What wraps the selected text: tags and inline styles from the text node up to its block.
  const marks = () => page.evaluate(() => {
    const sel = window.getSelection();
    let node = sel.anchorNode && (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode);
    const el = [...document.querySelectorAll('.bn-block-content')].find((n) => n.textContent.includes('Alpha beta'));
    const target = el && [...el.querySelectorAll('*')].find((n) => n.textContent === 'beta gamma') || node;
    const out = [];
    let cur = target;
    while (cur && !cur.classList?.contains('bn-block-content')) {
      const style = cur.getAttribute && cur.getAttribute('style');
      out.push(cur.tagName.toLowerCase() + (style ? `[${style}]` : '') + (cur.getAttribute?.('href') ? `[href=${cur.getAttribute('href')}]` : ''));
      cur = cur.parentElement;
    }
    const blockEl = el && el.closest('.bn-block-content');
    return { inline: out.join(' < '), block: blockEl ? `${blockEl.getAttribute('data-content-type')}${blockEl.getAttribute('data-text-alignment') ? ' align=' + blockEl.getAttribute('data-text-alignment') : ''}${blockEl.getAttribute('style') ? ' ' + blockEl.getAttribute('style') : ''}` : '' };
  });
  const blockOf = (needle) => page.evaluate((n) => {
    const el = [...document.querySelectorAll('.bn-block-content')].find((node) => node.textContent.includes(n));
    if (!el) return 'missing';
    const level = el.getAttribute('data-level');
    const outer = el.closest('.bn-block-outer');
    const depth = outer ? outer.querySelectorAll(':scope').length && (function d(x) { let k = 0; while ((x = x.parentElement?.closest('.bn-block-outer'))) k += 1; return k; })(outer) : 0;
    const inner = el.querySelector('[style]');
    return `${el.getAttribute('data-content-type')}${level ? ' h' + level : ''}${el.getAttribute('data-text-alignment') ? ' align=' + el.getAttribute('data-text-alignment') : ''} depth=${depth}${el.getAttribute('style') ? ' style=' + el.getAttribute('style') : ''}${inner ? ' inner=' + inner.getAttribute('style') : ''}`;
  }, needle);

  await fresh();
  const check = async (name, fn) => {
    try { log(`${name}: ${await fn()}`); } catch (error) { log(`${name}: ERROR ${error.message.split('\n')[0].slice(0, 160)}`); }
    for (let i = 0; i < 2; i += 1) await page.keyboard.press('Escape');
  };

  // Inline formats, then Undo and Redo from the toolbar.
  for (const label of ['Bold', 'Italic', 'Underline', 'Strikethrough']) {
    await check(label, async () => {
      await selectBetaGamma();
      await tool(label).click();
      await page.waitForTimeout(300);
      const on = (await marks()).inline;
      await tool('Undo').click();
      await page.waitForTimeout(300);
      const undone = (await marks()).inline;
      await tool('Redo').click();
      await page.waitForTimeout(300);
      const redone = (await marks()).inline;
      await tool('Undo').click();
      return `on: ${on} | after Undo: ${undone} | after Redo: ${redone}`;
    });
  }
  await check('Styles › Heading 2', async () => {
    await caretIn('Second paragraph');
    await tool('Styles').click();
    await page.waitForTimeout(300);
    const options = await page.locator('button:visible').evaluateAll((nodes) => nodes.filter((n) => n.closest('[style*="position: fixed"]')).map((n) => n.textContent.trim().slice(0, 20)));
    await pick('Heading 2');
    return `options [${options.join(', ')}] → ${await blockOf('Second paragraph')}`;
  });
  await page.keyboard.press('Control+z');
  await check('Font › Arial', async () => {
    await selectBetaGamma();
    await tool('Font').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/tb-font.png` });
    await pick('Arial');
    return (await marks()).inline;
  });
  await check('Font size › 18', async () => {
    await selectBetaGamma();
    await tool('Font size').click();
    await page.waitForTimeout(300);
    await pick('18');
    return (await marks()).inline;
  });
  await check('Increase font size', async () => {
    await selectBetaGamma();
    await tool('Increase font size').click();
    await page.waitForTimeout(300);
    return (await marks()).inline;
  });
  await check('Decrease font size', async () => {
    await selectBetaGamma();
    await tool('Decrease font size').click();
    await tool('Decrease font size').click();
    await page.waitForTimeout(300);
    return (await marks()).inline;
  });
  await check('Text color', async () => {
    await selectBetaGamma();
    await tool('Text color').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/tb-text-color.png` });
    const swatch = page.locator('button[aria-label*="red" i]:visible, button[title*="red" i]:visible').first();
    if (!(await swatch.count())) return 'no red swatch found';
    await swatch.click();
    await page.waitForTimeout(300);
    return (await marks()).inline;
  });
  await check('Highlight color', async () => {
    await selectBetaGamma();
    await tool('Highlight color').click();
    await page.waitForTimeout(300);
    const swatch = page.locator('button[aria-label*="yellow" i]:visible, button[title*="yellow" i]:visible').first();
    if (!(await swatch.count())) return 'no yellow swatch found';
    await swatch.click();
    await page.waitForTimeout(300);
    return (await marks()).inline;
  });
  await check('Clear formatting', async () => {
    await selectBetaGamma();
    await tool('Clear formatting').click();
    await page.waitForTimeout(300);
    return `beta gamma now: ${(await marks()).inline}`;
  });
  await check('Insert link', async () => {
    await selectBetaGamma();
    await tool('Insert link').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/tb-link.png` });
    const input = page.locator('input:visible[placeholder*="http" i], input:visible[aria-label*="link" i], input:visible[placeholder*="link" i]').first();
    if (!(await input.count())) return 'no link input';
    await input.fill('https://example.org/paper');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    return (await marks()).inline;
  });
  await check('Superscript (More text formats)', async () => {
    await selectBetaGamma();
    await tool('More text formats').click();
    await page.waitForTimeout(300);
    const items = await page.locator('button:visible').evaluateAll((nodes) => nodes.filter((n) => n.closest('[style*="position: fixed"]')).map((n) => n.textContent.trim().slice(0, 24)));
    const sup = page.locator('button:visible', { hasText: /Superscript/ }).last();
    if (await sup.count()) { await sup.click(); await page.waitForTimeout(300); }
    return `items [${items.join(', ')}] → ${(await marks()).inline}`;
  });
  await check('Align › Center', async () => {
    await caretIn('Second paragraph');
    await tool('Align and indent').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/tb-align.png` });
    const center = page.locator('button:visible[aria-label*="Center" i], button:visible[title*="Center" i], button:visible:has-text("Center")').last();
    await center.click();
    await page.waitForTimeout(300);
    return blockOf('Second paragraph');
  });
  await check('Line spacing › Double', async () => {
    await caretIn('Second paragraph');
    await tool('Line and paragraph spacing').click();
    await page.waitForTimeout(300);
    const items = await page.locator('button:visible').evaluateAll((nodes) => nodes.filter((n) => n.closest('[style*="position: fixed"]')).map((n) => n.textContent.trim().slice(0, 24)));
    await page.screenshot({ path: `${OUT}/tb-spacing.png` });
    const dbl = page.locator('button:visible', { hasText: /^(\s*)?(Double|2(\.0)?)\s*$/ }).last();
    if (await dbl.count()) { await dbl.click(); await page.waitForTimeout(300); }
    return `items [${items.join(', ')}] → ${await blockOf('Second paragraph')}`;
  });
  for (const [label, expect] of [['Bulleted list', 'bulletListItem'], ['Numbered list', 'numberedListItem'], ['Checklist', 'checkListItem']]) {
    await check(label, async () => {
      await caretIn('Second paragraph');
      await page.locator(`[data-testid="editor-toolbar-row"] button[aria-label="${label}"]`).click();
      await page.waitForTimeout(300);
      const after = await blockOf('Second paragraph');
      await page.locator(`[data-testid="editor-toolbar-row"] button[aria-label="${label}"]`).click();
      await page.waitForTimeout(300);
      return `${after.startsWith(expect) ? 'OK ' : 'WRONG '}${after} | clicked again → ${await blockOf('Second paragraph')}`;
    });
  }
  for (const label of ['Bulleted list options', 'Numbered list options', 'Checklist options']) {
    await check(label, async () => {
      await caretIn('Second paragraph');
      await page.locator(`[data-testid="editor-toolbar-row"] button[aria-label="${label}"]`).click();
      await page.waitForTimeout(300);
      const items = await page.locator('button:visible').evaluateAll((nodes) => nodes.filter((n) => n.closest('[style*="position: fixed"]')).map((n) => n.textContent.trim().slice(0, 30)));
      return `items [${items.join(', ')}]`;
    });
  }
  await check('Increase / Decrease indent', async () => {
    await caretIn('Second paragraph');
    await tool('Increase indent').click();
    await page.waitForTimeout(300);
    const more = await blockOf('Second paragraph');
    await tool('Decrease indent').click();
    await page.waitForTimeout(300);
    return `increase → ${more} | decrease → ${await blockOf('Second paragraph')}`;
  });
  await check('Paint format', async () => {
    await select('Bold words', 26, 28);
    await tool('Paint format').click();
    await page.waitForTimeout(200);
    await select('Second paragraph', 0, 6);
    await page.mouse.up();
    await page.waitForTimeout(400);
    return page.evaluate(() => [...document.querySelectorAll('.bn-block-content')].find((n) => n.textContent.includes('Second paragraph')).innerHTML.slice(0, 160));
  });
  await check('Editing mode', async () => {
    await tool('Editing mode').click();
    await page.waitForTimeout(300);
    await pick('Suggesting');
    await caretIn('Second paragraph');
    await page.keyboard.type('XYZ');
    await page.waitForTimeout(400);
    const suggested = await page.locator('ins.ce-suggest-insert, ins').count();
    await tool('Editing mode').click();
    await pick('Editing');
    return `typed in Suggesting → ${suggested} insertion mark(s)`;
  });
  await check('Print', async () => { await tool('Print').click(); await page.waitForTimeout(300); return `print called ${await page.evaluate(() => window.__printed)} time(s)`; });
  await check('Spelling', async () => {
    const before = await page.locator('.bn-editor').getAttribute('spellcheck');
    await tool('Spelling and grammar').click();
    await page.waitForTimeout(300);
    return `${before} → ${await page.locator('.bn-editor').getAttribute('spellcheck')}`;
  });
  await check('Zoom › 150%', async () => {
    await tool('Zoom').click();
    await page.waitForTimeout(300);
    await pick('150%');
    return page.locator('button', { hasText: /\d+%/ }).last().innerText();
  });
  await check('Add comment', async () => {
    await selectBetaGamma();
    await tool('Add comment').click();
    await page.waitForTimeout(500);
    return `panel: ${await page.locator('.ce-assistant-panel h2:visible').innerText().catch(() => 'none')} | focus: ${await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName)}`;
  });
  await check('Insert a citation', async () => {
    await caretIn('Second paragraph');
    await tool('Insert a citation').click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/tb-cite.png` });
    return `citation menu items: ${await page.locator('.bn-suggestion-menu-item:visible, [role="option"]:visible').count()}`;
  });
  await check('Insert equation (Σ)', async () => {
    await caretIn('Second paragraph');
    await tool('Insert equation').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/tb-equation.png` });
    const input = page.locator('input:visible[aria-label*="TeX" i], textarea:visible').first();
    if (!(await input.count())) return 'no TeX input';
    await input.fill('E = mc^2');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    return `katex nodes in text: ${await page.locator('.bn-editor .katex').count()}`;
  });
  await check('Insert image › By URL', async () => {
    await caretIn('Second paragraph');
    await tool('Insert image').click();
    await page.waitForTimeout(300);
    const items = await page.locator('button:visible').evaluateAll((nodes) => nodes.filter((n) => n.closest('[style*="position: fixed"]')).map((n) => n.textContent.trim()));
    return `items [${items.join(', ')}]`;
  });
  await check('Search menus', async () => {
    await page.locator('[data-testid="editor-toolbar-row"] button[aria-label^="Search menus"]').click();
    await page.waitForTimeout(300);
    await page.keyboard.type('word count');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/tb-search.png` });
    const hit = page.locator('button:visible', { hasText: 'Word count' }).last();
    if (!(await hit.count())) return 'no result';
    await hit.click();
    await page.waitForTimeout(400);
    return `dialog: ${await page.locator('[role="dialog"]').getAttribute('aria-label').catch(() => 'none')}`;
  });
  await page.screenshot({ path: `${OUT}/tb-final.png` });
  log(`errors ${JSON.stringify(errors)}`);
  await browser.close();
})();
