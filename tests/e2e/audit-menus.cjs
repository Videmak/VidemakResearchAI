// Clicks every item of the menu bar (File … Citations, AI) in an open document and records what
// visibly happened, so a dead item shows up as "NO EFFECT". Secure context via localproxy.cjs.
//   node localproxy.cjs & sleep 1; BASE=http://localhost:8080 node audit-menus.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

const text = (t, styles = {}) => ({ type: 'text', text: t, styles });
const block = (type, content, props = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });
const SAMPLE = [
  block('heading', [text('Audit document')], { level: 1 }),
  block('paragraph', [text('Alpha beta gamma delta. '), text('Bold words', { bold: true }), text(' and more text for the audit.')]),
  block('paragraph', [text('Second paragraph with enough words to select and format.')]),
];

const MENUS = {
  File: ['New', 'Open', 'Open in new tab', 'Make a copy', 'Share', 'Copy link', 'Email collaborators', 'Star', 'Import from file', 'Download Word', 'Download PDF', 'Download LaTeX', 'Download text', 'Copy document', 'Rename', 'Move to trash', 'Version history', 'Details', 'Language', 'Page setup', 'Print'],
  Edit: ['Undo', 'Redo', 'Cut', 'Copy', 'Copy as Markdown', 'Paste', 'Paste without formatting', 'Paste from Markdown', 'Select all', 'Delete', 'Find and replace', 'Find', 'Clear formatting'],
  View: ['Mode', 'Comments', 'Show document outline', 'Print layout', 'Full screen', 'Fit', 'Zoom reset'],
  Insert: ['Image', 'Table', 'Horizontal line', 'Attachment', 'Link', 'Bookmark', 'Page break', 'Footnote', 'Table of contents', 'Special characters', 'Inline equation', 'Equation', 'Comment'],
  Format: ['Paragraph styles', 'Align & indent', 'Line & paragraph spacing', 'Bullets & numbering', 'Clear formatting'],
  Tools: ['Spelling and grammar', 'Word count', 'Keyboard shortcuts'],
  Citations: ['Insert citation', 'Find papers', 'Library'],
};

(async () => {
  const auth = await signIn(BASE, 'menus');
  const newDoc = async () => {
    const id = crypto.randomUUID();
    await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Audit document', blocks: SAMPLE }) });
    return id;
  };
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addInitScript(([t, u]) => {
    localStorage.setItem('videmak_token', JSON.stringify(t));
    localStorage.setItem('videmak_user', JSON.stringify(u));
    window.__printed = 0;
    window.print = () => { window.__printed += 1; };
    window.__opened = [];
    window.open = (...args) => { window.__opened.push(String(args[0])); return null; };
  }, [auth.token, auth.user]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  const events = { downloads: [], chooser: 0, popups: 0 };
  page.on('download', (d) => events.downloads.push(d.suggestedFilename()));
  page.on('filechooser', () => { events.chooser += 1; });
  context.on('page', () => { events.popups += 1; });

  let docId = await newDoc();
  const openDoc = async () => {
    await page.goto(`${BASE}/editor?doc=${docId}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.bn-editor').waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
  };
  await openDoc();

  const state = () => page.evaluate(() => {
    const visible = (el) => Boolean(el) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const editor = document.querySelector('.bn-editor');
    const html = editor ? editor.innerHTML : '';
    let hash = 0;
    for (let i = 0; i < html.length; i += 1) hash = (hash * 31 + html.charCodeAt(i)) | 0;
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible).map((d) => (d.getAttribute('aria-label') || d.querySelector('h1,h2,h3')?.textContent || 'dialog').trim().slice(0, 40));
    const toasts = [...document.querySelectorAll('[role="status"]')].map((t) => t.textContent.trim()).filter(Boolean);
    const sel = window.getSelection();
    return {
      url: location.pathname + location.search,
      hash,
      blocks: document.querySelectorAll('.bn-block-outer').length,
      dialogs,
      toasts,
      printed: window.__printed,
      opened: window.__opened.length,
      fullscreen: Boolean(document.fullscreenElement),
      panel: document.querySelector('.ce-assistant-panel h2:not(.hidden)')?.textContent?.trim() || [...document.querySelectorAll('.ce-assistant-panel h2')].map((h) => h.offsetParent ? h.textContent.trim() : '').join('') || null,
      outline: Boolean([...document.querySelectorAll('nav, aside')].find((n) => /outline/i.test(n.getAttribute('aria-label') || '') && visible(n))),
      findBar: Boolean([...document.querySelectorAll('input')].find((i) => /find/i.test(i.getAttribute('aria-label') || i.placeholder || '') && visible(i))),
      dropdowns: [...document.querySelectorAll('body > div')].filter((d) => d.style && d.style.position === 'fixed' && visible(d.firstElementChild || d) && d.querySelector('button')).length,
      selection: sel ? sel.toString().slice(0, 30) : '',
      active: (document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName || '').slice(0, 40),
      zoom: [...document.querySelectorAll('button')].find((b) => /Fit|\d+%/.test(b.textContent) && b.getBoundingClientRect().top > window.innerHeight - 40)?.textContent?.trim() || '',
      title: document.querySelector('input[aria-label="Rename document"]')?.value || '',
      star: document.querySelector('[aria-label*="tar"][aria-pressed]')?.getAttribute('aria-pressed') || '',
      pageView: document.querySelectorAll('.ai-editor-paginated').length,
      spell: document.querySelector('[contenteditable="true"]')?.getAttribute('spellcheck') || '',
    };
  });
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText().catch(() => '<blocked>'));

  const prepare = async () => {
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape');
    // Close anything modal.
    for (const name of ['Close', 'Cancel', 'Done', 'Close panel']) {
      const button = page.locator('[role="dialog"]:visible button', { hasText: new RegExp(`^${name}$`) }).first();
      if (await button.count()) await button.click().catch(() => {});
      const aria = page.locator(`[role="dialog"]:visible button[aria-label="${name}"]`).first();
      if (await aria.count()) await aria.click().catch(() => {});
    }
    // Overlays without role="dialog" (z-[13000] modals): their own close button, else reload.
    for (let i = 0; i < 3; i += 1) {
      const overlay = page.locator('div.fixed.inset-0:visible').filter({ has: page.locator('button') }).last();
      if (!(await overlay.count())) break;
      const label = (await overlay.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 80);
      const close = overlay.locator('button', { hasText: /^(Cancel|Close|Done|Not now|OK|Got it)$/ }).first();
      const x = overlay.locator('button[aria-label^="Close"]').first();
      if (await close.count()) await close.click().catch(() => {});
      else if (await x.count()) await x.click().catch(() => {});
      else { console.log('   (stuck overlay, reloading):', label); await openDoc(); break; }
      await page.waitForTimeout(300);
    }
    if (!page.url().includes(`doc=${docId}`)) await openDoc();
    // Select "beta gamma" in the first paragraph.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.bn-block-content')].find((n) => n.textContent.includes('Alpha beta'));
      if (!el) return;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      const range = document.createRange();
      range.setStart(node, 6);
      range.setEnd(node, 16);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.locator('.bn-editor').focus().catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate(() => navigator.clipboard.writeText('CLIPBOARD-SENTINEL').catch(() => {}));
  };

  const log = (line) => console.log(line);
  for (const [menu, items] of Object.entries(MENUS)) {
    for (const label of items) {
      if (ONLY && !ONLY.includes(label)) continue;
      await prepare();
      const before = await state();
      const counts = { d: events.downloads.length, c: events.chooser, p: events.popups };
      await page.locator('header').getByRole('button', { name: menu, exact: true }).click();
      await page.waitForTimeout(300);
      const item = page.locator('button:visible', { has: page.locator(`span:text-is("${label}")`) }).last();
      if (!(await item.count())) { log(`${menu} › ${label}: ITEM NOT FOUND`); await page.keyboard.press('Escape'); continue; }
      if (label === 'Move to trash' || label === 'New' || label === 'Make a copy' || label === 'Open') {
        // Navigating or destructive: check what opens, then come back to the audit document.
        await item.click();
        await page.waitForTimeout(2500);
        const after = await state();
        log(`${menu} › ${label}: url ${before.url === after.url ? 'same' : after.url.slice(0, 40)} | dialogs ${JSON.stringify(after.dialogs)} | toasts ${JSON.stringify(after.toasts)}`);
        if (label === 'Move to trash' && after.dialogs.length) {
          await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').getByRole('button', { name: /Cancel/ }).click().catch(() => {});
        }
        await openDoc();
        continue;
      }
      await item.click();
      await page.waitForTimeout(label.startsWith('Download') ? 9000 : 1100);
      const after = await state();
      const clip = await clipboard();
      const effects = [];
      for (const key of Object.keys(after)) {
        if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) effects.push(`${key}: ${JSON.stringify(before[key]).slice(0, 40)} → ${JSON.stringify(after[key]).slice(0, 80)}`);
      }
      if (events.downloads.length > counts.d) effects.push(`download ${events.downloads.slice(counts.d).join(', ')}`);
      if (events.chooser > counts.c) effects.push('file chooser opened');
      if (events.popups > counts.p) effects.push('popup');
      if (clip !== 'CLIPBOARD-SENTINEL') effects.push(`clipboard: ${JSON.stringify(clip.slice(0, 70))}`);
      log(`${menu} › ${label}: ${effects.length ? effects.join(' | ') : 'NO EFFECT'}`);
      if (['Delete', 'Cut', 'Clear formatting', 'Paste', 'Paste without formatting', 'Paste from Markdown', 'Table', 'Horizontal line', 'Page break', 'Footnote', 'Table of contents', 'Equation', 'Undo', 'Redo'].includes(label)) {
        await page.screenshot({ path: `${OUT}/menu-${menu}-${label.replace(/\W+/g, '_')}.png` });
        // Start the next item from the original text.
        docId = await newDoc();
        await openDoc();
      } else if (ONLY || after.dialogs.length || /Mode|styles|Align|spacing|Bullets|Image|Link|Special/.test(label)) {
        await page.screenshot({ path: `${OUT}/menu-${menu}-${label.replace(/\W+/g, '_')}.png` });
      }
    }
  }
  // AI menu contents.
  await prepare();
  await page.locator('header').getByRole('button', { name: 'AI', exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/menu-AI.png` });
  log(`AI menu: ${(await page.locator('button:visible, [role="switch"]:visible, input:visible').evaluateAll((nodes) => nodes.filter((n) => n.closest('[style*="position: fixed"]')).map((n) => (n.getAttribute('aria-label') || n.textContent || '').trim()).filter(Boolean))).join(' / ')}`);
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
