// The documents page with the side panels open: the menu never folds and AI Chat never
// floats; the panels narrow a little on smaller screens and the page lays itself out by the width
// it gets. No sideways scroll anywhere. Writes /shots/panels-*.png.
//   (node localproxy.cjs &) ; BASE=http://localhost:8080 node home-with-panels.cjs
const { chromium, devices } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`); };

(async () => {
  const auth = await signIn(BASE, 'panels', 'Alexandra Whitfield');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` };
  const existing = await (await fetch(`${BASE}/api/ai-editor/documents`, { headers })).json().catch(() => []);
  if ((Array.isArray(existing) ? existing : existing.documents || []).length < 4) {
    for (const title of ['Research proposal: malaria in pregnancy', 'Sleep and memory: literature review', 'Essay draft for HIST 210', 'Untitled document']) {
      await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers, body: JSON.stringify({ title }) });
    }
  }
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });

  /** Widths of the menu and the page, sideways scroll, and tile titles that wrapped. */
  const measure = (page) => page.evaluate(() => {
    const nav = [...document.querySelectorAll('aside[aria-label="App"]')].find((element) => element.getBoundingClientRect().width > 0 && !element.closest('.fixed'));
    const home = document.querySelector('.ai-editor-theme .min-h-full')?.parentElement;
    const titles = [...document.querySelectorAll('h2')].find((h) => /Start something new/i.test(h.textContent || ''))?.nextElementSibling;
    const wrapped = titles ? [...titles.querySelectorAll('b, span.block')].filter((el) => el.getBoundingClientRect().height > 26 && !/text-\[1[23]/.test(el.className)).map((el) => el.textContent) : [];
    return {
      nav: nav ? Math.round(nav.getBoundingClientRect().width) : 0,
      page: home ? Math.round(home.getBoundingClientRect().width) : 0,
      pageScroll: home ? home.scrollWidth - home.clientWidth : 0,
      docScroll: document.documentElement.scrollWidth - window.innerWidth,
      wrapped,
      greeting: document.querySelector('h1')?.textContent || '',
      chat: (() => { const chat = document.querySelector('.ce-chat-sideload'); return chat && chat.getBoundingClientRect().width ? getComputedStyle(chat).position : 'closed'; })(),
    };
  });

  async function open(viewport, { drawer = false, menu = false, chat = false, chatFirst = false } = {}) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));
    await page.goto(`${BASE}/editor${drawer && !chatFirst ? '?tool=papers' : ''}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Recent documents').first().waitFor({ timeout: 20000 });
    if (chatFirst) {
      // Below 1280 px the drawer takes the menu's place: open AI Chat first, then Find papers.
      await page.locator('aside[aria-label="App"]').getByRole('button', { name: 'AI Chat' }).first().click();
      await page.locator('aside[aria-label="App"]').getByRole('button', { name: 'Find papers' }).first().click();
      await page.waitForTimeout(700);
      return { context, page, errors };
    }
    if (menu) await page.getByRole('button', { name: 'Show menu', exact: true }).click();
    if (chat) await page.locator('aside[aria-label="App"]').getByRole('button', { name: 'AI Chat' }).first().click();
    await page.waitForTimeout(700);
    return { context, page, errors };
  }

  // The reported case: 1280 px, menu + Find papers + AI Chat, and bigger screens.
  for (const [label, viewport] of [['1280', { width: 1280, height: 720 }], ['1440', { width: 1440, height: 900 }], ['1600', { width: 1600, height: 900 }], ['1920', { width: 1920, height: 1080 }]]) {
    const { context, page, errors } = await open(viewport, { drawer: true, menu: true, chat: true });
    const m = await measure(page);
    check(`${label}: all panels open → full menu stays, chat beside the page`, m.nav === 232 && m.chat === 'relative', `menu ${m.nav}px, page ${m.page}px, chat ${m.chat}`);
    check(`${label}: no sideways scroll`, m.pageScroll <= 0 && m.docScroll <= 0, `page ${m.pageScroll}, document ${m.docScroll}`);
    check(`${label}: tile names on one line`, m.wrapped.length === 0, m.wrapped.join(', '));
    check(`${label}: no page errors`, !errors.length, errors.join(' | '));
    await page.screenshot({ path: `${OUT}/panels-${label}-all.png` });
    if (label === '1280') {
      // Closing AI Chat gives the page its room back.
      await page.locator('.ce-chat-sideload').getByRole('button', { name: 'Close panel' }).first().click();
      await page.waitForTimeout(500);
      const after = await measure(page);
      check('closing AI Chat widens the page', after.page > m.page + 300 && after.nav === 232, `page ${m.page}px → ${after.page}px`);
      await page.screenshot({ path: `${OUT}/panels-1280-chat-closed.png` });
    }
    await context.close();
  }

  // Other combinations at the reported size.
  for (const [label, options, viewport] of [
    ['chat-only', { chat: true }, { width: 1280, height: 720 }],
    ['drawer-only', { drawer: true }, { width: 1280, height: 720 }],
    ['nothing', {}, { width: 1280, height: 720 }],
    ['1024-all', { drawer: true, chat: true, chatFirst: true }, { width: 1024, height: 768 }],
    ['1024-chat', { chat: true }, { width: 1024, height: 768 }],
    ['tablet', {}, { width: 820, height: 1180 }],
  ]) {
    const { context, page, errors } = await open(viewport, options);
    const m = await measure(page);
    check(`${label}: no sideways scroll, tiles on one line`, m.pageScroll <= 0 && m.docScroll <= 0 && m.wrapped.length === 0, `menu ${m.nav}, page ${m.page}, ${m.wrapped.join(', ')}`);
    check(`${label}: no page errors`, !errors.length, errors.join(' | '));
    if (label === '1024-all') check('1024: Find papers takes the menu\'s place, chat stays beside the page', m.nav === 0 && m.chat === 'relative' && m.page >= 380, `menu ${m.nav}, chat ${m.chat}, page ${m.page}px`);
    if (label === '1024-chat') check('1024: menu and chat both fit', m.nav === 232 && m.chat === 'relative' && m.page >= 400, `menu ${m.nav}, page ${m.page}px`);
    if (label === 'tablet') check('tablet: documents page has the menu', m.nav === 232, `menu ${m.nav}px, page ${m.page}px`);
    await page.screenshot({ path: `${OUT}/panels-${label}.png` });
    await context.close();
  }

  // Phones keep their own layout.
  const phone = await browser.newContext(devices['iPhone 13']);
  await phone.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  const phonePage = await phone.newPage();
  await phonePage.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
  await phonePage.getByText('Start something new').first().waitFor({ timeout: 20000 });
  await phonePage.waitForTimeout(600);
  check('phone: phone layout (Recent heading, no sideways scroll)', await phonePage.getByRole('heading', { name: 'Recent', exact: true }).isVisible() && (await phonePage.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  await phonePage.screenshot({ path: `${OUT}/panels-phone.png` });
  await phone.close();

  // In a document: opening the document's AI Chat at 1280 keeps the menu.
  const docs = await (await fetch(`${BASE}/api/ai-editor/documents`, { headers })).json();
  const first = (Array.isArray(docs) ? docs : docs.documents || [])[0];
  if (first) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
    const page = await context.newPage();
    await page.goto(`${BASE}/editor?doc=${first.id}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[contenteditable="true"]').first().waitFor({ timeout: 30000 });
    const before = await measure(page);
    await page.locator('aside[aria-label="App"]').getByRole('button', { name: 'AI Chat' }).first().click();
    await page.waitForTimeout(800);
    const after = await measure(page);
    const pageWidth = await page.evaluate(() => Math.round(document.querySelector('[contenteditable="true"]')?.getBoundingClientRect().width || 0));
    check('document: menu stays when AI Chat opens, page still readable', before.nav === 232 && after.nav === 232 && after.docScroll <= 0 && pageWidth >= 420, `menu ${before.nav} → ${after.nav}px, text column ${pageWidth}px`);
    await page.screenshot({ path: `${OUT}/panels-document-chat.png` });
    await context.close();
  }

  await browser.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
