// Reference screenshots of a public site (read-only, no sign-in), desktop and phone.
const { chromium, devices } = require('playwright');
const URL_ = process.argv[2];
const NAME = process.argv[3] || 'ref';
(async () => {
  const browser = await chromium.launch();
  for (const [kind, options] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', devices['iPhone 13']]]) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `/shots/${NAME}-${kind}.png`, fullPage: true });
    if (kind === 'desktop') {
      const info = await page.evaluate(() => {
        const cs = (el) => el ? getComputedStyle(el) : null;
        const body = cs(document.body), h1 = document.querySelector('h1'), btn = document.querySelector('a[class*="btn"], button, a[href*="sign"]');
        const fonts = [...new Set([...document.querySelectorAll('h1,h2,p,a,button')].slice(0, 60).map((el) => getComputedStyle(el).fontFamily.split(',')[0]))];
        return { title: document.title, bodyBg: body.backgroundColor, bodyColor: body.color, fonts, h1: h1 && { text: h1.innerText.slice(0, 120), size: cs(h1).fontSize, weight: cs(h1).fontWeight, color: cs(h1).color, family: cs(h1).fontFamily.slice(0, 60) },
          button: btn && { text: btn.innerText.slice(0, 40), bg: cs(btn).backgroundColor, color: cs(btn).color, radius: cs(btn).borderRadius } };
      });
      console.log(JSON.stringify(info));
    }
    await context.close();
  }
  await browser.close();
})();
