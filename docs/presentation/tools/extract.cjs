// Renders each slide's background (text hidden) and dumps text boxes/styles to JSON.
// Usage: node extract.cjs <html> <outDir>
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SELECTORS = ['.badge', '.tag', '.link-k', '.link-v', '.title', '.subtitle', '.desc', '.spec .k', '.spec .val', '.head h2',
  '.card h3', '.card p', '.video h3', '.video p', '.thanks', '.center p'];

(async () => {
  const [html, outDir] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1123, height: 794 }, deviceScaleFactor: 2.5 });
  await page.goto('file://' + path.resolve(html));
  await page.addStyleTag({ content: '.slide { break-after: auto; }' });
  const slides = await page.$$eval('.slide', (els, sels) => els.map(slide => {
    const base = slide.getBoundingClientRect();
    const items = [];
    for (const el of slide.querySelectorAll(sels.join(','))) {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const px = k => parseFloat(cs[k]) || 0;
      const r = { left: b.left + px('paddingLeft'), top: b.top + px('paddingTop'),
        width: b.width - px('paddingLeft') - px('paddingRight'), height: b.height - px('paddingTop') - px('paddingBottom') };
      // Slide titles sit in a flex row and hug their text: give them room to grow.
      if (el.matches('.head h2')) r.width = base.right - parseFloat(getComputedStyle(slide).paddingRight) - r.left;
      const firstSpan = el.querySelector('span');
      const color = firstSpan ? null : cs.color;
      items.push({
        text: el.innerText.trim(), x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height,
        size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight), align: cs.textAlign,
        lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2,
        color, gradient: !!firstSpan, inline: cs.display.startsWith('inline'),
      });
    }
    return { w: base.width, h: base.height, items };
  }), SELECTORS);
  await page.addStyleTag({ content: '.slide, .slide * { color: transparent !important; } .ring::after { color: #38bdf8 !important; }' });
  const els = await page.$$('.slide');
  for (let i = 0; i < els.length; i++) {
    await els[i].screenshot({ path: path.join(outDir, `bg-${i + 1}.jpg`), type: 'jpeg', quality: 90 });
  }
  fs.writeFileSync(path.join(outDir, 'layout.json'), JSON.stringify(slides, null, 1));
  await browser.close();
})();
