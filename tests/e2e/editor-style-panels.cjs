// Visual check of the assistant panel contents (AI Chat, Comments, Library, Papers), the
// citation card and the block gutter at 1440x900, plus the phone sheet. Writes /shots/panels-*.png.
// Runs in the Playwright container: BASE=http://localhost:8080 node editor-style-panels.cjs
const { chromium, devices } = require('playwright');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const email = `panels-${Date.now()}@example.test`;

const text = (t, styles = {}) => ({ type: 'text', text: t, styles });
const block = (type, content, props = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });
const bib = '@article{rasch2013,\n  title={About sleep\'s role in memory},\n  author={Rasch, Bj{\\"o}rn and Born, Jan},\n  journal={Physiological Reviews},\n  year={2013},\n  doi={10.1152/physrev.00032.2012}\n}';
const cite = (id, displayText) => ({ type: 'aiCitation', props: { citationId: id, base64: Buffer.from(bib).toString('base64'), displayText, style: 'apa' } });
const introId = crypto.randomUUID();
const SAMPLE = [
  block('heading', [text('Sleep and Memory Consolidation in Adults')], { level: 1 }),
  block('heading', [text('Introduction')], { level: 2 }),
  { id: introId, type: 'paragraph', props: {}, children: [], content: [
    text('Sleep is no longer viewed as a passive state of rest. Over the past two decades, a growing body of evidence has shown that sleep actively supports the stabilisation and integration of newly acquired memories. Slow-wave sleep in particular appears to promote the reactivation of hippocampal memory traces and their gradual transfer to neocortical networks '),
    cite('rasch2013', '(Rasch & Born, 2013)'),
    text('.'),
  ] },
  block('paragraph', [text('These findings have practical consequences for students and shift workers alike. When sleep is restricted after learning, retention of declarative material declines.')]),
];
const now = Date.now();
const COMMENTS = [
  { id: crypto.randomUUID(), actorSessionId: 'ai', actorDisplayName: 'Videmak AI', kind: 'ai-review', severity: 'major', category: 'evidence', blockId: introId, createdAt: now - 120000, status: 'open', replies: [],
    selectedText: 'Slow-wave sleep in particular appears to promote the reactivation…', text: 'Most of this evidence comes from young adults in lab settings. Qualify the claim, or cite a study that includes older adults.' },
  { id: crypto.randomUUID(), actorSessionId: 'ai', actorDisplayName: 'Videmak AI', kind: 'ai-review', severity: 'minor', category: 'clarity', blockId: introId, createdAt: now - 120000, status: 'open', replies: [],
    selectedText: 'Over the past two decades…', text: 'Give a date range or a citation for this trend so the reader can check it.' },
  { id: crypto.randomUUID(), actorSessionId: 'joseph', actorDisplayName: 'Joseph N.', blockId: introId, createdAt: now - 3600000, status: 'open', replies: [],
    text: 'Could we add the meta-analysis we talked about on Tuesday here?' },
];

async function api(path, token, method, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  if (!r.ok) console.log(method, path, r.status, (await r.text()).slice(0, 200));
  return r;
}

async function clickFirst(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.count() && await loc.isVisible().catch(() => false)) { await loc.click(); return sel; }
  }
  return null;
}

(async () => {
  const signup = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-9', full_name: 'Amina Kariuki' }) });
  const { token, user } = await signup.json();
  console.log('signup', signup.status);
  const docId = crypto.randomUUID();
  await api('/api/ai-editor/documents', token, 'POST', { id: docId, title: 'Sleep and memory consolidation', blocks: SAMPLE });
  await api(`/api/ai-editor/documents/${docId}`, token, 'PATCH', { comments: COMMENTS });

  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const views = (process.env.VIEWS || 'desktop,phone').split(',');
  for (const kind of views) {
    const options = kind === 'phone' ? devices['iPhone 13'] : { viewport: { width: 1440, height: 900 } };
    const context = await browser.newContext(options);
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [token, user]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/AI is not configured|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
    const shot = (name) => page.screenshot({ path: `${OUT}/panels-${kind}-${name}.png` });
    await page.goto(`${BASE}/editor?doc=${docId}`, { waitUntil: 'domcontentloaded' });
    // FIX_FONT=1 previews the proposed styles.css fix for Mantine's unlayered `button { font: inherit }`.
    if (process.env.FIX_FONT) await page.addStyleTag({ content: 'html button, html input, html textarea, html select { font: revert-layer; }' });
    await page.waitForTimeout(9000);

    const tabs = [
      ['chat', ['[role="tab"]:has-text("AI Chat")', '[aria-label="AI Chat"]']],
      ['comments', ['[role="tab"]:has-text("Comments")', '[aria-label="Comments"]']],
      ['library', ['[role="tab"]:has-text("Library")', '[aria-label="Library"]']],
      ['papers', ['[role="tab"]:has-text("Papers")', '[aria-label="Find papers"]']],
    ];
    if (kind === 'phone') {
      // Phones open the assistant from the document options; try the known entry points.
      const opened = await clickFirst(page, ['[aria-label="More document options"]', '[aria-label="More options"]', '[aria-label="More"]']);
      await page.waitForTimeout(600);
      const chat = opened ? await clickFirst(page, ['button:has-text("AI Chat")']) : null;
      console.log(kind, 'sheet via', opened, chat);
      await page.waitForTimeout(1200);
      await shot('chat');
      for (const [name, selectors] of tabs.slice(1)) {
        const via = await clickFirst(page, selectors.slice(0, 1));
        if (via) { await page.waitForTimeout(1200); await shot(name); }
      }
    } else {
      for (const [name, selectors] of tabs) {
        const selected = await page.locator(`[role="tab"][aria-selected="true"]:has-text("${name === 'chat' ? 'AI Chat' : name[0].toUpperCase() + name.slice(1)}")`).count();
        const via = selected ? 'already open' : await clickFirst(page, selectors);
        console.log(kind, name, 'via', via);
        await page.waitForTimeout(1500);
        if (name === 'comments') {
          await page.locator('[data-comment-id]').first().click({ position: { x: 60, y: 14 } }).catch(() => {});
          await page.waitForTimeout(500);
        }
        await shot(name);
        if (name === 'chat') {
          const box = page.locator('textarea[aria-label^="Message"]').first();
          if (await box.count()) {
            await box.fill('Find two more studies on sleep restriction and declarative memory in students.');
            await box.press('Enter');
            await page.waitForTimeout(2500);
            await shot('chat-sent');
          }
        }
        if (name === 'papers') {
          const input = page.locator('input[aria-label="Search papers"]').first();
          if (await input.count()) { await input.click(); await page.waitForTimeout(300); await shot('papers-focus'); }
        }
      }
      // Dialogs: share, version history, find and replace.
      for (const [name, selectors] of [
        ['share', ['button:text-is("Share")', 'button:has-text("Share")', '[aria-label="Share"]']],
        ['history', ['[aria-label="Version history"]', 'button:has-text("Version history")']],
      ]) {
        const via = await clickFirst(page, selectors);
        console.log(kind, name, 'via', via);
        if (via) { await page.waitForTimeout(1500); await shot(`dialog-${name}`); await page.keyboard.press('Escape'); await page.waitForTimeout(500); await clickFirst(page, ['[aria-label="Close version history"]', '[aria-label="Close share dialog"]', '[aria-label="Close"]']); await page.waitForTimeout(300); }
      }
      await page.locator('.bn-editor').first().click({ position: { x: 80, y: 40 } }).catch(() => {});
      await page.keyboard.press('Control+h');
      await page.waitForTimeout(800);
      if (await page.locator('.ce-find-bar').count()) { await shot('dialog-find'); await page.keyboard.press('Escape'); }
      // Citation card: click the citation in the document.
      const citation = page.locator('.bn-editor [data-inline-content-type="aiCitation"]').first();
      if (await citation.count()) {
        await citation.click();
        await page.waitForTimeout(1500);
        await shot('citation-card');
        await page.keyboard.press('Escape');
      }
      // Block gutter: hover the second paragraph.
      const para = page.locator('.bn-editor .bn-block-content[data-content-type="paragraph"]').nth(1);
      if (await para.count()) {
        await para.hover();
        await page.waitForTimeout(800);
        const box = await para.boundingBox();
        if (box) await page.screenshot({ path: `${OUT}/panels-${kind}-gutter.png`, clip: { x: Math.max(0, box.x - 140), y: Math.max(0, box.y - 30), width: 520, height: 120 } });
        const ai = page.locator('.bn-side-menu .ce-side-ai').first();
        if (await ai.count()) { await ai.click(); await page.waitForTimeout(700); await shot('block-ai-menu'); await page.keyboard.press('Escape'); }
      }
    }
    console.log(kind, 'overflowX', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    console.log(kind, 'errors:', JSON.stringify([...new Set(errors)].slice(0, 10)));
    await context.close();
  }
  await browser.close();
})().catch((error) => { console.error('PANELS FAILED', error); process.exit(1); });
