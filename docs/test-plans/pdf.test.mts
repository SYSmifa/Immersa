// Run: npx tsx docs/test-plans/pdf.test.mts   (the plan sheet: scale choice, layout, a valid PDF with true-to-scale lines)
import assert from 'node:assert/strict';
import { buildPlanPdf, describeLayout, fitScale, planLayout, type PlanData } from '../../src/editor/planPdf.ts';
import { PdfPage, textWidth } from '../../src/editor/pdf.ts';

const near = (a: number, b: number, eps = 1e-2) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

// A3 landscape frame is 400 x 252 mm (297 x 420 sheet, 10 mm margins, 22 mm title block, 3 mm gap).
assert.equal(fitScale(8, 5, 400, 252), 20); // 8000/20 = 400, 5000/20 = 250
assert.equal(fitScale(8.8, 5.8, 400, 252), 25);
assert.equal(fitScale(0.1, 0.1, 400, 252), 10); // never bigger than the first standard scale
assert.equal(fitScale(1e6, 1e6, 400, 252), 2000); // nor smaller than the last

// 8 x 5 m content (+0.4 m each side): the landscape sheet gives 1:25, the portrait one needs 1:50 -> landscape is chosen
const b = { minX: 0, maxX: 8, minZ: 0, maxZ: 5 };
const L = planLayout(b, { paper: 'A3', orient: 'auto', scale: 'auto', dims: true });
assert.equal(L.landscape, true);
assert.equal(L.den, 25);
assert.equal(describeLayout(L), 'Scala 1:25 · A3 orizzontale');
near(L.cx, 4);
near(L.cz, 2.5);
const P = planLayout(b, { paper: 'A4', orient: 'portrait', scale: 100, dims: true });
assert.equal(P.landscape, false);
assert.equal(P.den, 100); // a chosen scale is kept
assert.equal(P.pw, 210);

// A PDF: valid structure, and a 3 m ruler at 1:25 is 120 mm = 340.157 pt long on the page
const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // not a real picture: the writer only stores the bytes
const data: PlanData = {
  title: 'Prova',
  date: '13/11/2026',
  bounds: b,
  walls: [[[0, 0], [8, 0]]],
  models: [{ name: 'Tavolo', c: [4, 2.5], u: [1, 0], hu: 0.5, hv: 0.25 }],
  measures: [{ kind: 'ruler', a: [1, 0, 1], b: [4, 0, 1], text: '3,00 m', owner: 'r', color: '#ff8800' }],
};
const { pdf, layout } = await buildPlanPdf(data, { paper: 'A3', orient: 'auto', scale: 'auto', dims: true }, async (r) => {
  near(r.widthM, (layout0().area.w * 25) / 1000);
  assert.ok(r.pxW > 1000 && r.pxH > 1000);
  return { jpeg: fake, pxW: r.pxW, pxH: r.pxH };
});
function layout0() {
  return L;
}
assert.equal(layout.den, 25);
const text = Buffer.from(pdf).toString('latin1');
assert.ok(text.startsWith('%PDF-1.4'));
assert.ok(text.trimEnd().endsWith('%%EOF'));
assert.ok(text.includes('/Filter /DCTDecode'));
assert.ok(text.includes('(Prova) Tj'));
assert.ok(text.includes('(Tavolo) Tj'));
assert.ok(text.includes('(3,00 m) Tj'));
// the xref offsets point at "<n> 0 obj"
const start = Number(/startxref\n(\d+)/.exec(text)![1]);
assert.ok(text.slice(start).startsWith('xref'));
const offs = [...text.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
assert.equal(offs.length, 7);
offs.forEach((o, i) => assert.ok(text.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
// the ruler line: "x y m x2 y2 l S" with 0.5 mm width; its length is 3 m / 25 = 120 mm
const ruler = /q 1 0\.533 0 RG [\d.]+ w ([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S Q/.exec(text);
assert.ok(ruler, 'ruler line');
near(Math.hypot(Number(ruler![3]) - Number(ruler![1]), Number(ruler![4]) - Number(ruler![2])), (120 * 72) / 25.4, 0.1);
// the picture fills the frame: 400 x 252 mm
const pic = /q ([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm \/Im1 Do Q/.exec(text)!;
near(Number(pic[1]), (400 * 72) / 25.4, 0.1);
near(Number(pic[2]), (252 * 72) / 25.4, 0.1);

// text width: "Hello" in Helvetica 10 pt = (722+556+222+222+556)/1000*10 pt = 22.78 pt = 8.037 mm
near(textWidth('Hello', 10), (22.78 * 25.4) / 72, 0.01);
// accents and brackets are escaped / mapped
const pg = new PdfPage(100, 100);
pg.text('a(b)\\ è', 10, 10);
const t2 = Buffer.from(pg.build()).toString('latin1');
assert.ok(t2.includes('(a\\(b\\)\\\\ \xe8) Tj'));
console.log('pdf: ok');
