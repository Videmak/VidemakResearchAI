// The header (rename, Share, Review, Upgrade, ⋯ menu), the AI menu, the side rail, the status
// bar (citation style, zoom), version history (name, restore) and comment threads (add, reply,
// resolve, delete), each checked for what it says it does. Writes /shots/hdr-*.png.
//   node localproxy.cjs & sleep 1; BASE=http://localhost:8080 node audit-header.cjs
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';

const text = (value, styles = {}) => ({ type: 'text', text: value, styles });
const block = (type, content = [], props = {}) => ({ id: crypto.randomUUID(), type, props, content, children: [] });
const WALKER = '@article{walker2005,\n  title={Sleep, Memory, and Plasticity},\n  author={Walker, Matthew P. and Stickgold, Robert},\n  journal={Annual Review of Psychology},\n  volume={57},\n  pages={139--166},\n  year={2005}\n}';

(async () => {
  const auth = await signIn(BASE, 'hdr');
  const id = crypto.randomUUID();
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ id, title: 'Header audit', blocks: [
    block('heading', [text('Header audit')], { level: 1 }),
    block('paragraph', [text('Sleep supports memory consolidation '), { type: 'aiCitation', props: { citationId: 'w', base64: Buffer.from(WALKER).toString('base64'), displayText: '(Walker & Stickgold, 2005)', bibliography: '', style: 'apa', url: '' } }, text('.')]),
    block('paragraph', [text('Comment on this sentence please.')]),
  ] }) });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); window.open = (...a) => { window.__opened = (window.__opened || []).concat(String(a[0])); return null; }; }, [auth.token, auth.user]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  const log = (line) => console.log(line);
  const shot = (name) => page.screenshot({ path: `${OUT}/hdr-${name}.png` });
  const panelTitle = () => page.locator('.ce-assistant-panel h2:visible').first().innerText().catch(() => 'none');
  const check = async (name, fn) => { try { log(`${name}: ${await fn()}`); } catch (error) { log(`${name}: ERROR ${error.message.split('\n')[0].slice(0, 160)}`); } await page.keyboard.press('Escape'); };
  const openDoc = async () => { await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' }); await page.locator('.bn-editor').waitFor({ timeout: 30000 }); await page.waitForTimeout(2500); };
  await openDoc();

  await check('Rename title', async () => {
    const input = page.locator('input[aria-label="Rename document"]');
    await input.fill('Renamed by audit');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await openDoc();
    return `after reload: "${await input.inputValue()}" | tab title: "${await page.title()}"`;
  });
  await check('Share', async () => {
    await page.locator('header button', { hasText: 'Share' }).first().click();
    await page.waitForTimeout(600);
    const dialog = page.locator('[role="dialog"][aria-label="Share"]');
    const buttons = await dialog.locator('button:visible, input:visible, select:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || e.placeholder || e.tagName).trim().slice(0, 24)));
    await shot('share');
    const linkToggle = dialog.locator('button[role="switch"], input[type="checkbox"]').first();
    let clip = '';
    if (await linkToggle.count()) {
      await linkToggle.click();
      await page.waitForTimeout(800);
      const copy = dialog.locator('button', { hasText: /Copy link/ }).first();
      if (await copy.count()) { await copy.click(); await page.waitForTimeout(500); clip = await page.evaluate(() => navigator.clipboard.readText()); }
    }
    await shot('share-link-on');
    return `controls [${buttons.join(', ')}] | copied: ${clip.slice(0, 80)}`;
  });
  await check('Header Review', async () => { await page.locator('header button', { hasText: 'Review' }).first().click(); await page.waitForTimeout(600); return `panel: ${await panelTitle()}`; });
  await check('Upgrade', async () => {
    await page.locator('header button', { hasText: 'Upgrade' }).first().click();
    await page.waitForTimeout(2500);
    const url = page.url().replace(BASE, '');
    const heading = await page.locator('h1').first().innerText().catch(() => '');
    await openDoc();
    return `went to ${url} ("${heading.slice(0, 40)}")`;
  });
  for (const label of ['Comments', 'Copy to clipboard', 'Version history', 'Document settings']) {
    await check(`⋯ › ${label}`, async () => {
      await page.locator('header button[aria-label="More"]').click();
      await page.waitForTimeout(300);
      await page.locator('button:visible', { hasText: label }).last().click();
      await page.waitForTimeout(900);
      const dialog = await page.locator('[role="dialog"]:visible').first().getAttribute('aria-label').catch(() => null);
      const clip = label === 'Copy to clipboard' ? await page.evaluate(() => navigator.clipboard.readText()) : '';
      if (dialog) await shot(`more-${label.replace(/\W+/g, '_')}`);
      return `panel: ${await panelTitle()} | dialog: ${dialog} ${clip ? `| clipboard: ${JSON.stringify(clip.slice(0, 60))}` : ''}`;
    });
  }
  await check('AI menu', async () => {
    await page.locator('header').getByRole('button', { name: 'AI', exact: true }).click();
    await page.waitForTimeout(400);
    await shot('ai-menu');
    const items = await page.locator('button:visible, [role="switch"]:visible').evaluateAll((els) => els.filter((e) => e.closest('[style*="position: fixed"]')).map((e) => `${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)}${e.getAttribute('aria-checked') ? '=' + e.getAttribute('aria-checked') : ''}${e.getAttribute('aria-pressed') ? '=' + e.getAttribute('aria-pressed') : ''}`));
    return items.join(' / ');
  });
  await check('AI menu › Write with AI', async () => {
    await page.locator('header').getByRole('button', { name: 'AI', exact: true }).click();
    await page.waitForTimeout(300);
    await page.locator('button:visible', { hasText: 'Write with AI' }).last().click();
    await page.waitForTimeout(800);
    await shot('write-with-ai');
    const dialog = page.locator('[role="dialog"][aria-label="Write with AI"]');
    const opened = await dialog.count();
    if (!opened) return 'NO DIALOG';
    await dialog.locator('textarea').fill('How does sleep affect memory consolidation in university students?');
    await dialog.getByRole('button', { name: 'Start writing' }).click();
    await page.waitForTimeout(45000);
    await shot('write-with-ai-result');
    const cards = await page.locator('button:visible', { hasText: /^(Accept|Insert|Use this|Keep)/ }).allInnerTexts();
    return `dialog opened, started | buttons now: ${cards.slice(0, 6).join(', ')} | page text: ${(await page.locator('.bn-editor').innerText()).replace(/\s+/g, ' ').slice(0, 100)}`;
  });
  await page.keyboard.press('Escape');
  for (const label of ['Live review', 'AI detection']) {
    await check(`AI menu › ${label}`, async () => {
      await page.locator('header').getByRole('button', { name: 'AI', exact: true }).click();
      await page.waitForTimeout(300);
      const item = page.locator('button:visible, [role="switch"]:visible', { hasText: label }).last();
      const before = await item.getAttribute('aria-checked') || await item.getAttribute('aria-pressed');
      await item.click();
      await page.waitForTimeout(1200);
      await shot(`ai-${label.replace(/\W+/g, '_')}`);
      return `state ${before} → panel: ${await panelTitle()} | dialog: ${await page.locator('[role="dialog"]:visible').first().getAttribute('aria-label').catch(() => 'none')} | toasts: ${JSON.stringify(await page.locator('[role="status"]').allInnerTexts())}`;
    });
  }
  // Rail.
  for (const label of ['Outline', 'AI Chat', 'Comments', 'Review', 'Library', 'Find papers', 'Write with AI', 'Help']) {
    await check(`rail › ${label}`, async () => {
      const button = page.locator(`nav[aria-label="Document tools"] button[aria-label="${label}"], nav[aria-label="Document tools"] button[aria-label="Hide outline"]`).first();
      await button.click();
      await page.waitForTimeout(700);
      const opened = await page.evaluate(() => window.__opened || []);
      const result = `panel: ${await panelTitle()} | dialog: ${await page.locator('[role="dialog"]:visible').first().getAttribute('aria-label').catch(() => 'none')} | outline: ${await page.locator('[aria-label*="utline" i]:visible').count()} | opened: ${opened.join(',')}`;
      if (label !== 'Write with AI' && label !== 'Help') { await button.click().catch(() => {}); await page.waitForTimeout(300); }
      return result;
    });
  }
  // Status bar: citation style and zoom.
  await check('Citation style › IEEE', async () => {
    await page.locator('button[aria-label="Select citation style"]').click();
    await page.waitForTimeout(500);
    await shot('style-list');
    await page.locator('[role="option"]:visible, button:visible', { hasText: /^IEEE/ }).first().click();
    await page.waitForTimeout(1500);
    return `in text: ${await page.locator('[data-inline-content-type="aiCitation"]').first().innerText()} | reference: ${(await page.locator('.bn-block-content', { hasText: 'Walker' }).last().innerText()).slice(0, 80)}`;
  });
  await check('Zoom', async () => {
    const label = () => page.locator('button', { hasText: /Fit|\d+%/ }).last().innerText();
    const a = await label();
    await page.locator('button[aria-label="Zoom in"]').click();
    const b = await label();
    await page.locator('button[aria-label="Zoom out"]').click();
    await page.locator('button[aria-label="Zoom out"]').click();
    const c = await label();
    await page.locator('button', { hasText: /\d+%/ }).last().click();
    const d = await label();
    return `${a} → in ${b} → out×2 ${c} → click ${d}`;
  });
  // Comments: add, reply, resolve, delete.
  await check('Comment thread', async () => {
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.bn-block-content')].find((n) => n.textContent.startsWith('Comment on this'));
      const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 7);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      document.querySelector('.bn-editor').focus();
    });
    await page.locator('[data-testid="editor-toolbar-row"] button[aria-label^="Add comment"]').click();
    await page.waitForTimeout(600);
    await page.locator('[aria-label="New comment"]:visible').click();
    await page.keyboard.type('Please define consolidation.');
    await page.locator('.ce-assistant-panel button:visible', { hasText: /^Comment$/ }).click();
    await page.waitForTimeout(1500);
    const panel = page.locator('.ce-assistant-panel');
    const added = (await panel.innerText()).includes('Please define consolidation.');
    const highlighted = await page.locator('.bn-editor [data-comment-id], .bn-editor .ce-comment-highlight, .bn-editor mark').count();
    await shot('comment-added');
    const composerClosed = (await panel.locator('[aria-label="New comment"]').count()) === 0;
    await panel.locator('article', { hasText: 'Please define consolidation.' }).first().click();
    await page.waitForTimeout(400);
    const reply = panel.locator('[aria-label="Reply"]:visible').first();
    let replied = false;
    if (await reply.count()) { await reply.click(); await page.keyboard.type('Done, defined in the intro.'); await page.keyboard.press('Enter'); await page.waitForTimeout(1200); replied = (await panel.locator('article', { hasText: 'Please define consolidation.' }).first().innerText()).includes('Done, defined in the intro.'); }
    const threads = await panel.locator('article').count();
    const cardButtons = await panel.locator('button:visible').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 20)).filter(Boolean));
    await shot('comment-replied');
    const resolve = panel.locator('button[aria-label^="Resolve"], button:has-text("Resolve")').first();
    let resolved = 'no button';
    if (await resolve.count()) { await resolve.click(); await page.waitForTimeout(1000); resolved = String(!(await panel.innerText()).includes('Please define consolidation.') || (await panel.innerText()).includes('Resolved')); }
    return `added ${added}, composer closed after posting ${composerClosed}, reply inside the thread ${replied} (threads: ${threads}), resolved ${resolved}`;
  });
  // Version history: name the current version, edit, restore.
  await check('Version history', async () => {
    await page.locator('header button[aria-label="More"]').click();
    await page.locator('button:visible', { hasText: 'Version history' }).last().click();
    await page.waitForTimeout(1500);
    const dialog = page.locator('[role="dialog"][aria-label="Version history"]');
    await dialog.getByRole('button', { name: 'Name current version' }).click();
    await page.waitForTimeout(400);
    const nameInput = page.locator('input:visible').last();
    await nameInput.fill('Before audit edit');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    const named = (await dialog.innerText()).includes('Before audit edit');
    await dialog.getByRole('button', { name: /Close/ }).first().click().catch(() => page.keyboard.press('Escape'));
    await page.waitForTimeout(500);
    // Edit, then restore the named version.
    const para = page.locator('.bn-block-content', { hasText: 'Comment on this' }).first();
    await para.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' EXTRA TEXT TO UNDO');
    await page.waitForTimeout(2500);
    await page.locator('header button[aria-label="More"]').click();
    await page.locator('button:visible', { hasText: 'Version history' }).last().click();
    await page.waitForTimeout(1500);
    await dialog.locator('button', { hasText: 'Before audit edit' }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await shot('history');
    await dialog.getByRole('button', { name: /Restore this version/ }).click();
    await page.waitForTimeout(800);
    const confirm = page.locator('[role="dialog"]:visible button', { hasText: /^Restore/ }).last();
    if (await confirm.count()) await confirm.click();
    await page.waitForTimeout(2500);
    return `named ${named} | after restore the extra text is gone: ${!(await page.locator('.bn-editor').innerText()).includes('EXTRA TEXT TO UNDO')}`;
  });
  log(`errors ${JSON.stringify(errors)}`);
  await browser.close();
})();
