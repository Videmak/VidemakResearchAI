// A fresh `docker compose up` (no keys, no email): pages load, sign-up works, the first admin is
// made with the admin-grant command, papers come from Scholar without a key, Word export works.
//   BASE=http://router:8080 ADMIN_EMAIL=owner@example.test GRANTED=1 node selfhost-smoke.cjs
// Run once without GRANTED (it signs up and stops), run admin-grant, then again with GRANTED=1.
const BASE = process.env.BASE || 'http://localhost:3000';
const EMAIL = process.env.ADMIN_EMAIL || 'owner@example.test';
const PASSWORD = 'correct-horse-9';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`); };

async function call(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = response.headers.get('content-type') || '';
  return { status: response.status, type, data: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}

(async () => {
  if (!process.env.GRANTED) {
    const home = await call('/');
    check('landing page', home.status === 200 && /videmak/i.test(home.data.toString()));
    for (const path of ['/pricing', '/developers', '/login', '/signup']) check(`page ${path}`, (await call(path)).status === 200);
    const health = await call('/api/health');
    check('API healthy, papers from Scholar by default', health.data.ok === true && health.data.papers === 'scholar', JSON.stringify(health.data));
    const methods = await call('/api/auth/methods');
    check('no email set up: no password reset, no support address', methods.data.password_reset === false && methods.data.support_email === null);
    const signup = await call('/api/auth/register', { method: 'POST', body: { email: EMAIL, password: PASSWORD, full_name: 'Site Owner' } });
    check('sign up', signup.status === 200 || signup.status === 201, String(signup.status));
    const me = await call('/api/auth/me', { token: signup.data.token });
    check('ADMIN_EMAILS without a confirmed email: not admin yet', me.data.is_admin === false);
    console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
    return;
  }
  const login = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  const token = login.data.token;
  const me = await call('/api/auth/me', { token });
  check('after admin-grant: admin', me.data.is_admin === true);
  const settings = await call('/api/admin/settings', { token });
  check('admin settings open', settings.status === 200 && Array.isArray(settings.data.settings));
  const papersField = settings.data.settings.find((field) => field.key === 'scholarApiKey');
  check('Scholar key field links to a free key', papersField?.link?.href?.includes('scholar.citedevidence.com'));
  const test = await call('/api/admin/test/papers', { token, method: 'POST' });
  check('admin papers test works without a key', test.data.ok === true, JSON.stringify(test.data).slice(0, 200));
  const search = await call('/api/ai-editor/assist/papers?q=sleep%20memory%20consolidation&limit=3', { token });
  check('paper search', search.status === 200 && (search.data.results || search.data.papers || []).length > 0, String(search.status));
  const docx = await call('/api/ai-editor/word/export', { token, method: 'POST', body: { title: 'Self-host', format: 'docx', blocks: [{ id: 'a', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Hello from a self-hosted Videmak.', styles: {} }], children: [] }] } });
  check('Word export through the converter', docx.status === 200 && docx.data.subarray(0, 2).toString() === 'PK', `${docx.status} ${docx.type}`);
  const ai = await call('/api/ai-editor/assist/complete', { token, method: 'POST', body: { before: 'Sleep helps memory because', length: 'sentence' } });
  check('AI without a key: a clear 503, not a crash', ai.status === 503 || ai.status === 402, `${ai.status} ${JSON.stringify(ai.data).slice(0, 120)}`);
  const cloud = await call('/v1/credits');
  check('this install\'s own /v1 gateway asks for a key', cloud.status === 401);
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
