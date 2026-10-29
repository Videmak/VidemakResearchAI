// Editor AI flows with the real AI: AI suggest bar placement (and following scroll),
// Conclude (closing sentence + next heading), autocomplete settings, review fixes as tracked
// changes, a check on a selection, and the version history. Writes /shots/ai-flows-*.png.
//   BASE=http://videmak-router:8080 node editor-ai-flows.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://videmak-router:8080';
const OUT = process.env.OUT || '/shots';

const text = (t) => ({ type: 'text', text: t, styles: {} });
const block = (type, content, props = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });
const P = (t) => block('paragraph', [text(t)]);
const SAMPLE = [
  block('heading', [text('Malaria in Pregnancy in Uganda')], { level: 1 }),
  block('heading', [text('Introduction')], { level: 2 }),
  P('Malaria in pregnancy remains one of the most persistent public health challenges in endemic regions, particularly across sub-Saharan Africa where transmission is stable and access to antenatal prevention is uneven.'),
  P('Pregnancy alters immune responses in ways that increase susceptibility to infection, and placental parasitaemia is linked to maternal anaemia, low birth weight and preterm delivery.'),
  P('In Uganda, intermittent preventive treatment with sulfadoxine-pyrimethamine and insecticide-treated nets are delivered to pregnant women through antenatal care. Uptake of these measures remain uneven, with many women attending antenatal care late.'),
  block('heading', [text('Background')], { level: 2 }),
  P('Facility-based screening data indicate that malaria prevalence among pregnant women can be estimated through routine antenatal testing, offering a practical means of monitoring trends.'),
  P('Historical estimates indicate that malaria contributes substantially to severe maternal anaemia and low birth weight in endemic settings, and these associations remains relevant because the underlying mechanisms persist.'),
  P('Contemporary control strategies rely on insecticide-treated nets, prompt diagnosis and treatment, and preventive therapy during pregnancy, but coverage gaps persists in rural districts.'),
];

(async () => {
  const auth = await signIn(BASE, 'e2e');
  const id = crypto.randomUUID();
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Untitled document', blocks: SAMPLE }) });

  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 800 } });
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
  const shot = (name) => page.screenshot({ path: `${OUT}/ai-flows-${name}.png` });
  const bar = page.locator('.ce-ghost-bar');
  const ghost = page.locator('.ce-ghost-text');
  const gap = async () => page.evaluate(() => {
    const g = document.querySelector('.ce-ghost-text');
    const b = document.querySelector('.ce-ghost-bar');
    if (!g || !b) return null;
    const lines = g.getClientRects();
    return Math.round(b.getBoundingClientRect().top - lines[lines.length - 1].bottom);
  });
  await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);

  // 1. AI suggest at the end of the Introduction's last paragraph.
  const para = page.locator('.bn-block-content', { hasText: 'attending antenatal care late' }).first();
  await para.click();
  await page.keyboard.press('Control+End').catch(() => {});
  await para.click({ position: { x: 5, y: 5 } });
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.bn-block-content')].find((node) => node.textContent.includes('attending antenatal care late'));
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last = null; while (walker.nextNode()) last = walker.currentNode;
    range.setStart(last, last.length); range.collapse(true);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'AI suggest' }).click();
  await ghost.waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(600);
  console.log('1 bar under the grey text (px gap):', await gap());
  await shot('1-suggest');
  await page.locator('[class*="overflow-y-auto"]').filter({ has: page.locator('.bn-editor') }).first().evaluate((el) => el.scrollBy(0, 160));
  await page.waitForTimeout(500);
  console.log('1 after scrolling, gap:', await gap());

  // 2. Conclude: accept, then a closing statement and the next heading.
  const headingsBefore = await page.locator('h2, [data-content-type="heading"]').count();
  await bar.getByRole('button', { name: /Conclude/ }).click();
  await page.waitForTimeout(1500);
  await ghost.waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  console.log('2 conclude grey text:', JSON.stringify((await ghost.innerText().catch(() => '')).slice(0, 160)), '| next heading chip:', JSON.stringify(await bar.locator('span', { hasText: 'Next:' }).innerText().catch(() => '')));
  await shot('2-conclude');
  await bar.getByRole('button', { name: /Accept/ }).click();
  await page.waitForTimeout(1500);
  console.log('2 headings before/after:', headingsBefore, await page.locator('h2, [data-content-type="heading"]').count(), '| title now:', JSON.stringify(await page.locator('input[aria-label="Rename document"]').inputValue().catch(() => '')));
  await shot('2b-concluded');

  // 2c. Conclude at the very end of the document: a new section heading is proposed.
  const lastPara = page.locator('.bn-block-content', { hasText: 'rural districts' }).first();
  await lastPara.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.bn-block-content')].find((node) => node.textContent.includes('rural districts'));
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last = null; while (walker.nextNode()) last = walker.currentNode;
    const range = document.createRange(); range.setStart(last, last.length); range.collapse(true);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'AI suggest' }).click();
  await ghost.waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
  await bar.getByRole('button', { name: /Conclude/ }).click();
  await page.waitForTimeout(1500);
  await ghost.waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  console.log('2c end-of-document chip:', JSON.stringify(await bar.locator('span', { hasText: 'Next:' }).innerText().catch(() => '')));
  await shot('2c-conclude-end');
  const h2Before = await page.locator('h2').count();
  await bar.getByRole('button', { name: /Accept/ }).click();
  await page.waitForTimeout(1500);
  console.log('2c h2 headings before/after:', h2Before, await page.locator('h2').count());
  await shot('2d-new-section');

  // 3. Autocomplete settings.
  await page.locator('button[aria-label="Autocomplete settings"]').click();
  await page.waitForTimeout(500);
  await shot('3-settings');
  await page.keyboard.press('Escape');
  await page.locator('button[aria-label="Autocomplete settings"]').click().catch(() => {});

  // 4. Proofread → tracked changes → accept all.
  await page.locator('nav[aria-label="Document tools"] button[aria-label="Review"]').click();
  await page.waitForTimeout(600);
  await page.locator('article', { hasText: 'Proofread' }).getByRole('button', { name: /^Run$/ }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Checking"]'), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(600);
  const showIn = page.getByRole('button', { name: /Show \d+ changes? in the text/ });
  console.log('4 proofread:', (await page.locator('.ce-assistant-panel').innerText()).replace(/\s+/g, ' ').slice(0, 160));
  if (await showIn.count()) {
    await showIn.click();
    await page.waitForTimeout(1000);
    console.log('4 tracked changes in text:', await page.locator('ins.ce-suggest-insert').count(), 'insertions,', await page.locator('del.ce-suggest-delete').count(), 'deletions');
    await shot('4-tracked');
    await page.locator('.ce-assistant-panel').getByRole('button', { name: 'Accept all' }).click();
    await page.waitForTimeout(800);
    console.log('4 after Accept all:', await page.locator('ins.ce-suggest-insert').count(), 'left');
  }

  // 5. A check on a selection.
  await page.locator('.ce-assistant-panel button[aria-label="All checks"]').click().catch(() => {});
  const target = page.locator('.bn-block-content', { hasText: 'Historical estimates' }).first();
  await target.click({ clickCount: 3 });
  await page.waitForTimeout(500);
  const selectionButton = page.getByRole('button', { name: 'Selection', exact: true });
  console.log('5 selection enabled:', await selectionButton.isEnabled());
  await selectionButton.click();
  await page.locator('article', { hasText: 'Claim check' }).getByRole('button', { name: /^Run$/ }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Checking"]'), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(600);
  console.log('5 claim check on selection:', (await page.locator('.ce-assistant-panel').innerText()).replace(/\s+/g, ' ').slice(0, 200));
  await shot('5-selection');

  // 6. Version history.
  await page.locator('header button[aria-label="More"]').click();
  await page.getByRole('button', { name: 'Version history' }).click();
  await page.waitForTimeout(2500);
  await shot('6-history');
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
