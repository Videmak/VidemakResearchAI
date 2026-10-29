// Storage, email and newsletter end to end on staging, against throwaway services on videmak-net:
// an S3-compatible server (versitygw, path-style) and Mailpit (SMTP catcher). Puts every setting
// back to how it was found (Storage: this server, Email and Newsletter off) and deletes its files.
//   (node localproxy.cjs &) ; BASE=http://localhost:8080 DATABASE_URL=… S3_TEST_KEY=… S3_TEST_SECRET=… node integrations.cjs
const { chromium, devices } = require('playwright');
const { Client } = require('pg');
const { AwsClient } = require('aws4fetch');

const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/shots';
const S3 = process.env.S3_TEST_URL || 'http://videmak-test-s3:7070';
const MAIL = process.env.MAILPIT_URL || 'http://videmak-test-mailpit:8025';
const BUCKET = 'videmak-test';
const PREFIX = `e2e-${Date.now()}`;
const PASSWORD = 'correct-horse-9';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`); };
const s3 = new AwsClient({ accessKeyId: process.env.S3_TEST_KEY, secretAccessKey: process.env.S3_TEST_SECRET, service: 's3', region: 'us-east-1' });
const objectUrl = (key) => `${S3}/${BUCKET}/${PREFIX}/${key}`;
const inBucket = async (key) => (await s3.fetch(objectUrl(key), { method: 'HEAD' })).status === 200;
const listBucket = async (prefix) => (await (await s3.fetch(`${S3}/${BUCKET}?list-type=2&prefix=${encodeURIComponent(`${PREFIX}/${prefix}`)}`)).text()).match(/<Key>[^<]+<\/Key>/g) || [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A one-page PDF with real text (offsets computed, so PDF readers accept it). */
function pdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 14 Tf 72 700 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => { const at = body.length; body += `${index + 1} 0 obj\n${object}\nendobj\n`; return at; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function call(token, path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, body };
}
const save = (token, values) => call(token, '/api/admin/settings', { method: 'PUT', body: JSON.stringify({ values }) });
const upload = (token, name, bytes, type = 'application/pdf', path = '/api/library/documents/upload') => {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  return call(token, path, { method: 'POST', body: form });
};

async function mailTo(address, subject, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)).json();
    const found = (list.messages || []).find((message) => message.Subject === subject);
    if (found) return (await fetch(`${MAIL}/api/v1/message/${found.ID}`)).json();
    await wait(500);
  }
  return null;
}
const linkIn = (message, path) => (message?.Text || '').match(new RegExp(`https?://[^\\s]+${path}#token=[A-Za-z0-9._-]+`))?.[0] ?? null;

async function adminSession(db) {
  const email = `integrations-${Date.now()}@example.test`;
  const registered = await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, full_name: 'Ida Integrations' }) });
  let login = registered.status === 429 ? null : await registered.json();
  if (!login) {
    const { rows } = await db.query("select email from users where email like 'integrations-%@example.test' or email like 'adminui-%@example.test' order by created_at desc limit 1");
    login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: rows[0].email, password: PASSWORD }) })).json();
  }
  await db.query('update users set is_admin = true where id = $1', [login.user.id]);
  login.user.is_admin = true;
  return login;
}

const RESET = {
  storageProvider: null, s3Region: null, s3Bucket: null, s3AccessKeyId: null, s3SecretAccessKey: null, s3Endpoint: null, s3UrlStyle: null, s3Prefix: null,
  mailProvider: null, mailFrom: null, mailReplyTo: null, smtpHost: null, smtpPort: null, smtpSecurity: null, smtpUser: null, smtpPassword: null, resendApiKey: null,
  newsletterProvider: null, mailcheapApiKey: null, mailcheapNewsletter: null,
};

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const auth = await adminSession(db);
  const token = auth.token;
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const shoot = async (path, name, options = { viewport: { width: 1440, height: 1000 } }, signedIn = true) => {
    const context = await browser.newContext(options);
    if (signedIn) await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await context.close();
    return { errors, overflow };
  };
  const created = [];

  try {
    /* ---------------- Storage ---------------- */
    const before = await upload(token, 'on-disk.pdf', pdf('This PDF was saved on the server disk before the switch.'));
    check('upload while on this server', before.status === 200, String(before.status));
    created.push(before.body.id);

    const bad = await save(token, { storageProvider: 's3', s3Endpoint: S3, s3UrlStyle: 'path', s3Region: 'us-east-1', s3Bucket: BUCKET, s3AccessKeyId: process.env.S3_TEST_KEY, s3SecretAccessKey: 'wrong-secret', s3Prefix: PREFIX });
    check('wrong bucket key is refused before saving', bad.status === 422 && /bucket check failed/i.test(bad.body.detail || bad.body.message || ''), (bad.body.detail || bad.body.message || '').slice(0, 120));
    const settingsAfterBad = await call(token, '/api/admin/settings');
    check('…and storage stays on this server', settingsAfterBad.body.settings.find((s) => s.key === 'storageProvider').value === 'local');

    const good = await save(token, { storageProvider: 's3', s3Endpoint: S3, s3UrlStyle: 'path', s3Region: 'us-east-1', s3Bucket: BUCKET, s3AccessKeyId: process.env.S3_TEST_KEY, s3SecretAccessKey: process.env.S3_TEST_SECRET, s3Prefix: PREFIX });
    check('S3-compatible bucket saved', good.status === 200, String(good.status));
    const test = await call(token, '/api/admin/test/storage', { method: 'POST' });
    check('Test connection works', test.body.ok === true, JSON.stringify(test.body));

    const old = await call(token, `/api/library/documents/${before.body.id}/file`);
    check('file saved before the switch still opens', old.status === 200 && old.body.subarray(0, 5).toString() === '%PDF-', String(old.status));

    const after = await upload(token, 'in-bucket.pdf', pdf('This PDF was saved in the S3-compatible bucket after the switch.'));
    created.push(after.body.id);
    const key = `library/${auth.user.id}/${after.body.id}.pdf`;
    check('new upload goes to the bucket', await inBucket(key), key);
    const opened = await call(token, `/api/library/documents/${after.body.id}/file`);
    check('…and opens from the bucket', opened.status === 200 && opened.body.subarray(0, 5).toString() === '%PDF-');
    let processed = null;
    for (let i = 0; i < 30 && !['completed', 'failed'].includes(processed?.processing_status); i += 1) { await wait(1000); processed = (await call(token, `/api/library/documents/${after.body.id}`)).body; }
    check('…and its text is read from the bucket', processed?.processing_status === 'completed' && processed.chunk_count > 0, `${processed?.processing_status} ${processed?.processing_error || ''}`);

    const image = await upload(token, 'dot.png', PNG, 'image/png', '/api/ai-editor/assets');
    check('image saved to the bucket', image.status === 200 && (await inBucket(`assets/${image.body.name}`)), image.body.name);
    const served = await call(null, image.body.url);
    check('…and served back byte for byte', served.status === 200 && Buffer.compare(served.body, PNG) === 0);

    const blocks = [{ id: 'p1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Storage round trip', styles: {} }], children: [] }];
    const docx = await call(token, '/api/ai-editor/word/export', { method: 'POST', body: JSON.stringify({ title: 'Storage round trip', blocks, format: 'docx' }) });
    const imported = await upload(token, 'round-trip.docx', docx.body, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '/api/ai-editor/word/import');
    const documentId = imported.body.document?.id;
    const sources = documentId ? await listBucket(`word-source/${documentId}/`) : [];
    check('Word import keeps its source in the bucket', imported.status === 200 && sources.length === 1, `${imported.status} ${sources.length}`);
    const exported = await call(token, '/api/ai-editor/word/export', { method: 'POST', body: JSON.stringify({ document_id: documentId, title: 'Storage round trip', blocks, format: 'docx' }) });
    check('…and Word export uses it as the template', exported.status === 200 && exported.body.subarray(0, 2).toString() === 'PK', String(exported.status));
    if (documentId) await call(token, `/api/ai-editor/documents/${documentId}`, { method: 'DELETE' });

    const copy = await call(token, '/api/admin/storage/copy', { method: 'POST' });
    let status = copy.body.copy;
    for (let i = 0; i < 120 && status?.running; i += 1) { await wait(1000); status = (await call(token, '/api/admin/storage')).body.copy; }
    check('copy to bucket finishes without failures', status && !status.running && status.failed === 0 && status.copied + status.skipped === status.total, JSON.stringify({ total: status?.total, copied: status?.copied, skipped: status?.skipped, failed: status?.failed }));
    check('…including the file saved before the switch', await inBucket(`library/${auth.user.id}/${before.body.id}.pdf`));

    await call(token, `/api/library/documents/${after.body.id}`, { method: 'DELETE' });
    check('deleting a source removes it from the bucket', !(await inBucket(key)));

    for (const [size, options] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['phone', devices['iPhone 13']]]) {
      const shot = await shoot('/admin?section=storage', `integrations-storage-${size}`, options);
      check(`admin Storage (${size}): no errors, no sideways scroll`, !shot.errors.length && shot.overflow <= 0, shot.errors.join(' | '));
    }

    /* ---------------- Email ---------------- */
    await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' });
    const methodsOff = await call(null, '/api/auth/methods');
    check('Forgot password hidden while email is off', methodsOff.body.password_reset === false);
    const mailSaved = await save(token, { mailProvider: 'smtp', mailFrom: 'Videmak Test <test@videmak.test>', smtpHost: 'videmak-test-mailpit', smtpPort: '1025', smtpSecurity: 'none' });
    check('SMTP saved', mailSaved.status === 200);
    const testMail = await call(token, '/api/admin/test/email', { method: 'POST' });
    check('test email sent', testMail.body.ok === true, JSON.stringify(testMail.body));
    check('…and arrives', Boolean(await mailTo(auth.user.email, 'Videmak test email')));

    const newcomer = `confirm-${Date.now()}@example.test`;
    const signup = await call(null, '/api/auth/register', { method: 'POST', body: JSON.stringify({ email: newcomer, password: PASSWORD, full_name: 'Cora Confirm' }) });
    const confirmMail = signup.status === 201 ? await mailTo(newcomer, 'Confirm your email for Videmak') : null;
    check('password sign-up gets a confirmation email', Boolean(confirmMail), String(signup.status));
    const confirmLink = linkIn(confirmMail, '/confirm-email');
    if (confirmLink) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const page = await context.newPage();
      await page.goto(confirmLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'domcontentloaded' });
      const confirmed = await page.getByRole('heading', { name: 'Email confirmed' }).waitFor({ timeout: 15000 }).then(() => true, () => false);
      await page.screenshot({ path: `${OUT}/integrations-confirmed.png` });
      const { rows } = await db.query('select email_verified_at from users where email = $1', [newcomer]);
      check('confirmation link confirms the address', confirmed && Boolean(rows[0]?.email_verified_at));
      check('…and leaves the token out of the address bar', !page.url().includes('token='));
      await context.close();
    }

    // Forgot password, in the browser, from the sign-in page.
    const resetUser = `reset-${Date.now()}@example.test`;
    const made = await call(null, '/api/auth/register', { method: 'POST', body: JSON.stringify({ email: resetUser, password: PASSWORD, full_name: 'Rhea Reset' }) });
    if (made.status === 201) {
      for (const [size, options] of [['desktop', { viewport: { width: 1280, height: 860 } }], ['phone', devices['iPhone 13']]]) {
        const context = await browser.newContext(options);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));
        await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
        await page.getByLabel('Email address').waitFor({ timeout: 20000 });
        await page.waitForTimeout(600);
        await page.getByLabel('Email address').fill(resetUser);
        await page.getByRole('button', { name: 'Continue' }).click();
        const forgot = page.getByRole('link', { name: 'Forgot password?' });
        check(`${size}: password step offers Forgot password?`, await forgot.waitFor({ timeout: 10000 }).then(() => true, () => false));
        await page.screenshot({ path: `${OUT}/integrations-password-step-${size}.png` });
        if (size === 'desktop') {
          await forgot.click();
          await page.getByRole('button', { name: 'Send reset link' }).waitFor({ timeout: 10000 });
          check('forgot page keeps the email', (await page.getByLabel('Email address').inputValue()) === resetUser);
          await page.getByRole('button', { name: 'Send reset link' }).click();
          check('"Check your email" shown', await page.getByRole('heading', { name: 'Check your email' }).waitFor({ timeout: 10000 }).then(() => true, () => false));
          await page.screenshot({ path: `${OUT}/integrations-check-email.png` });
          const resetMail = await mailTo(resetUser, 'Reset your Videmak password');
          const resetLink = linkIn(resetMail, '/reset-password');
          check('reset email arrives with a link', Boolean(resetLink));
          await page.goto(resetLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'domcontentloaded' });
          await page.getByLabel('New password').waitFor({ timeout: 10000 });
          await page.screenshot({ path: `${OUT}/integrations-new-password.png` });
          await page.getByLabel('New password').fill('brand-new-pass-7');
          await page.getByRole('button', { name: 'Save and sign in' }).click();
          await page.waitForURL(/\/editor/, { timeout: 20000 }).catch(() => {});
          check('new password saved and signed in', page.url().includes('/editor'), page.url().replace(BASE, ''));
          const login = await call(null, '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: resetUser, password: 'brand-new-pass-7' }) });
          check('…and the new password works', login.status === 200);
          const oldLogin = await call(null, '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: resetUser, password: PASSWORD }) });
          check('…and the old one does not', oldLogin.status === 401);
          const again = await call(null, '/api/auth/password/reset', { method: 'POST', body: JSON.stringify({ token: resetLink.split('#token=')[1], password: 'another-pass-8' }) });
          check('a used reset link no longer works', again.status === 410);
          const { rows } = await db.query('select email_verified_at from users where email = $1', [resetUser]);
          check('resetting also confirms the address', Boolean(rows[0]?.email_verified_at));
        }
        check(`${size}: no page errors`, !errors.length, errors.join(' | '));
        await context.close();
      }
    } else {
      console.log(`SKIP forgot-password browser flow (sign-up returned ${made.status})`);
    }
    const unknown = await call(null, '/api/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email: `nobody-${Date.now()}@example.test` }) });
    check('unknown email gets the same answer', unknown.status === 200 && unknown.body.ok === true);

    const resend = await save(token, { mailProvider: 'resend', resendApiKey: 're_test_not_a_real_key' });
    const resendTest = await call(token, '/api/admin/test/email', { method: 'POST' });
    check('Resend with a bad key reports Resend\'s refusal', resend.status === 200 && resendTest.body.ok === false && /Resend refused/.test(resendTest.body.error || ''), (resendTest.body.error || '').slice(0, 120));

    for (const [size, options] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['phone', devices['iPhone 13']]]) {
      await save(token, { mailProvider: size === 'desktop' ? 'smtp' : 'resend' });
      const shot = await shoot('/admin?section=email', `integrations-email-${size}`, options);
      check(`admin Email (${size}): no errors, no sideways scroll`, !shot.errors.length && shot.overflow <= 0, shot.errors.join(' | '));
    }

    /* ---------------- Newsletter ---------------- */
    await save(token, { mailProvider: 'smtp' });
    const nlSaved = await save(token, { newsletterProvider: 'mailcheap', mailcheapApiKey: 'mc_not_a_real_key' });
    const nlTest = await call(token, '/api/admin/test/newsletter', { method: 'POST' });
    check('MailCheap with a bad key reports MailCheap\'s refusal', nlSaved.status === 200 && nlTest.body.ok === false && /MailCheap 40\d/.test(nlTest.body.error || ''), (nlTest.body.error || '').slice(0, 120));
    const me = await call(token, '/api/newsletter/me');
    check('account sees the newsletter switch', me.body.available === true && me.body.subscribed === true, JSON.stringify(me.body));
    const off = await call(token, '/api/newsletter/me', { method: 'PUT', body: JSON.stringify({ subscribed: false }) });
    const { rows: choice } = await db.query('select newsletter_opt_out, newsletter_dirty from users where id = $1', [auth.user.id]);
    check('turning it off is kept', off.body.subscribed === false && choice[0].newsletter_opt_out === true, JSON.stringify(choice[0]));
    const synced = await call(token, '/api/admin/newsletter/sync', { method: 'POST' });
    check('Sync now with a bad key reports the error, no crash', synced.status === 200 && Boolean(synced.body.result.error), (synced.body.result?.error || '').slice(0, 120));
    for (const [size, options] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['phone', devices['iPhone 13']]]) {
      const admin = await shoot('/admin?section=newsletter', `integrations-newsletter-${size}`, options);
      check(`admin Newsletter (${size}): no errors, no sideways scroll`, !admin.errors.length && admin.overflow <= 0, admin.errors.join(' | '));
      const account = await shoot('/account', `integrations-account-${size}`, options);
      check(`account Email card (${size}): no errors, no sideways scroll`, !account.errors.length && account.overflow <= 0, account.errors.join(' | '));
    }
    await call(token, '/api/newsletter/me', { method: 'PUT', body: JSON.stringify({ subscribed: true }) });
    const overview = await shoot('/admin', 'integrations-overview-desktop');
    check('admin Overview: no errors', !overview.errors.length, overview.errors.join(' | '));
  } catch (error) {
    console.error(error);
    results.push(false);
  } finally {
    // Back to how staging was: files on this server, email and newsletter off.
    for (const id of created) await call(token, `/api/library/documents/${id}`, { method: 'DELETE' }).catch(() => {});
    const restored = await save(token, RESET);
    const settings = (await call(token, '/api/admin/settings')).body.settings || [];
    const value = (key) => settings.find((s) => s.key === key)?.value;
    check('settings restored (storage local, email and newsletter off)', restored.status === 200 && value('storageProvider') === 'local' && !value('mailProvider') && !value('newsletterProvider'));
    await browser.close();
    await db.end();
    console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  }
})();
