// Presses every keyboard shortcut the menus and tooltips advertise in an open document and
// records what visibly happened, so a dead shortcut shows up as "NO EFFECT". Secure context via localproxy.cjs.
//   node localproxy.cjs & sleep 1; BASE=http://localhost:8080 node audit-shortcuts.cjs
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
  const SHORTCUTS = [
    ['Comment', 'Control+Alt+m'], ['New', 'Control+Alt+n'], ['Table', 'Control+Alt+t'], ['Spelling', 'Control+Alt+x'],
    ['Footnote', 'Control+Alt+f'], ['Copy formatting', 'Control+Alt+c'], ['Word count', 'Control+Shift+c'],
    ['Align center', 'Control+Shift+e'], ['Align left', 'Control+Shift+l'], ['Align right', 'Control+Shift+r'], ['Justify', 'Control+Shift+j'],
    ['Full screen', 'Control+Shift+f'], ['Make a copy', 'Control+Shift+s'], ['Open', 'Control+o'], ['Keyboard shortcuts', 'Control+/'],
    ['Search menus', 'Alt+/'], ['Rename', 'F2'], ['Clear formatting', 'Control+\\'], ['Page break', 'Control+Enter'], ['Link', 'Control+k'],
    ['Find', 'Control+f'], ['Find and replace', 'Control+h'], ['Print', 'Control+p'], ['Undo', 'Control+z'], ['Bold', 'Control+b'],
    ['Bigger font', 'Control+Shift+.'], ['Smaller font', 'Control+Shift+,'], ['Heading 1', 'Control+Alt+1'], ['Bullet list', 'Control+Shift+8'],
  ];
  for (const [label, keys] of SHORTCUTS) {
    if (ONLY && !ONLY.includes(label)) continue;
    await prepare();
    const before = await state();
    const counts = { d: events.downloads.length, c: events.chooser, p: events.popups };
    await page.keyboard.press(keys);
    await page.waitForTimeout(900);
    const after = await state();
    const effects = [];
    for (const key of Object.keys(after)) {
      if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) effects.push(`${key}: ${JSON.stringify(after[key]).slice(0, 60)}`);
    }
    if (events.popups > counts.p) effects.push('popup');
    log(`${label} (${keys}): ${effects.length ? effects.join(' | ') : 'NO EFFECT'}`);
    if (!page.url().includes(`doc=${docId}`) || effects.some((e) => e.startsWith('hash') || e.startsWith('blocks'))) {
      docId = await newDoc();
      await openDoc();
    }
  }
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
