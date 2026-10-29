// Videmak Cloud credits end to end (Stripe TEST mode): starter and free daily credits, every /v1
// service charged once, 402s (no credits, key cap), revoked keys, a credit pack bought with
// Stripe's published test card, automatic top-up, and the keys page on desktop and phone.
// Writes /shots/cloud-*.png.
//   (node localproxy.cjs &) ; BASE=http://localhost:8080 PUBLIC_URL=https://your-site.example DATABASE_URL=… node cloud-credits.cjs
const { chromium, devices } = require('playwright');
const { Client } = require('pg');
const { signIn } = require('./e2e-auth.cjs');
const BASE = process.env.BASE || 'http://localhost:8080';
const PUBLIC = process.env.PUBLIC_URL || BASE;
const OUT = process.env.OUT || '/shots';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` | ${extra}` : ''}`); };

async function call(path, { token, key, method = 'GET', body, raw = false } = {}) {
  const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token || key ? { Authorization: `Bearer ${token || key}` } : {}) };
  const response = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const charged = Number(response.headers.get('x-credits-charged') ?? NaN);
  const balance = Number(response.headers.get('x-credits-balance') ?? NaN);
  const data = raw ? Buffer.from(await response.arrayBuffer()) : await response.json().catch(() => null);
  return { status: response.status, data, charged, balance, type: response.headers.get('content-type') || '' };
}

async function payOnStripe(page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
  await page.waitForLoadState('domcontentloaded');
  const cardField = page.locator('#cardNumber');
  if (!(await cardField.isVisible({ timeout: 8000 }).catch(() => false))) {
    for (const choice of [page.getByRole('radio', { name: /^Card/ }), page.locator('[data-testid="card-accordion-item-button"]'), page.getByText('Card', { exact: true })]) {
      if (await choice.first().isVisible().catch(() => false)) { await choice.first().click(); break; }
    }
  }
  await cardField.waitFor({ timeout: 30000 });
  await cardField.fill('4242 4242 4242 4242');
  await page.locator('#cardExpiry').fill('12 / 34');
  await page.locator('#cardCvc').fill('123');
  const holder = page.locator('#billingName');
  if (await holder.isVisible().catch(() => false)) await holder.fill('Credit Tester');
  const zip = page.locator('#billingPostalCode');
  if (await zip.isVisible().catch(() => false)) await zip.fill('10001');
  const link = page.locator('#enableStripePass');
  if (await link.isChecked().catch(() => false)) await link.uncheck().catch(() => {});
  await page.screenshot({ path: `${OUT}/cloud-stripe.png` });
  await page.locator('[data-testid="hosted-payment-submit-button"], button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.href.includes('checkout.stripe.com'), { timeout: 90000 });
}

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const auth = await signIn(BASE, 'cloud', 'Rosalind Franklin');
  const token = auth.token;
  const [{ account_id: accountId }] = (await db.query('select account_id from users where id = $1', [auth.user.id])).rows;
  console.log('test person', auth.user.email);

  // Prices are public; the console needs a session.
  const prices = await call('/api/cloud/prices');
  check('public prices: services, 4 packs, 1,000 free a day', prices.status === 200 && prices.data.packs.length === 4 && prices.data.free_per_day === 1000, `${prices.data?.services?.length} services`);
  check('console needs sign-in', (await call('/api/cloud')).status === 401);

  // Starter credits arrive with the first look at the console (email is not set up on staging, so it counts as confirmed).
  const overview = await call('/api/cloud', { token });
  check('starter credits: 100', overview.data.wallet.balance === 100, JSON.stringify(overview.data.wallet));
  check('free today: 1,000 left', overview.data.wallet.free_left === 1000);
  const created = await call('/api/cloud/keys', { token, method: 'POST', body: { name: 'E2E key' } });
  const key = created.data.key;
  check('key created (shown once)', created.status === 201 && /^vm_(test|live)_/.test(key || ''), created.data?.prefix);
  check('second look does not add starter credits again', (await call('/api/cloud', { token })).data.wallet.balance === 100);

  // No key, bad key.
  check('gateway without a key: 401', (await call('/v1/credits')).status === 401);
  check('gateway with a made-up key: 401', (await call('/v1/credits', { key: 'vm_test_madeupmadeupmadeupmadeup' })).status === 401);

  // Papers, files, research tools: free credits first.
  const works = await call('/v1/oa/works?search=sleep%20memory%20consolidation&per_page=2', { key });
  check('papers: results from Scholar', works.status === 200 && works.data.results?.length === 2, works.data?.results?.[0]?.title);
  check('papers: 1 credit, from free credits', works.charged === 1 && works.balance === 100, `charged ${works.charged}, balance ${works.balance}`);
  const workId = String(works.data.results?.[0]?.id || '').replace('https://openalex.org/', '');
  const author = await call('/v1/oa/authors?search=stickgold&per_page=1', { key });
  check('papers: other entities (authors)', author.status === 200 && Array.isArray(author.data.results));
  const list = await call('/v1/files/list?limit=1&has_fulltext=true', { key });
  check('files: content-backed list', list.status === 200 && Array.isArray(list.data.results), String(list.data?.results?.[0]?.title || '').slice(0, 60));
  const textId = list.data.results?.[0]?.id;
  if (textId) {
    const manifest = await call(`/v1/files/manifest/${textId}`, { key });
    check('files: manifest', manifest.status === 200 && manifest.charged === 1);
  }
  // The hosted app: saving a paper to the Library brings Scholar's stored PDF along.
  const withPdf = await call('/v1/files/list?limit=5&has_pdf=true', { key });
  const pdfPaper = (withPdf.data.results || []).find((item) => item.id);
  if (pdfPaper) {
    const saved = await call('/api/library/papers/import', { token, method: 'POST', body: { title: pdfPaper.title || 'Paper', scholar_id: pdfPaper.id, source: 'search' } });
    let doc = null;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      doc = (await call(`/api/library/documents/${saved.data.document_id}`, { token })).data;
      if (doc && doc.processing_status !== 'pending' && doc.processing_status !== 'processing') break;
    }
    check('Library: a saved paper gets its PDF from Scholar', doc?.file_type === 'pdf' && doc?.processing_status === 'completed', `${pdfPaper.id} ${doc?.file_type} ${doc?.processing_status}`);
  }
  check('files: unknown path is 404 (not passed on)', (await call('/v1/files/admin%2F..%2Fsecret', { key })).status === 404);

  const tools = await call('/v1/research/tools', { key });
  const names = (tools.data.tools || []).map((tool) => tool.name);
  check('research tools: list without review tools', names.includes('smart_search') && names.includes('validate_citations') && !names.includes('create_review') && !names.includes('reviews'), `${names.length} tools`);
  const refs = await call('/v1/research/tools/validate_citations', { key, method: 'POST', body: { identifiers: ['10.1038/nrn2762', '10.1152/physrev.00032.2012'] } });
  check('reference check: 2 credits for 2 references', refs.status === 200 && refs.charged === 2 && !refs.data.isError, `charged ${refs.charged}`);
  check('account-scoped tools refused', (await call('/v1/research/tools/create_review', { key, method: 'POST', body: { name: 'x', query_description: 'y' } })).status === 404);

  const init = await call('/v1/mcp', { key, method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } } });
  check('MCP initialize', init.status === 200 && init.data.result?.serverInfo?.name === 'videmak-research', JSON.stringify(init.data?.result?.serverInfo));
  const mcpList = await call('/v1/mcp', { key, method: 'POST', body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
  const mcpNames = (mcpList.data.result?.tools || []).map((tool) => tool.name);
  check('MCP tools/list hides review tools', mcpNames.length >= 10 && !mcpNames.includes('create_review'), `${mcpNames.length} tools`);
  const mcpCall = await call('/v1/mcp', { key, method: 'POST', body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_paper', arguments: { identifier: '10.1038/nrn2762', brief: true } } } });
  check('MCP tools/call: 1 credit', mcpCall.status === 200 && mcpCall.data.result && !mcpCall.data.result.isError && mcpCall.charged === 1, `charged ${mcpCall.charged}`);
  const mcpBlocked = await call('/v1/mcp', { key, method: 'POST', body: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'delete_review', arguments: { review_id: 1 } } } });
  check('MCP review tools refused', Boolean(mcpBlocked.data.error), mcpBlocked.data?.error?.message);

  // Paid services take the balance.
  const chat = await call('/v1/chat/completions', { key, method: 'POST', body: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'Reply with the single word: ready' }], max_tokens: 5 } });
  check('AI: answers and is paid from the balance', chat.status === 200 && chat.charged > 0 && chat.balance < 100, `charged ${chat.charged}, balance ${chat.balance}`);
  const words = Array.from({ length: 140 }, (_, i) => ['Sleep', 'supports', 'memory', 'consolidation', 'through', 'replay', 'during', 'slow-wave', 'periods.'][i % 9]).join(' ');
  const review = await call('/v1/review', { key, method: 'POST', body: { text: words, title: 'Sleep and memory' } });
  check('AI review: report, charged per 1,000 words', review.status === 200 && review.data.report?.length > 100 && Math.abs(review.charged - 1.4) < 0.01, `charged ${review.charged}, ${review.data?.recommendation}`);
  const docx = await call('/v1/convert', { key, method: 'POST', raw: true, body: { title: 'Cloud export', format: 'docx', blocks: [{ id: 'a', type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Cloud export', styles: {} }], children: [] }, { id: 'b', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Sleep supports memory.', styles: {} }], children: [] }] } });
  check('convert: a .docx, 1 credit', docx.status === 200 && docx.data.subarray(0, 2).toString() === 'PK' && docx.charged === 1, `${docx.status} ${docx.type} ${docx.data.length} bytes`);

  // The usage table.
  const usage = (await call('/api/cloud', { token })).data.usage;
  const services = usage.map((line) => line.service).sort().join(',');
  check('usage: every service listed once', ['conversions', 'files_requests', 'llm_input_tokens', 'llm_output_tokens', 'papers_requests', 'reference_checks', 'research_calls', 'review_words'].every((name) => services.includes(name)), services);

  // Free credits used up and no balance: 402 with the right code.
  await db.query(`update credit_daily_free set used_milli = 1000000 where account_id = $1`, [accountId]);
  await db.query(`update accounts set credits_milli = 0 where id = $1`, [accountId]);
  const noFree = await call('/v1/oa/works?search=memory&per_page=1', { key });
  check('no free credits and no balance: 402 no_credits', noFree.status === 402 && noFree.data.error?.code === 'no_credits', noFree.data?.error?.message);
  const noAi = await call('/v1/chat/completions', { key, method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
  check('AI with no balance: 402', noAi.status === 402);
  const noMcp = await call('/v1/mcp', { key, method: 'POST', body: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'find_paper', arguments: { identifier: '10.1038/nrn2762' } } } });
  check('MCP with no credits: JSON-RPC error', Boolean(noMcp.data.error) && /credits/i.test(noMcp.data.error.message));

  // Balance back; a key cap stops that key only.
  await db.query(`update accounts set credits_milli = 50000 where id = $1`, [accountId]);
  const keyId = (await call('/api/cloud', { token })).data.keys[0].id;
  await call(`/api/cloud/keys/${keyId}`, { token, method: 'PATCH', body: { monthly_credit_cap: 1 } });
  const capped = await call('/v1/oa/works?search=memory&per_page=1', { key });
  check('key over its monthly cap: 402 key_cap', capped.status === 402 && capped.data.error?.code === 'key_cap', capped.data?.error?.message);
  await call(`/api/cloud/keys/${keyId}`, { token, method: 'PATCH', body: { monthly_credit_cap: null } });
  const paidPapers = await call('/v1/oa/works?search=memory&per_page=1', { key });
  check('cap removed: papers paid from the balance once free credits are gone', paidPapers.status === 200 && paidPapers.balance === 49, `balance ${paidPapers.balance}`);

  // Revoked keys stop at once.
  await call(`/api/cloud/keys/${keyId}`, { token, method: 'DELETE' });
  check('revoked key: 401', (await call('/v1/credits', { key })).status === 401);

  // Buying a pack in the browser (Stripe test card), then automatic top-up with the saved card.
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const open = async (options) => {
    const context = await browser.newContext(options);
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [token, auth.user]);
    if (PUBLIC !== BASE) await context.route(`${PUBLIC}/**`, (route) => route.fulfill({ status: 302, headers: { location: route.request().url().replace(PUBLIC, BASE) } }));
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(error.message.slice(0, 200)));
    return { context, page };
  };
  {
    const { context, page } = await open({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${BASE}/developers/keys`, { waitUntil: 'networkidle' });
    await page.getByTestId('credit-balance').waitFor({ timeout: 20000 });
    await page.screenshot({ path: `${OUT}/cloud-keys-before.png`, fullPage: true });
    check('keys page: balance shown', (await page.getByTestId('credit-balance').innerText()).trim() === '49', await page.getByTestId('credit-balance').innerText());
    await page.getByRole('button', { name: /^2,000/ }).click();
    await payOnStripe(page);
    await page.waitForURL(/\/developers\/keys/, { timeout: 60000 });
    await page.getByText('Payment received').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
    const after = (await page.getByTestId('credit-balance').innerText()).trim();
    check('bought 2,000 credits: balance 2,049', after === '2,049', after);
    await page.screenshot({ path: `${OUT}/cloud-keys-paid.png`, fullPage: true });
    check('keys page: no page errors', !page.errors.length, page.errors.join(' | '));
    await context.close();
  }
  const ledger = (await db.query(`select kind, credits_milli, amount_cents from credit_ledger where account_id = $1 order by id`, [accountId])).rows;
  check('ledger: starter + purchase ($29.90)', ledger.map((row) => row.kind).join(',') === 'starter,purchase' && ledger[1].amount_cents === 2990, JSON.stringify(ledger));
  // A repeated return from Checkout (or the webhook) adds nothing.
  const session = (await db.query(`select reference from credit_ledger where account_id = $1 and kind = 'purchase'`, [accountId])).rows[0].reference.replace('checkout:', '');
  await call('/api/cloud/credits/complete', { token, method: 'POST', body: { session } });
  check('same payment twice: credited once', (await call('/api/cloud', { token })).data.wallet.balance === 2049);

  const topup = await call('/api/cloud/topup', { token, method: 'PUT', body: { enabled: true, threshold: 5000, pack: 'credits_10000', monthly_limit_usd: 200 } });
  check('automatic top-up saved', topup.status === 200, JSON.stringify(topup.data));
  let topped = 0;
  for (let i = 0; i < 20 && topped < 12049; i += 1) { await new Promise((resolve) => setTimeout(resolve, 1500)); topped = (await call('/api/cloud', { token })).data.wallet.balance; }
  check('under the threshold: topped up with the saved card (10,000)', topped === 12049, `balance ${topped}`);
  const limited = await call('/api/cloud/topup', { token, method: 'PUT', body: { enabled: true, threshold: 100, pack: 'credits_100000', monthly_limit_usd: 50 } });
  check('monthly limit must cover one pack', limited.status === 422);

  // Phone layout.
  {
    const { context, page } = await open(devices['iPhone 13']);
    await page.goto(`${BASE}/developers/keys`, { waitUntil: 'networkidle' });
    await page.getByTestId('credit-balance').waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    check('phone: no sideways scroll', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    await page.screenshot({ path: `${OUT}/cloud-keys-phone.png`, fullPage: true });
    await context.close();
  }

  // The public developer page.
  for (const [label, options] of [['desktop', { viewport: { width: 1440, height: 1000 } }], ['phone', devices['iPhone 13']]]) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.goto(`${BASE}/developers`, { waitUntil: 'networkidle' });
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    check(`/developers ${label}: prices, packs, quick start, self-host, institutions`, /1,000 free credits/.test(text) && /\$29\.90/.test(text) && /Quick start/.test(text) && /Run Videmak yourself/.test(text) && /universities/i.test(text));
    check(`/developers ${label}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    await page.screenshot({ path: `${OUT}/cloud-developers-${label}.png`, fullPage: true });
    await context.close();
  }

  // Admin › Cloud: this month's numbers and giving credits by hand (this test person is made admin for a moment).
  await db.query('update users set is_admin = true where id = $1', [auth.user.id]);
  try {
    const summary = await call('/api/admin/accounts/credits', { token });
    check('admin: credits sold this month include this run', summary.status === 200 && summary.data.sold_cents >= 2990 + 11900, JSON.stringify(summary.data));
    const given = await call('/api/admin/accounts/credits', { token, method: 'POST', body: { email: auth.user.email, credits: 250, note: 'E2E support grant' } });
    check('admin: give 250 credits', given.status === 200 && given.data.balance === 12299, JSON.stringify(given.data));
    const { context, page } = await open({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${BASE}/admin?section=cloud`, { waitUntil: 'networkidle' });
    await page.getByText('Videmak Cloud this month').waitFor({ timeout: 20000 });
    await page.getByText('Videmak Cloud this month').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/cloud-admin.png` });
    check('admin: Cloud panel shows', /credits sold/.test(await page.locator('main').innerText()));
    await context.close();
  } finally {
    await db.query('update users set is_admin = false where id = $1', [auth.user.id]);
  }

  await browser.close();
  await db.end();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
