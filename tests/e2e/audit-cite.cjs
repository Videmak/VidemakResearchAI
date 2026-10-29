// The toolbar's Cite button: the @ menu, typing a search, picking a paper; and paragraph indent.
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
(async () => {
  const auth = await signIn(BASE, 'cite');
  const id = crypto.randomUUID();
  const P = (t) => ({ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [{ type: 'text', text: t, styles: {} }], children: [] });
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Cite audit', blocks: [P('Sleep supports memory consolidation in students.'), P('Second paragraph for the indent check.')] }) });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 200)));
  await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.bn-editor').waitFor();
  await page.waitForTimeout(2500);
  const para = page.locator('.bn-block-content', { hasText: 'Sleep supports' }).first();
  await para.click();
  await page.keyboard.press('End');
  await page.waitForTimeout(600);
  const pill = await page.locator('button', { hasText: 'AI suggest' }).boundingBox().catch(() => null);
  const line = await para.boundingBox();
  console.log('pill at paragraph end: pill y', pill && Math.round(pill.y), 'line y', Math.round(line.y), 'pill x', pill && Math.round(pill.x));
  await page.screenshot({ path: `${OUT}/cite-0-pill-end.png` });
  await page.locator('[data-testid="editor-toolbar-row"] button[title^="Insert a citation"]').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/cite-1-menu.png` });
  console.log('menu text:', (await page.locator('body').innerText()).match(/Library[\s\S]{0,200}/)?.[0]?.replace(/\s+/g, ' ').slice(0, 200));
  await page.keyboard.type('sleep memory');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/cite-2-results.png` });
  console.log('ghost text while the menu is open:', await page.locator('.ce-ghost-text').count(), '| ghost bar:', await page.locator('.ce-ghost-bar').count(), '| pill:', await page.locator('button', { hasText: 'AI suggest' }).count());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  console.log('citations', await page.locator('[data-inline-content-type="aiCitation"]').count(), '| References:', await page.locator('h1, h2, h3', { hasText: /^References$/ }).count(), '| sentence:', JSON.stringify(await page.locator('.bn-block-content').first().innerText()));
  await page.screenshot({ path: `${OUT}/cite-3-cited.png` });
  // Paragraph indent.
  const second = page.locator('.bn-block-content', { hasText: 'Second paragraph' }).first();
  await second.click();
  const indentButton = async (label) => {
    let button = page.locator(`[data-testid="editor-toolbar-row"] button[aria-label^="${label}"]:visible`);
    if (!(await button.count())) { await page.locator('button[aria-label="More tools"]').click(); await page.waitForTimeout(300); button = page.locator(`button[aria-label^="${label}"]:visible`); }
    await button.first().click();
  };
  await indentButton('Increase indent');
  await page.waitForTimeout(300);
  const indented = await second.evaluate((el) => [el.style.paddingLeft, getComputedStyle(el).paddingLeft, Math.round(el.querySelector('.bn-inline-content').getBoundingClientRect().left)]);
  await indentButton('Increase indent');
  await page.waitForTimeout(300);
  const twice = await second.evaluate((el) => el.style.paddingLeft);
  await indentButton('Decrease indent');
  await indentButton('Decrease indent');
  await page.waitForTimeout(300);
  console.log('indent once', JSON.stringify(indented), '| twice', twice, '| back', JSON.stringify(await second.evaluate((el) => el.style.paddingLeft)));
  await browser.close();
})();
