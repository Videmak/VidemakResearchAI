// In-document pop-ups: every "/" menu item inserts what it names, the block side menu (+, block
// menu, AI tools), the selection toolbar, and the pop-ups of citations, links, images, tables,
// equations and footnotes; comment threads (reply, resolve, delete). Writes /shots/pop-*.png.
//   node localproxy.cjs & sleep 1; BASE=http://localhost:8080 node audit-popups.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const PART = process.env.PART || 'all';

const text = (value, styles = {}) => ({ type: 'text', text: value, styles });
const block = (type, content = [], props = {}, children = []) => ({ id: crypto.randomUUID(), type, props, content, children });
const WALKER = '@article{walker2005,\n  title={Sleep, Memory, and Plasticity},\n  author={Walker, Matthew P. and Stickgold, Robert},\n  journal={Annual Review of Psychology},\n  volume={57},\n  pages={139--166},\n  year={2005},\n  doi={10.1146/annurev.psych.56.091103.070307}\n}';
const cell = (content) => ({ type: 'tableCell', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left', colspan: 1, rowspan: 1 }, content });

(async () => {
  const auth = await signIn(BASE, 'pop');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); window.open = (...a) => { window.__opened = (window.__opened || []).concat(String(a[0])); return null; }; }, [auth.token, auth.user]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  const log = (line) => console.log(line);
  const shot = (name) => page.screenshot({ path: `${OUT}/pop-${name}.png` });
  const open = async (blocks) => {
    const id = crypto.randomUUID();
    await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Pop-up audit', blocks }) });
    await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.bn-editor').waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
  };
  const types = () => page.evaluate(() => [...document.querySelectorAll('.bn-block-content')].map((n) => n.getAttribute('data-content-type')));
  const overlayButtons = () => page.evaluate(() => {
    const shown = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    return [...document.querySelectorAll('button, [role="menuitem"], [role="option"]')]
      .filter((b) => shown(b) && !b.closest('header, nav, aside, [data-testid="editor-toolbar-row"], .ce-assistant-panel'))
      .filter((b) => { let p = b; while (p && p !== document.body) { const s = getComputedStyle(p).position; if (s === 'fixed' || s === 'absolute') return true; p = p.parentElement; } return false; })
      .map((b) => (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30))
      .filter(Boolean);
  });
  const endOf = async (needle) => {
    await page.evaluate((n) => {
      const el = [...document.querySelectorAll('.bn-block-content')].find((node) => node.textContent.includes(n));
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let last = null; let node;
      while ((node = walker.nextNode())) last = node;
      const range = document.createRange();
      range.setStart(last, last.textContent.length);
      range.collapse(true);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      document.querySelector('.bn-editor').focus();
    }, needle);
    await page.waitForTimeout(200);
  };

  // 1. Every "/" menu item.
  if (PART === 'all' || PART === 'slash') {
    await open([block('paragraph', [text('Anchor paragraph for the slash menu.')])]);
    const titles = ['Heading 1', 'Heading 2', 'Heading 3', 'Quote', 'Toggle List', 'Numbered List', 'Bullet List', 'Check List', 'Paragraph', 'Code Block', 'Divider', 'Table', 'Image', 'Video', 'Audio', 'File', 'Toggle Heading 1', 'Heading 4', 'Emoji', 'Citation', 'Equation', 'Inline equation', 'Table of contents'];
    for (const title of titles) {
      await endOf('Anchor paragraph');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/');
      await page.waitForTimeout(250);
      await page.keyboard.type(title.toLowerCase());
      await page.waitForTimeout(400);
      const before = await types();
      const option = page.locator('.bn-suggestion-menu-item', { hasText: title }).first();
      if (!(await option.count())) { log(`/ ${title}: NOT IN MENU`); await page.keyboard.press('Escape'); continue; }
      await option.click();
      await page.waitForTimeout(700);
      const after = await types();
      const ui = await overlayButtons();
      log(`/ ${title}: blocks ${JSON.stringify(after.slice(1))}${ui.length ? ` | pop-up: ${ui.slice(0, 6).join(', ')}` : ''}`);
      if (['Image', 'Equation', 'Inline equation', 'Citation', 'Emoji', 'Table'].includes(title)) await shot(`slash-${title.replace(/\W+/g, '_')}`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      // Back to just the anchor paragraph.
      await page.evaluate(() => {
        const editor = document.querySelector('.bn-editor');
        editor.focus();
      });
      await open([block('paragraph', [text('Anchor paragraph for the slash menu.')])]);
    }
  }

  // 2. Block side menu, selection toolbar and the pop-ups of rich content.
  if (PART === 'all' || PART === 'blocks') {
    await open([
      block('paragraph', [text('First paragraph with a '), { type: 'link', href: 'https://example.org/sleep', content: [text('link to a page')] }, text(' and a citation '),
        { type: 'aiCitation', props: { citationId: 'w', base64: Buffer.from(WALKER).toString('base64'), displayText: '(Walker & Stickgold, 2005)', bibliography: '', style: 'apa', url: 'https://doi.org/10.1146/annurev.psych.56.091103.070307' } },
        text(' and a note'), { type: 'footnote', props: { text: 'Footnote text.', kind: 'footnote' } }, text(' and math '), { type: 'aiMath', props: { latex: 'a^2+b^2', displayMode: 'false' } }, text('.')]),
      block('paragraph', [text('Second paragraph to format with the selection toolbar.')]),
      block('equation', [], { latex: 'E = mc^2' }),
      { id: crypto.randomUUID(), type: 'table', props: { textColor: 'default' }, content: { type: 'tableContent', rows: [{ cells: [cell([text('A1')]), cell([text('B1')])] }, { cells: [cell([text('A2')]), cell([text('B2')])] }] }, children: [] },
      block('image', [], { url: `${BASE.replace('localhost:8080', 'localhost:8080')}/icon.svg`, caption: 'An icon', previewWidth: 160, name: 'icon.svg' }),
      block('paragraph', [text('Last paragraph.')]),
    ]);
    // Side menu.
    const second = page.locator('.bn-block-content', { hasText: 'Second paragraph' }).first();
    await second.hover();
    await page.waitForTimeout(500);
    const add = page.locator('button[aria-label="Add block"]:visible').first();
    const beforeAdd = (await types()).length;
    await add.click();
    await page.waitForTimeout(500);
    log(`side menu + : blocks ${beforeAdd} → ${(await types()).length} | slash menu open: ${await page.locator('.bn-suggestion-menu:visible').count()}`);
    await shot('side-add');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await second.hover();
    await page.waitForTimeout(400);
    await page.locator('button[aria-label="Open block menu"]:visible').first().click();
    await page.waitForTimeout(500);
    log(`block menu: ${(await overlayButtons()).join(' / ')}`);
    await shot('side-block-menu');
    await page.keyboard.press('Escape');
    await second.hover();
    await page.waitForTimeout(400);
    await page.locator('button[aria-label="AI tools for this paragraph"]:visible').first().click();
    await page.waitForTimeout(600);
    log(`AI tools: ${(await overlayButtons()).join(' / ')}`);
    await shot('side-ai-tools');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // Selection toolbar.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.bn-block-content')].find((n) => n.textContent.startsWith('Second paragraph'));
      const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 6);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      document.querySelector('.bn-editor').focus();
    });
    await page.waitForTimeout(600);
    const toolbar = page.locator('.bn-formatting-toolbar');
    log(`selection toolbar: ${await toolbar.isVisible()} | buttons: ${(await toolbar.locator('button').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label') || x.textContent.trim()))).join(', ')}`);
    for (const label of ['Bold', 'Italic', 'Underline', 'Strike', 'Align text center']) {
      await toolbar.locator(`button[aria-label="${label}"]`).click().catch((e) => log(`  ${label}: ${e.message.slice(0, 60)}`));
      await page.waitForTimeout(200);
    }
    log(`after selection toolbar: ${await page.locator('.bn-block-content', { hasText: 'Second paragraph' }).first().evaluate((el) => el.innerHTML.slice(0, 200))}`);
    await toolbar.locator('button[aria-label="Colors"]').click().catch(() => {});
    await page.waitForTimeout(400);
    await shot('selection-colors');
    log(`colors menu: ${(await overlayButtons()).slice(0, 12).join(' / ')}`);
    await page.keyboard.press('Escape');

    // Citation pop-up.
    await page.locator('[data-inline-content-type="aiCitation"]').first().click();
    await page.waitForTimeout(700);
    log(`citation pop-up: ${(await overlayButtons()).join(' / ')}`);
    await shot('citation');
    await page.keyboard.press('Escape');
    await page.mouse.click(10, 500);

    // Link pop-up.
    await page.locator('.bn-editor a', { hasText: 'link to a page' }).hover();
    await page.waitForTimeout(800);
    log(`link pop-up: ${(await overlayButtons()).join(' / ')}`);
    await shot('link');
    await page.mouse.move(10, 900);

    // Footnote, inline math, equation block.
    for (const [name, selector] of [['footnote', '[data-inline-content-type="footnote"]'], ['inline math', '[data-inline-content-type="aiMath"]'], ['equation block', '[data-content-type="equation"]']]) {
      await page.locator(selector).first().click().catch((e) => log(`${name}: click failed ${e.message.slice(0, 60)}`));
      await page.waitForTimeout(700);
      const inputs = await page.locator('input:visible, textarea:visible').evaluateAll((els) => els.filter((e) => !e.closest('header')).map((e) => (e.getAttribute('aria-label') || e.placeholder || e.tagName) + '=' + (e.value || '').slice(0, 30)));
      log(`${name}: inputs [${inputs.join(', ')}] | buttons: ${(await overlayButtons()).slice(0, 8).join(' / ')}`);
      await shot(name.replace(/\W+/g, '_'));
      await page.keyboard.press('Escape');
      await page.mouse.click(10, 500);
    }

    // Editing an equation that was in the document when it opened.
    await page.locator('.ce-equation-block').first().click();
    await page.waitForTimeout(600);
    const tex = page.locator('textarea:visible').first();
    if (await tex.count()) {
      await tex.fill('a^2 + b^2 = c^2');
      await page.locator('button:visible', { hasText: /^Done$/ }).click();
      await page.waitForTimeout(600);
      log(`equation edited: ${await page.locator('.ce-equation-block').first().getAttribute('data-latex')}`);
    } else log('equation edit: NO EDITOR');
    // Editing a footnote that was in the document when it opened.
    await page.locator('.ce-footnote').first().click();
    await page.waitForTimeout(400);
    log(`footnote editor: ${await page.locator('.ce-footnote-popover textarea').count() ? 'editable' : 'READ-ONLY'}`);
    await page.keyboard.press('Escape');
    // Table: click a cell, then the table handles / menu.
    await page.locator('td', { hasText: 'B2' }).first().click();
    await page.waitForTimeout(600);
    log(`table: buttons ${(await overlayButtons()).join(' / ')} | caret pill in table: ${await page.locator('button', { hasText: 'AI suggest' }).count()}`);
    await shot('table');
    // Image: click it.
    await page.locator('.bn-editor img').first().click();
    await page.waitForTimeout(600);
    log(`image: buttons ${(await overlayButtons()).join(' / ')}`);
    await shot('image');
  }
  log(`errors ${JSON.stringify(errors)}`);
  await browser.close();
})();
