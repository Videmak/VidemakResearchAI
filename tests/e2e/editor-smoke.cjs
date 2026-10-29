// End-to-end smoke test: sign up, create a document, type, reload (persistence), second browser (live sync).
// Runs in the Playwright container on the videmak-net network: BASE=http://localhost:8080 node editor-smoke.cjs
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const email = `smoke-${Date.now()}@example.test`;

(async () => {
  const signup = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-9', full_name: 'Smoke Test' }) });
  const { token, user } = await signup.json();
  console.log('signup', signup.status, user?.email);
  // Production is HTTPS; the dev proxy is plain HTTP on an internal name, so mark it secure like prod.
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const open = async (opts = {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [token, user]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`${e.message.slice(0, 160)} @ ${(e.stack || '').split('\n').slice(1, 4).join(' | ').slice(0, 400)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/AI is not configured|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
    return { context, page, errors };
  };

  const a = await open();
  const t0 = Date.now();
  await a.page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
  await a.page.waitForTimeout(8000);
  await a.page.screenshot({ path: `${OUT}/smoke-1-home.png` });
  console.log('home loaded in', Date.now() - t0, 'ms; url', a.page.url());
  console.log('secure context:', await a.page.evaluate(() => [isSecureContext, typeof crypto.randomUUID, 'randomUUID' in crypto]));
  const blank = a.page.getByRole('button', { name: /blank document/i }).first();
  console.log('blank button', await blank.count());
  if (await blank.count()) await blank.click(); else await a.page.goto(`${BASE}/editor?new=1`);
  try {
    await a.page.waitForFunction(() => location.search.includes('doc='), null, { timeout: 30000 });
  } catch (error) {
    await a.page.screenshot({ path: `${OUT}/smoke-fail.png` });
    console.log('stuck at', a.page.url(), 'errors:', a.errors.slice(0, 10));
    throw error;
  }
  const docUrl = a.page.url();
  console.log('document', docUrl);
  await a.page.waitForTimeout(6000);
  const editable = a.page.locator('.bn-editor[contenteditable="true"], [contenteditable="true"].ProseMirror').first();
  await editable.click();
  await a.page.keyboard.type('Sleep supports memory consolidation in adults.', { delay: 15 });
  await a.page.waitForTimeout(4000);
  await a.page.screenshot({ path: `${OUT}/smoke-2-typed.png` });

  const b = await open();
  await b.page.goto(docUrl, { waitUntil: 'domcontentloaded' });
  await b.page.waitForTimeout(9000);
  const seenByB = await b.page.locator('.bn-editor').first().innerText().catch(() => '');
  console.log('second browser sees text:', seenByB.includes('Sleep supports memory'));
  await a.page.keyboard.type(' Live edit from A.', { delay: 15 });
  await b.page.waitForTimeout(2500);
  const liveB = await b.page.locator('.bn-editor').first().innerText().catch(() => '');
  console.log('live edit reached B:', liveB.includes('Live edit from A'));
  await b.page.screenshot({ path: `${OUT}/smoke-3-second-browser.png` });

  await a.page.reload({ waitUntil: 'domcontentloaded' });
  await a.page.waitForTimeout(8000);
  const afterReload = await a.page.locator('.bn-editor').first().innerText().catch(() => '');
  console.log('text after reload:', afterReload.includes('Sleep supports memory') && afterReload.includes('Live edit from A'));

  const list = await fetch(`${BASE}/api/ai-editor/documents`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  console.log('documents listed:', list.total);
  console.log('errors A:', a.errors.slice(0, 8));
  console.log('errors B:', b.errors.slice(0, 8));
  await browser.close();
})().catch((error) => { console.error('SMOKE FAILED', error); process.exit(1); });
