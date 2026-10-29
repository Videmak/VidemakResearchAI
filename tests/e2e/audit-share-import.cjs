// Share dialog actions (invite by email, general access, Copy link), a Word round trip (the
// exported .docx opened again with "Open a Word file") and Account API keys (create, copy,
// revoke). Writes /shots/si-*.png.
//   node localproxy.cjs & sleep 1; DOCX=/shots/export/audit.docx BASE=http://localhost:8080 node audit-share-import.cjs
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const DOCX = process.env.DOCX || '/shots/export/audit.docx';
const P = (t) => ({ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: [{ type: 'text', text: t, styles: {} }], children: [] });

(async () => {
  const register = async (name) => (await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${name}-${Date.now()}@example.test`, password: 'correct-horse-9', full_name: name }) })).json();
  const owner = await register('Owner');
  const guest = await register('Guest');
  const id = crypto.randomUUID();
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ id, title: 'Share audit', blocks: [P('Shared paragraph.')] }) });
  const browser = await chromium.launch();
  const log = (line) => console.log(line);
  const errors = [];
  const as = async (who) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [who.token, who.user]);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    return { context, page };
  };
  const check = async (page, name, fn) => { try { log(`${name}: ${await fn()}`); } catch (error) { log(`${name}: ERROR ${error.message.split('\n')[0].slice(0, 160)}`); } };

  // Share.
  const { context: ownerContext, page } = await as(owner);
  await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.bn-editor').waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.locator('header button', { hasText: 'Share' }).first().click();
  const dialog = page.locator('[role="dialog"][aria-label="Share"]');
  await dialog.waitFor();
  await check(page, 'Invite as commenter', async () => {
    await dialog.getByPlaceholder(/Add people by email/).fill(guest.user.email);
    const role = dialog.locator('select').first();
    const options = await role.locator('option').allInnerTexts();
    await role.selectOption({ label: options.find((o) => /comment/i.test(o)) || options[1] });
    await dialog.getByRole('button', { name: 'Invite' }).click();
    await page.waitForTimeout(1500);
    return `roles [${options.join(', ')}] | listed: ${(await dialog.innerText()).includes(guest.user.email)} | toasts ${JSON.stringify(await page.locator('[role="status"]').allInnerTexts())}`;
  });
  await check(page, 'General access › Anyone with the link', async () => {
    const access = dialog.getByRole('button', { name: /Restricted|General access/ }).first();
    await access.click().catch(async () => { await dialog.locator('select').last().selectOption({ index: 1 }); });
    await page.waitForTimeout(300);
    const anyone = page.locator('button:visible, [role="option"]:visible, [role="menuitem"]:visible', { hasText: /Anyone with the link/ }).first();
    if (await anyone.count()) await anyone.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/si-share-access.png` });
    return (await dialog.innerText()).replace(/\s+/g, ' ').match(/General access.{0,80}/)?.[0] || 'n/a';
  });
  await check(page, 'Copy link', async () => {
    await dialog.getByRole('button', { name: /Copy link/ }).click();
    await page.waitForTimeout(600);
    return `clipboard: ${await page.evaluate(() => navigator.clipboard.readText())} | toasts ${JSON.stringify(await page.locator('[role="status"]').allInnerTexts())}`;
  });
  // The guest opens the document as a commenter.
  const { context: guestContext, page: guestPage } = await as(guest);
  await check(guestPage, 'Guest opens it', async () => {
    await guestPage.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
    await guestPage.locator('.bn-editor').waitFor({ timeout: 30000 });
    await guestPage.waitForTimeout(2500);
    const editable = await guestPage.locator('.bn-editor').getAttribute('contenteditable');
    await guestPage.screenshot({ path: `${OUT}/si-guest.png` });
    return `text: ${(await guestPage.locator('.bn-editor').innerText()).slice(0, 40)} | editable: ${editable} | mode: ${await guestPage.locator('button[aria-label="Editing mode"]').innerText().catch(() => '?')}`;
  });
  await guestContext.close();

  // Word round trip through "Open a Word file" on the home.
  await check(page, 'Open a Word file (round trip)', async () => {
    await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await page.locator('input[aria-label="Open a Word file"]').setInputFiles({ name: 'audit.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fs.readFileSync(DOCX) });
    await page.locator('.bn-editor').waitFor({ timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/si-imported.png` });
    const counts = await page.evaluate(() => ({
      headings: document.querySelectorAll('.bn-editor h1, .bn-editor h2, .bn-editor h3').length,
      citations: document.querySelectorAll('[data-inline-content-type="aiCitation"]').length,
      footnotes: document.querySelectorAll('[data-inline-content-type="footnote"]').length,
      math: document.querySelectorAll('.bn-editor .katex').length,
      tables: document.querySelectorAll('.bn-editor table').length,
      images: document.querySelectorAll('.bn-editor img').length,
      lists: document.querySelectorAll('[data-content-type$="ListItem"]').length,
      tracked: document.querySelectorAll('ins, del').length,
    }));
    return `title "${await page.locator('input[aria-label="Rename document"]').inputValue()}" | ${JSON.stringify(counts)}`;
  });

  // Account API keys.
  await check(page, 'Account › Create key, Copy, Revoke', async () => {
    await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Create key' }).click();
    await page.waitForTimeout(1500);
    const copy = page.getByRole('button', { name: /^Copy$/ });
    await copy.click();
    await page.waitForTimeout(300);
    const key = await page.evaluate(() => navigator.clipboard.readText());
    const keys = await (await fetch(`${BASE}/api/keys`, { headers: { Authorization: `Bearer ${owner.token}` } })).status;
    await page.getByRole('button', { name: 'Revoke' }).first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/si-account.png` });
    return `copied key looks like a key: ${/^[a-z]{2,}_[A-Za-z0-9_-]{16,}/.test(key)} (${key.slice(0, 6)}…) | revoked shown: ${(await page.locator('body').innerText()).match(/Revoked|revoked/) ? 'yes' : 'no'} | keys API ${keys}`;
  });
  log(`errors ${JSON.stringify(errors)}`);
  await ownerContext.close();
  await browser.close();
})();
