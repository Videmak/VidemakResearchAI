// The documents home (search, All/Owned/Shared, grid/list, a card's ⋯ actions, templates, New
// document) and the phone editor toolbar, each checked for what it says it does.
// Writes /shots/home-*.png.
//   node localproxy.cjs & sleep 1; BASE=http://localhost:8080 node audit-home.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const P = (t) => ({ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [{ type: 'text', text: t, styles: {} }], children: [] });

(async () => {
  const auth = await signIn(BASE, 'home');
  for (const title of ['Alpha thesis chapter', 'Beta lab report', 'Gamma essay']) {
    await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id: crypto.randomUUID(), title, blocks: [P(`${title} body text.`)] }) });
  }
  const browser = await chromium.launch();
  const log = (line) => console.log(line);
  const errors = [];
  const setup = async (width, height) => {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); window.open = (...a) => { window.__opened = (window.__opened || []).concat(String(a[0])); return null; }; }, [auth.token, auth.user]);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    return { context, page };
  };
  const check = async (page, name, fn) => { try { log(`${name}: ${await fn()}`); } catch (error) { log(`${name}: ERROR ${error.message.split('\n')[0].slice(0, 160)}`); } await page.keyboard.press('Escape'); };

  {
    const { context, page } = await setup(1440, 900);
    await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const cards = () => page.locator('article:visible').evaluateAll((els) => els.map((e) => e.innerText.split('\n').find((l) => /Alpha|Beta|Gamma|Untitled/.test(l)) || '').filter(Boolean));
    await check(page, 'cards', async () => JSON.stringify(await cards()));
    await check(page, 'search "beta"', async () => { await page.locator('input[aria-label="Search documents"]:visible').fill('beta'); await page.waitForTimeout(500); const r = JSON.stringify(await cards()); await page.locator('input[aria-label="Search documents"]:visible').fill(''); return r; });
    await check(page, 'Ctrl+K focuses search', async () => { await page.locator('h1:visible').first().click(); await page.keyboard.press('Control+k'); return page.evaluate(() => document.activeElement?.getAttribute('aria-label')); });
    await check(page, 'list view', async () => { await page.locator('button[aria-label*="List" i]:visible').first().click(); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/home-list.png` }); return `rows: ${await page.locator('text=Alpha thesis chapter').count()}`; });
    await page.locator('button[aria-label*="Grid" i]:visible').first().click().catch(() => {});
    await check(page, 'Owned / Shared filters', async () => {
      await page.locator('button:visible', { hasText: /^Shared with me$/ }).click(); await page.waitForTimeout(400);
      const shared = await page.locator('text=Alpha thesis chapter').count();
      await page.locator('button:visible', { hasText: /^Owned by me$/ }).click(); await page.waitForTimeout(400);
      const owned = await page.locator('text=Alpha thesis chapter').count();
      await page.locator('button:visible', { hasText: /^All$/ }).click();
      return `shared shows Alpha: ${shared} | owned shows Alpha: ${owned}`;
    });
    await check(page, 'card ⋯ menu', async () => {
      await page.locator('button[aria-label="More actions for Beta lab report"]:visible').first().click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/home-card-menu.png` });
      return (await page.locator('[role="menu"]:visible button, [role="menuitem"]:visible').allInnerTexts()).join(' / ');
    });
    await check(page, 'card ⋯ › Rename', async () => {
      await page.locator('button[aria-label="More actions for Beta lab report"]:visible').first().click();
      await page.locator('[role="menuitem"]:visible, [role="menu"]:visible button', { hasText: /Rename/ }).first().click();
      await page.waitForTimeout(400);
      const input = page.locator('[role="dialog"] input:visible, input:visible[value="Beta lab report"]').first();
      await input.fill('Beta lab report v2');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1200);
      return `renamed: ${await page.locator('text=Beta lab report v2').count() > 0}`;
    });
    await check(page, 'card ⋯ › Open in new tab', async () => {
      await page.locator('button[aria-label="More actions for Gamma essay"]:visible').first().click();
      const item = page.locator('[role="menuitem"]:visible, [role="menu"]:visible button', { hasText: /new tab/i }).first();
      if (!(await item.count())) return 'no such item';
      await item.click();
      return `window.open: ${(await page.evaluate(() => window.__opened || [])).join(',')}`;
    });
    await check(page, 'card ⋯ › Delete', async () => {
      await page.locator('button[aria-label="More actions for Gamma essay"]:visible').first().click();
      await page.locator('[role="menuitem"]:visible, [role="menu"]:visible button', { hasText: /Delete|trash/i }).first().click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/home-delete-confirm.png` });
      await page.locator('[role="dialog"]:visible button, [role="alertdialog"]:visible button', { hasText: /^Delete$/ }).click();
      await page.waitForTimeout(1500);
      return `Gamma still listed: ${await page.locator('text=Gamma essay').count()}`;
    });
    await check(page, 'template › Literature review', async () => {
      await page.locator('button:visible', { hasText: 'Literature review' }).first().click();
      await page.waitForTimeout(5000);
      return `url ${page.url().replace(BASE, '').slice(0, 30)} | headings: ${(await page.locator('.bn-editor h1, .bn-editor h2').allInnerTexts()).slice(0, 5).join(' | ')}`;
    });
    await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await check(page, '+ New document', async () => { await page.locator('button:visible', { hasText: '+ New document' }).click(); await page.waitForTimeout(4000); return `url ${page.url().replace(BASE, '').slice(0, 30)} | editor: ${await page.locator('.bn-editor').count()}`; });
    await context.close();
  }

  // Phone: the editor's own toolbar.
  {
    const { context, page } = await setup(390, 844);
    const id = crypto.randomUUID();
    await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Phone audit', blocks: [P('Phone paragraph one with words.'), P('Phone paragraph two.')] }) });
    await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.bn-editor').waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.locator('.bn-block-content', { hasText: 'Phone paragraph one' }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/home-phone-toolbar.png` });
    const labels = await page.locator('button:visible').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().top > window.innerHeight - 140).map((e) => e.getAttribute('aria-label') || e.textContent.trim()).filter(Boolean));
    log(`phone toolbar: ${labels.join(' / ')}`);
    for (const label of ['Format', 'Insert citation', 'Insert equation', 'AI tools']) {
      await check(page, `phone › ${label}`, async () => {
        await page.locator('.bn-block-content', { hasText: 'Phone paragraph one' }).click();
        await page.waitForTimeout(500);
        const button = page.locator(`button[aria-label="${label}"]:visible`).last();
        if (!(await button.count())) return 'not on the toolbar';
        await button.click();
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${OUT}/home-phone-${label.replace(/\W+/g, '_')}.png` });
        const sheet = await page.locator('button:visible').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().top > window.innerHeight * 0.45).map((e) => e.getAttribute('aria-label') || e.textContent.trim()).filter(Boolean).slice(0, 16));
        const dialog = await page.locator('[role="dialog"]:visible').first().getAttribute('aria-label').catch(() => null);
        const result = `dialog: ${dialog} | menu items: ${await page.locator('.bn-suggestion-menu-item:visible').count()} | lower half: ${sheet.join(', ')}`;
        await page.keyboard.press('Escape');
        await page.locator('button[aria-label="Close"]:visible, button[aria-label^="Close"]:visible').first().click().catch(() => {});
        return result;
      });
    }
    // Format sheet › Bold actually bolds the selection.
    await check(page, 'phone › Format › Bold', async () => {
      await page.evaluate(() => {
        const el = [...document.querySelectorAll('.bn-block-content')].find((n) => n.textContent.includes('Phone paragraph one'));
        const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
        const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 5);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        document.querySelector('.bn-editor').focus();
      });
      await page.waitForTimeout(400);
      await page.locator('button[aria-label="Format"]:visible').last().click();
      await page.waitForTimeout(500);
      await page.locator('button[aria-label="Bold"]:visible').last().click();
      await page.waitForTimeout(400);
      return `strong in paragraph: ${await page.locator('.bn-block-content', { hasText: 'Phone paragraph one' }).locator('strong').count()}`;
    });
    await context.close();
  }
  log(`errors ${JSON.stringify(errors)}`);
  await browser.close();
})();
