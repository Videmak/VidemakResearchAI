// Functional checks for the restyled editor chrome: a template creates a filled document, the
// "⋯" menu runs commands (including ones that open the second toolbar row), the Paragraph
// select, the outline, the assistant tabs and Review, and the phone keyboard row.
// LOGIN=<existing test account> (sign-ups are rate limited). Writes /shots/flow-*.png.
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080';

(async () => {
  const auth = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.LOGIN, password: 'correct-horse-9' }) });
  const { token, user } = await auth.json();
  console.log('auth', auth.status);
  const browser = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  const open = async (options) => {
    const context = await browser.newContext(options);
    await context.addInitScript(([t, u]) => { localStorage.setItem('videmak_token', JSON.stringify(t)); localStorage.setItem('videmak_user', JSON.stringify(u)); }, [token, user]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/AI is not configured|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
    return { context, page, errors };
  };

  // 1. Template → a new document with the sections.
  const { page, errors } = await open({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.getByRole('button', { name: /Literature review/ }).first().click();
  await page.waitForFunction(() => location.search.includes('doc='), null, { timeout: 30000 });
  await page.waitForTimeout(9000);
  const text = await page.locator('.bn-editor').first().innerText().catch(() => '');
  console.log('template filled:', /Search strategy/.test(text) && /Gaps in the literature/.test(text));
  console.log('template title:', await page.locator('input[aria-label="Rename document"]').inputValue());
  await page.screenshot({ path: '/shots/flow-1-template.png' });

  // 2. "⋯" → Format → Align & indent opens the second row and its pop-up next to its button.
  await page.locator('.bn-editor').first().click({ position: { x: 200, y: 200 } });
  await page.click('[data-testid="editor-more-menu"]');
  await page.click('[data-docs-toolbar-dropdown] button:has-text("Format")');
  await page.click('[data-docs-toolbar-dropdown] button:has-text("Align & indent")');
  await page.waitForTimeout(500);
  const rowShown = await page.locator('[data-testid="editor-more-tools"]').isVisible();
  const align = await page.locator('[aria-label="Align and indent"]').boundingBox();
  const panel = await page.locator('[data-docs-toolbar-dropdown]').first().boundingBox();
  console.log('second row opened:', rowShown, 'pop-up under its button:', Boolean(align && panel && Math.abs(panel.x - align.x) < 40 && panel.y > align.y));
  await page.screenshot({ path: '/shots/flow-2-align.png' });
  await page.keyboard.press('Escape');

  // 3. Command search in "⋯": "word count" opens the dialog.
  await page.click('[data-testid="editor-more-menu"]');
  await page.fill('input[aria-label="Search menus"]', 'word count');
  await page.click('[data-docs-toolbar-dropdown] button:has-text("Word count")');
  await page.waitForTimeout(500);
  console.log('word count dialog:', await page.getByText('Characters excluding spaces').isVisible());
  await page.screenshot({ path: '/shots/flow-3-wordcount.png' });
  await page.mouse.click(20, 880);
  await page.waitForTimeout(300);

  // 4. Paragraph select → Heading 2 on the current block.
  await page.locator('.bn-editor').first().click({ position: { x: 200, y: 330 } });
  await page.click('button[aria-label="Styles"]');
  await page.click('[data-docs-toolbar-dropdown] button:has-text("Heading 2")');
  await page.waitForTimeout(400);
  console.log('paragraph select shows:', await page.locator('button[aria-label="Styles"]').innerText());
  await page.keyboard.press('Control+z');

  // 5. Review opens Comments; outline opens and lists headings.
  await page.click('header button:has-text("Review")');
  await page.waitForTimeout(800);
  console.log('review → comments tab:', await page.locator('[role="tab"][aria-selected="true"]').innerText());
  await page.click('[data-testid="editor-outline-toggle"]');
  await page.waitForTimeout(400);
  console.log('outline items:', await page.locator('nav[aria-label="Document outline"] button').count());
  await page.screenshot({ path: '/shots/flow-5-review-outline.png' });
  console.log('desktop errors:', JSON.stringify(errors.slice(0, 6)));
  await page.context().close();

  // 6. Phone: keyboard row (Aa, Cite, ∑, AI) and the format sheet.
  const phone = await open(devices['iPhone 13']);
  await phone.page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
  await phone.page.waitForTimeout(6000);
  await phone.page.locator('button:has-text("Blank")').first().click();
  await phone.page.waitForFunction(() => location.search.includes('doc='), null, { timeout: 30000 });
  await phone.page.waitForTimeout(7000);
  await phone.page.locator('.bn-editor').first().click();
  await phone.page.keyboard.type('Phone text.', { delay: 20 });
  await phone.page.waitForTimeout(600);
  const row = await phone.page.locator('button[aria-label="Format"], button[aria-label="Insert citation"], button[aria-label="Insert equation"], button[aria-label="AI tools"]').count();
  console.log('phone tool row buttons:', row);
  // The dev overlay badge sits over the bottom-left corner in dev; click through the DOM.
  await phone.page.locator('button[aria-label="Format"]').evaluate((el) => el.click());
  await phone.page.waitForTimeout(500);
  await phone.page.screenshot({ path: '/shots/flow-6-phone-format.png' });
  console.log('phone errors:', JSON.stringify(phone.errors.slice(0, 6)));
  await browser.close();
})().catch((error) => { console.error('FLOWS FAILED', error); process.exit(1); });
