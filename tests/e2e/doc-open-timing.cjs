// Opening speed of a long document (45 headings, 140 paragraphs, 102 citations): the first
// open builds the References list, then a new browser and the same browser open it again.
// CPU=4 slows the CPU like an older laptop.  (node localproxy.cjs &) ; BASE=http://localhost:8080 CPU=4 node doc-open-timing.cjs
// Times opening a large document (same shape as a real 29-page thesis chapter: 45 headings,
// 140 long paragraphs, 102 citations, 11 equations, 52 links) on a throttled laptop + network.
const crypto = require('crypto');
const { chromium } = require('playwright');
const { signIn } = require('./e2e-auth.cjs');
const BASE = process.env.BASE || 'http://localhost:8080';
const CPU = Number(process.env.CPU || 4);
const t = (s, styles = {}) => ({ type: 'text', text: s, styles });
const words = 'sleep memory consolidation students learning retention declarative hippocampal cortex replay slow wave stage night recall performance cognitive study sample results analysis evidence'.split(' ');
const sentence = (n, seed) => Array.from({ length: n }, (_, i) => words[(i * 7 + seed) % words.length]).join(' ');
let cites = 0;
function citation(i) {
  const bib = `@article{author${i}_2010,\n  title = {The memory function of sleep and related processes ${i}},\n  author = {Diekelmann, Susanne and Born, Jan and Smith, Alex and Jones, Brook},\n  journal = {Nature Reviews Neuroscience},\n  volume = {11},\n  number = {2},\n  pages = {114--126},\n  year = {2010},\n  doi = {10.1038/nrn2762.${i}},\n  abstract = {${sentence(60, i)}}\n}`;
  return { type: 'aiCitation', props: { citationId: `c${i}`, base64: Buffer.from(bib).toString('base64'), displayText: `(Diekelmann & Born, 2010)`, bibliography: `Diekelmann, S., & Born, J. (2010). The memory function of sleep ${i}. Nature Reviews Neuroscience, 11(2), 114–126. https://doi.org/10.1038/nrn2762`, style: 'apa', url: '' } };
}
function paragraph(i) {
  const content = [t(sentence(25, i) + ' ')];
  if (cites < 102 && i % 4 !== 3) { content.push(citation(cites++)); content.push(t('. ' + sentence(18, i + 3) + ' ', { bold: i % 5 === 0 })); }
  if (i % 3 === 0) content.push({ type: 'link', href: `https://doi.org/10.1/${i}`, content: [t('see source')] });
  if (i % 13 === 0) content.push({ type: 'aiMath', props: { latex: 'E = mc^2 + \\sum_{i=1}^{n} x_i', displayMode: 'inline' } });
  content.push(t(' ' + sentence(14, i + 9) + '.'));
  return { id: crypto.randomUUID(), type: 'paragraph', props: {}, content, children: [] };
}
(async () => {
  const auth = await signIn(BASE, 'docopen');
  const id = crypto.randomUUID();
  const blocks = [];
  let p = 0;
  for (let h = 0; h < 45; h += 1) {
    blocks.push({ id: crypto.randomUUID(), type: 'heading', props: { level: h % 5 === 0 ? 1 : 2 }, content: [t(`Section ${h + 1}: ${sentence(5, h)}`)], children: [] });
    const count = h < 5 ? 4 : 3;
    for (let k = 0; k < count && p < 140; k += 1) blocks.push(paragraph(p++));
  }
  const body = JSON.stringify({ id, title: 'Large chapter timing', blocks });
  const saved = await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body });
  console.log('saved', saved.status, 'blocks', blocks.length, 'citations', cites, 'json KB', Math.round(body.length / 1024));
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  // First open builds the References list and saves it; then a brand-new browser opens it.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(([tk, u]) => { localStorage.setItem('videmak_token', JSON.stringify(tk)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
    const page = await context.newPage();
    await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.bn-block-content', { hasText: 'Section 45' }).first().waitFor({ timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(15000);
    const refs = await page.locator('.bn-block-content', { hasText: 'Nature Reviews Neuroscience' }).count();
    console.log('first open: reference entries in the document', refs);
    await context.close();
  }
  for (const run of ['new browser (cold)', 'same browser again (warm)']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(([tk, u]) => { localStorage.setItem('videmak_token', JSON.stringify(tk)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [auth.token, auth.user]);
    await context.addInitScript(() => {
      window.__long = [];
      try { new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true }); } catch {}
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 120, downloadThroughput: (12 * 1024 * 1024) / 8, uploadThroughput: (4 * 1024 * 1024) / 8 });
    if (run.startsWith('same browser')) { await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' }); await page.locator('.bn-block-content', { hasText: 'Section 45' }).first().waitFor({ timeout: 120000 }).catch(() => {}); }
    const t0 = Date.now();
    const api = [];
    const starts = new Map();
    page.on('request', (r) => starts.set(r, Date.now() - t0));
    page.on('requestfinished', (r) => { const u = r.url().replace(BASE, ''); if (u.startsWith('/api') || u.includes('/_next/static/chunks/')) api.push(`${String(starts.get(r)).padStart(6)}→${String(Date.now() - t0).padStart(6)} ${u.slice(0, 80)}`); });
    await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.bn-block-content').first().waitFor({ timeout: 120000 }).catch(() => {});
    const first = Date.now() - t0;
    await page.locator('.bn-block-content', { hasText: 'Section 45' }).first().waitFor({ timeout: 120000 }).catch(() => {});
    const last = Date.now() - t0;
    // When can the writer type? Measure input latency once everything rendered.
    await page.waitForTimeout(1000);
    const long = await page.evaluate(() => window.__long);
    const pages = await page.locator('text=/\\d+ pages?/').first().innerText().catch(() => '');
    console.log(`\n=== ${run} (CPU x${CPU}, 12 Mbps, 120 ms): first text ${first} ms, whole document ${last} ms, ${pages}`);
    const total = long.reduce((n, [, d]) => n + d, 0);
    console.log(`long tasks: ${long.length}, total ${total} ms, longest ${Math.max(0, ...long.map(([, d]) => d))} ms`);
    console.log(long.filter(([, d]) => d > 300).map(([s, d]) => `${s}+${d}`).join('  '));
    console.log(api.join('\n'));
    await context.close();
  }
  await browser.close();
})();
