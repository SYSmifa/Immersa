// Screenshots every slide of the HTML as it looks (text included), for the fast image-only graphic PDF.
// Usage: node shots.cjs <html> <outDir>   -> <outDir>/slide-N.png
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const [html, outDir] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1123, height: 794 }, deviceScaleFactor: 2.5 });
  await page.goto('file://' + path.resolve(html));
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '.slide { break-after: auto; }' });
  const els = await page.$$('.slide');
  for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: path.join(outDir, `slide-${i + 1}.png`) });
  await browser.close();
})();
