// Library, Find papers and AI Chat from the app menu open as side panels everywhere (never the
// old pages): left drawer in place of the menu (with "Show menu"), chat on the right, phones
// full screen, old /library /papers /chat links open the panels. Writes /shots/side-*.png.
//   BASE=http://videmak-router:8080 node sideloads.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://videmak-router:8080';
const OUT = process.env.OUT || '/shots';

const text = (t) => ({ type: 'text', text: t, styles: {} });
const block = (type, content, props = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });
const SAMPLE = [
  block('heading', [text('Sleep and Memory Consolidation')], { level: 1 }),
  block('paragraph', [text('Sleep supports the consolidation of declarative memories in students.')]),
];

(async () => {
  const auth = await signIn(BASE, 'e2e');
  const id = crypto.randomUUID();
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Sleep and memory', blocks: SAMPLE }) });

  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const open = async (width, height) => {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(`pageerror ${e.message.slice(0, 200)}`));
    return { context, page };
  };
  const visible = (page, selector) => page.locator(selector).first().isVisible().catch(() => false);
  const drawer = '.ce-tool-drawer';
  const chat = '.ce-chat-sideload';

  // 1. Documents home, desktop.
  {
    const { context, page } = await open(1440, 900);
    const shot = (name) => page.screenshot({ path: `${OUT}/side-home-${name}.png` });
    await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const nav = page.locator('aside[aria-label="App"]');
    await nav.getByRole('button', { name: 'Library' }).click();
    await page.waitForTimeout(900);
    console.log('home Library: url', page.url().replace(BASE, ''), '| drawer', await visible(page, drawer), '| menu hidden', !(await nav.isVisible()));
    await shot('1-library');
    await page.locator(drawer).getByRole('button', { name: 'Show menu' }).click();
    await page.waitForTimeout(500);
    console.log('show menu: menu visible', await nav.isVisible(), '| drawer', await visible(page, drawer));
    await shot('2-library-with-menu');
    await page.locator(drawer).getByRole('tab', { name: 'Find papers' }).click();
    await page.locator(drawer).getByRole('textbox', { name: 'Search papers' }).fill('sleep and memory consolidation');
    await page.keyboard.press('Enter');
    await page.locator(`${drawer} .ce-paper-card`).first().waitFor({ timeout: 45000 }).catch(() => {});
    console.log('papers results:', await page.locator(`${drawer} .ce-paper-card`).count(), '|', (await page.locator(drawer).innerText()).replace(/\s+/g, ' ').slice(0, 160));
    await shot('3-papers');
    const copy = page.locator(`${drawer} .ce-paper-card`).first().getByRole('button', { name: 'Copy' });
    if (await copy.count()) {
      await copy.click();
      await page.waitForTimeout(800);
      console.log('copied reference:', JSON.stringify((await page.evaluate(() => navigator.clipboard.readText()).catch(() => '')).slice(0, 140)));
    }
    await page.locator(drawer).getByRole('button', { name: 'Hide menu' }).click();
    await nav.isVisible().then((v) => console.log('hide menu: menu visible', v));
    // AI Chat on the right.
    await page.locator(drawer).getByRole('button', { name: 'Close panel' }).click();
    await page.waitForTimeout(400);
    await nav.getByRole('button', { name: 'AI Chat' }).click();
    await page.waitForTimeout(900);
    console.log('home AI Chat: url', page.url().replace(BASE, ''), '| chat', await visible(page, chat), '| drawer', await visible(page, drawer));
    await shot('4-chat');
    await page.locator(chat).getByRole('button', { name: 'Add context' }).click();
    await page.waitForTimeout(800);
    await shot('5-add-context');
    await page.keyboard.press('Escape');
    await page.locator(chat).getByRole('textbox').fill('In one sentence, what does slow-wave sleep do for memory?');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.ce-chat-sideload button[aria-label="Stop"]'), null, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(800);
    console.log('chat answer:', JSON.stringify((await page.locator(`${chat} .ce-chat-markdown`).last().innerText().catch(() => '')).slice(0, 160)));
    await shot('6-chat-answer');
    console.log('home errors', JSON.stringify(page.errors));
    await context.close();
  }

  // 2. An open document: the menu's Find papers on the left cites into the page; AI Chat is the document chat.
  {
    const { context, page } = await open(1440, 900);
    const shot = (name) => page.screenshot({ path: `${OUT}/side-doc-${name}.png` });
    await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);
    const nav = page.locator('aside[aria-label="App"]');
    await page.locator('.bn-block-content', { hasText: 'declarative memories' }).first().click();
    await page.keyboard.press('End');
    await nav.getByRole('button', { name: 'Find papers' }).click();
    await page.waitForTimeout(900);
    console.log('doc Find papers: url kept', page.url().includes(`doc=${id}`), '| drawer', await visible(page, drawer), '| menu hidden', !(await nav.isVisible()));
    await page.locator(drawer).getByRole('textbox', { name: 'Search papers' }).fill('sleep memory consolidation');
    await page.keyboard.press('Enter');
    await page.locator(`${drawer} .ce-paper-card`).first().waitFor({ timeout: 45000 }).catch(() => {});
    await shot('1-papers');
    const before = await page.locator('[data-inline-content-type="aiCitation"]').count();
    await page.locator(`${drawer} .ce-paper-card`).first().getByRole('button', { name: 'Cite' }).click().catch((e) => console.log('cite click failed', e.message.slice(0, 80)));
    await page.waitForTimeout(1500);
    console.log('citations before/after Cite:', before, await page.locator('[data-inline-content-type="aiCitation"]').count());
    await shot('2-cited');
    await page.locator(drawer).getByRole('button', { name: 'Close panel' }).click();
    await page.waitForTimeout(400);
    await nav.getByRole('button', { name: 'AI Chat' }).click();
    await page.waitForTimeout(900);
    const panel = page.locator('.ce-assistant-panel');
    console.log('doc AI Chat: document panel', await panel.isVisible().catch(() => false), '| app chat', await visible(page, chat), '| title bars', await panel.locator('h2:visible').count(), JSON.stringify(await panel.locator('h2:visible').allInnerTexts()));
    await shot('3-chat');
    console.log('doc errors', JSON.stringify(page.errors));
    await context.close();
  }

  // 3. A page outside the editor (Account) and an old link.
  {
    const { context, page } = await open(1440, 900);
    const shot = (name) => page.screenshot({ path: `${OUT}/side-account-${name}.png` });
    await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await page.locator('aside').first().getByRole('button', { name: 'Library' }).click();
    await page.waitForTimeout(1500);
    console.log('account Library: url', page.url().replace(BASE, ''), '| drawer', await visible(page, drawer));
    await shot('1-library');
    await page.locator('aside').first().getByRole('button', { name: 'AI Chat' }).click().catch(async () => {
      await page.locator(drawer).getByRole('button', { name: 'Show menu' }).click();
      await page.locator('aside').first().getByRole('button', { name: 'AI Chat' }).click();
    });
    await page.waitForTimeout(1200);
    console.log('account AI Chat: url', page.url().replace(BASE, ''), '| chat', await visible(page, chat));
    await shot('2-chat');
    await page.goto(`${BASE}/papers`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    console.log('old /papers →', page.url().replace(BASE, ''), '| drawer', await visible(page, drawer), '| tab', await page.locator(`${drawer} [role="tab"][aria-selected="true"]`).innerText().catch(() => ''));
    await shot('3-old-papers-link');
    console.log('account errors', JSON.stringify(page.errors));
    await context.close();
  }

  // 4. Tablet (overlay) and phone (full screen).
  for (const [width, height, name] of [[900, 900, 'tablet'], [390, 844, 'phone']]) {
    const { context, page } = await open(width, height);
    const shot = (n) => page.screenshot({ path: `${OUT}/side-${name}-${n}.png` });
    await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    if (name === 'phone') {
      await page.locator('nav[aria-label="Main"]').getByRole('button', { name: 'Library' }).click();
    } else {
      await page.goto(`${BASE}/editor?tool=library`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
    }
    await page.waitForTimeout(900);
    const box = await page.locator(drawer).boundingBox().catch(() => null);
    console.log(name, 'Library drawer box', JSON.stringify(box && { x: Math.round(box.x), w: Math.round(box.width), h: Math.round(box.height) }));
    await shot('1-library');
    await page.locator(drawer).getByRole('button', { name: 'Close panel' }).first().click();
    await page.waitForTimeout(400);
    if (name === 'phone') await page.locator('nav[aria-label="Main"]').getByRole('button', { name: 'Chat' }).click();
    else await page.goto(`${BASE}/editor?tool=chat`, { waitUntil: 'domcontentloaded' }).then(() => page.waitForTimeout(5000));
    await page.waitForTimeout(900);
    const chatBox = await page.locator(chat).boundingBox().catch(() => null);
    console.log(name, 'chat box', JSON.stringify(chatBox && { x: Math.round(chatBox.x), w: Math.round(chatBox.width), h: Math.round(chatBox.height) }));
    await shot('2-chat');
    console.log(name, 'errors', JSON.stringify(page.errors));
    await context.close();
  }
  await browser.close();
})();
