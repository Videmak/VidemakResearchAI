// Visual check of the editor chrome: documents home, an open document, the "More" menu, the
// assistant panel, desktop 1440 and iPhone 13. Writes PNGs to /shots/style-*.png and prints
// console errors and horizontal overflow per view.
// Runs in the Playwright container: BASE=http://localhost:8080 node editor-style-shots.cjs
const { chromium, devices } = require('playwright');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const TAG = process.env.TAG || 'style';
const email = `style-${Date.now()}@example.test`;

const text = (t, styles = {}) => ({ type: 'text', text: t, styles });
const block = (type, content, props = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });
const SAMPLE = [
  block('heading', [text('Sleep and memory consolidation in adults')], { level: 1 }),
  block('paragraph', [text('Sleep supports the consolidation of declarative memory. Across controlled studies, a night of sleep after learning improves recall compared with an equal period of wakefulness, and the benefit is largest for weakly encoded material.')]),
  block('heading', [text('Background')], { level: 2 }),
  block('paragraph', [text('Slow-wave sleep and sleep spindles are thought to coordinate the replay of hippocampal traces into neocortical networks. '), text('This review summarises the evidence', { bold: true }), text(' from 42 trials published between 2004 and 2025.')]),
  block('bulletListItem', [text('Polysomnography studies of overnight recall')]),
  block('bulletListItem', [text('Targeted memory reactivation during slow-wave sleep')]),
  block('bulletListItem', [text('Sleep deprivation and encoding deficits')]),
  block('heading', [text('Methods')], { level: 2 }),
  block('paragraph', [text('We searched PubMed, PsycINFO and Scopus for randomised and crossover trials comparing post-learning sleep with wake. Two reviewers screened titles and abstracts independently.')]),
];

async function seed(token, title, blocks) {
  const id = crypto.randomUUID();
  const r = await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ id, title, blocks }) });
  if (!r.ok) console.log('seed failed', r.status, await r.text());
  return id;
}

async function tryClick(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.count() && await loc.isVisible().catch(() => false)) { await loc.click(); return sel; }
  }
  return null;
}

(async () => {
  // Sign-ups are rate limited (10 an hour): LOGIN=<email> reuses an earlier test account.
  const auth = process.env.LOGIN
    ? await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.LOGIN, password: 'correct-horse-9' }) })
    : await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-9', full_name: 'Ada Lovelace' }) });
  const { token, user } = await auth.json();
  console.log('auth', auth.status);
  const docId = await seed(token, 'Sleep and memory consolidation: a review', SAMPLE);
  await seed(token, 'Methods chapter draft', [block('paragraph', [text('Participants were recruited from two university sleep labs.')])]);
  await seed(token, 'Grant proposal, Aim 2', [block('paragraph', [text('Aim 2 tests whether targeted reactivation improves retention.')])]);

  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const views = (process.env.VIEWS || 'desktop,phone').split(',');
  for (const kind of views) {
    const options = kind === 'phone' ? devices['iPhone 13'] : { viewport: { width: 1440, height: 900 } };
    const context = await browser.newContext(options);
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [token, user]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/AI is not configured|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 240)); });
    page.on('response', (r) => { if (r.status() >= 400 && r.status() !== 503) errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
    const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const shot = async (name) => { await page.screenshot({ path: `${OUT}/${TAG}-${kind}-${name}.png` }); console.log(kind, name, 'overflowX', await overflow()); };

    await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);
    await shot('1-home');
    if (kind === 'desktop') {
      const list = await tryClick(page, ['[aria-label="List view"]']);
      if (list) { await page.waitForTimeout(600); await shot('1b-home-list'); await tryClick(page, ['[aria-label="Grid view"]']); }
    }

    await page.goto(`${BASE}/editor?doc=${docId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    await shot('2-document');
    const fonts = await page.evaluate(() => {
      const pick = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontFamily.slice(0, 60) + ' ' + getComputedStyle(el).fontSize : null; };
      return { body: pick('body'), doc: pick('.bn-editor p, .bn-inline-content'), button: pick('header button') };
    });
    console.log(kind, 'fonts', JSON.stringify(fonts));
    // Next.js dev overlay: open its issue list and print the leaf text (dev only).
    const overlay = async () => page.evaluate(() => {
      const out = [];
      for (const portal of document.querySelectorAll('nextjs-portal')) {
        const root = portal.shadowRoot;
        if (!root) continue;
        for (const node of root.querySelectorAll('*')) {
          if (node.childElementCount === 0 && !['STYLE', 'SCRIPT', 'svg', 'path'].includes(node.tagName) && (node.textContent || '').trim()) out.push(node.textContent.trim());
        }
      }
      return out.join(' ¦ ').slice(0, 1500);
    });
    if (process.env.OVERLAY) {
      console.log(kind, 'overlay before:', await overlay());
      await page.evaluate(() => {
        for (const portal of document.querySelectorAll('nextjs-portal')) {
          const button = portal.shadowRoot && [...portal.shadowRoot.querySelectorAll('button')].find((b) => /issue/i.test(b.textContent || ''));
          if (button) button.click();
        }
      });
      await page.waitForTimeout(1500);
      console.log(kind, 'overlay after:', await overlay());
      await page.keyboard.press('Escape');
    }
    if (kind === 'desktop') {
      await page.locator('.bn-editor').first().click({ position: { x: 200, y: 120 } }).catch(() => {});
      await page.waitForTimeout(400);
      const more = await tryClick(page, ['[data-testid="editor-more-menu"]']);
      if (more) {
        await page.waitForTimeout(600); await shot('3-more-menu');
        await tryClick(page, ['[data-docs-toolbar-dropdown] button:has-text("File")']);
        await page.waitForTimeout(400); await shot('3b-more-file');
        await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      }
      const tools = await tryClick(page, ['[aria-label="More tools"]']);
      if (tools) { await page.waitForTimeout(500); await shot('3c-more-tools'); await tryClick(page, ['[aria-label="Fewer tools"]']); }
      const comments = await tryClick(page, ['[role="tab"]:has-text("Comments")']);
      if (comments) { await page.waitForTimeout(900); await shot('4-comments'); await tryClick(page, ['[role="tab"]:has-text("AI Chat")']); }
      const close = await tryClick(page, ['aside [aria-label="Close panel"]']);
      if (close) { await page.waitForTimeout(700); await shot('5-no-panel'); }
      const outline = await tryClick(page, ['[data-testid="editor-outline-toggle"]']);
      if (outline) { await page.waitForTimeout(600); await shot('6-outline'); await page.keyboard.press('Escape'); }
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.waitForTimeout(1200); await shot('7-1024');
    } else {
      await page.locator('.bn-editor').first().click({ position: { x: 60, y: 140 } }).catch(() => {});
      await page.waitForTimeout(800);
      await shot('2b-document-focused');
      const sheet = await tryClick(page, ['[aria-label="More document options"]']);
      if (sheet) {
        await page.waitForTimeout(700); await shot('3-options-sheet');
        const chat = await tryClick(page, ['[role="dialog"] button:has-text("AI Chat")']);
        if (chat) { await page.waitForTimeout(1000); await shot('4-ai-sheet'); }
      }
    }
    console.log(kind, 'errors:', JSON.stringify([...new Set(errors)].slice(0, 12)));
    await context.close();
  }
  await browser.close();
})().catch((error) => { console.error('SHOTS FAILED', error); process.exit(1); });
