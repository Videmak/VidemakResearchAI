// Opens the Next.js dev overlay's issue list on /editor and screenshots it (dev only).
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080';
(async () => {
  const signup = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.LOGIN, password: 'correct-horse-9' }) });
  const { token, user } = await signup.json();
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [token, user]);
  const page = await context.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('console', m.type(), m.text().slice(0, 300)); });
  const id = require('crypto').randomUUID();
  await fetch(`${BASE}/api/ai-editor/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ id, title: 'Issue check', blocks: [] }) });
  await page.goto(`${BASE}/editor?doc=${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  const text = await page.evaluate(() => [...document.querySelectorAll('nextjs-portal')].map((el) => (el.shadowRoot ? el.shadowRoot.querySelector('[data-nextjs-dialog], [data-nextjs-toast], body, div') ? [...el.shadowRoot.querySelectorAll('div,p,span,h1,h2,h3,button')].map((n) => n.childElementCount === 0 ? n.textContent : '').filter(Boolean).join(' ¦ ') : '' : '')).join(' | ').slice(0, 600));
  console.log('portal text:', text);
  const opened = await page.evaluate(() => {
    for (const el of document.querySelectorAll('nextjs-portal')) {
      const button = el.shadowRoot && [...el.shadowRoot.querySelectorAll('button')].find((b) => /issue/i.test(b.textContent || ''));
      if (button) { button.click(); return true; }
    }
    return false;
  });
  console.log('opened', opened);
  await page.waitForTimeout(1500);
  const detail = await page.evaluate(() => [...document.querySelectorAll('nextjs-portal')].map((el) => (el.shadowRoot ? el.shadowRoot.querySelector('[data-nextjs-dialog], [data-nextjs-toast], body, div') ? [...el.shadowRoot.querySelectorAll('div,p,span,h1,h2,h3,button')].map((n) => n.childElementCount === 0 ? n.textContent : '').filter(Boolean).join(' ¦ ') : '' : '')).join(' | ').slice(0, 2500));
  console.log('detail:', detail);
  await page.screenshot({ path: '/shots/issue-overlay.png' });
  await browser.close();
})();
