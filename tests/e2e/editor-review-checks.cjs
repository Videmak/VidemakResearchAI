// The caret pill (AI suggest, Cite) and the Review panel's checks, with the real AI on staging.
// Writes /shots/review-*.png. Runs in the Playwright container:
//   BASE=http://videmak-router:8080 node editor-review-checks.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://videmak-router:8080';
const OUT = process.env.OUT || '/shots';
const email = `review-${Date.now()}@example.test`;

const text = (t, styles = {}) => ({ type: 'text', text: t, styles });
const block = (type, content, props = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });
const bib = (key, title, author, journal, year, doi) => `@article{${key},\n  title={${title}},\n  author={${author}},\n  journal={${journal}},\n  year={${year}},\n  doi={${doi}}\n}`;
const cite = (id, displayText, bibtex) => ({ type: 'aiCitation', props: { citationId: id, base64: Buffer.from(bibtex).toString('base64'), displayText, style: 'apa' } });
const SAMPLE = [
  block('heading', [text('Sleep and Memory Consolidation in Students')], { level: 1 }),
  block('heading', [text('Introduction')], { level: 2 }),
  block('paragraph', [
    text('Sleep is no longer viewed as a passive state of rest. Slow-wave sleep always improves memory in every adult, and this proves that students should sleep nine hours '),
    cite('rasch2013', '(Rasch & Born, 2013)', bib('rasch2013', "About sleep's role in memory", 'Rasch, Bjorn and Born, Jan', 'Physiological Reviews', 2013, '10.1152/physrev.00032.2012')),
    text('. Most students sleep badly, and their grades suffers because of it '),
    cite('fake2021', '(Okello, 2021)', bib('fake2021', 'Sleep deprivation among Ugandan university students: a national cohort', 'Okello, Peter', 'Journal of Imaginary Sleep', 2021, '10.9999/imaginary.2021.001')),
    text('. Many researchers believes that naps is helpful.'),
  ]),
  block('paragraph', [text('These findings have practical consequences for students and shift workers alike. When sleep is restricted after learning, retention of declarative material declines measurably, even when total study time is held constant.')]),
];

(async () => {
  const { token, user } = await signIn(BASE, 'e2e');
  const id = crypto.randomUUID();
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ id, title: 'Sleep and memory in students', blocks: SAMPLE }) });

  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [token, user]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('requestfailed', (r) => { if (r.url().includes('/assist/')) console.log('request failed', r.url().replace(BASE, ''), r.failure()?.errorText); });
  page.on('response', async (r) => {
    if (r.url().includes('/assist/complete')) {
      const body = await r.text().catch(() => '');
      console.log('complete response', r.status(), body.slice(0, 120));
      return;
    }
    if (!r.url().includes('/assist/review')) return;
    try { const body = await r.json(); console.log('review response', r.status(), JSON.parse(r.request().postData() || '{}').mode, (body.comments || []).map((c) => c.category).join(',')); } catch {}
  });
  const shot = (name) => page.screenshot({ path: `${OUT}/review-${name}.png` });
  await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);

  // 1. Caret pill: click at the end of the last paragraph.
  const para = page.locator('.bn-block-content', { hasText: 'held constant' }).first();
  await para.click();
  // The end of this paragraph (End stops at a wrapped line's end; Ctrl+End is the References list).
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.bn-block-content')].find((node) => node.textContent.includes('held constant'));
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last = null; let node;
    while ((node = walker.nextNode())) last = node;
    const range = document.createRange(); range.setStart(last, last.textContent.length); range.collapse(true);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  });
  await page.waitForTimeout(1200);
  console.log('ghost text showing:', await page.locator('.ce-ghost-text').count());
  const pill = page.getByRole('button', { name: 'AI suggest' });
  console.log('pill visible:', await pill.isVisible().catch(() => false));
  await shot('1-pill');
  if (!(await pill.isVisible().catch(() => false))) { await page.keyboard.press('Escape'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('End'); await page.waitForTimeout(800); console.log('pill after Esc:', await pill.isVisible().catch(() => false)); }
  await pill.click();
  await page.waitForTimeout(400);
  console.log('writing flag:', await page.getByText('Videmak AI', { exact: true }).isVisible().catch(() => false));
  await page.screenshot({ path: `${OUT}/review-1b-writing.png` });
  const ghost = page.locator('.ce-ghost-text');
  await ghost.waitFor({ timeout: 60000 }).catch(() => {});
  console.log('grey text at cursor:', await ghost.isVisible().catch(() => false), JSON.stringify((await ghost.innerText().catch(() => '')).slice(0, 120)));
  await shot('2-suggestion');
  const before = (await para.innerText()).replace(await ghost.innerText().catch(() => ''), '');
  await page.locator('.ce-ghost-bar').getByRole('button', { name: /Accept/ }).click();
  await page.waitForTimeout(800);
  console.log('accepted into the paragraph:', (await para.innerText()).length > before.length);
  await page.waitForTimeout(2500);
  const versions = await (await fetch(`${BASE}/api/ai-editor/documents/${id}/versions`, { headers: { Authorization: `Bearer ${token}` } })).json();
  console.log('history:', JSON.stringify((versions.versions || []).slice(0, 2).map((v) => [v.reason, v.authorName, v.wordCount])));

  // Citation style: switch to Chicago from the status bar.
  await page.locator('button', { hasText: 'APA 7' }).last().click();
  await page.waitForTimeout(600);
  await shot('2b-style-list');
  await page.getByRole('option', { name: /Chicago/ }).first().click().catch(async () => { await page.getByText(/Chicago \(Author-Date\)/).first().click(); });
  await page.waitForTimeout(1500);
  console.log('citation now:', JSON.stringify(await page.locator('[data-inline-content-type="aiCitation"]').first().innerText().catch(() => '')));
  await shot('2c-chicago');

  // 2. Review panel.
  await page.locator('nav[aria-label="Document tools"] button[aria-label="Review"]').click();
  await page.waitForTimeout(800);
  await shot('3-panel');
  for (const [title, name] of [['Claim check', 'claims'], ['Source quality', 'sources'], ['Proofread', 'proofread'], ['Peer review', 'peer']]) {
    const card = page.locator('article', { hasText: title });
    await page.locator('.ce-assistant-panel button[aria-label="All checks"]').click().catch(() => {});
    await page.waitForTimeout(300);
    await card.getByRole('button', { name: /^Run$/ }).click();
    const t0 = Date.now();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Checking"]'), null, { timeout: 180000 }).catch(() => {});
    await page.waitForTimeout(500);
    const body = (await page.locator('.ce-assistant-panel').innerText()).replace(/\s+/g, ' ').slice(0, 300);
    console.log(`${name}: ${Math.round((Date.now() - t0) / 1000)} s ::`, body);
    await shot(`4-${name}`);
  }
  // Claim check suggestions in Comments, filtered.
  await page.locator('.ce-assistant-panel button[aria-label="All checks"]').click();
  await page.locator('article', { hasText: 'Claim check' }).getByRole('button', { name: 'View results' }).click();
  const show = page.getByRole('button', { name: 'Review suggestions' });
  if (await show.count()) { await show.click(); await page.waitForTimeout(800); await shot('5-claims-in-comments'); }
  // The header ⋯ menu.
  await page.locator('header button[aria-label="More"]').click();
  await page.waitForTimeout(400);
  await shot('6-more-menu');
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
