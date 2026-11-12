// Run: npx tsx docs/test-plans/pdf.test.mts   (the plan sheets: scale choice, turn to the longest wall, valid multi-page PDF, true to scale)
import assert from 'node:assert/strict';
import { bestAxis, buildPlanPdf, describeLayout, fitScale, planLayout, turn, turnedBounds, type P2, type PlanData } from '../../src/editor/planPdf.ts';
import { PdfPage, PdfDoc, textWidth } from '../../src/editor/pdf.ts';

const near = (a: number, b: number, eps = 1e-2) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

// A3 landscape frame is 400 x 252 mm (297 x 420 sheet, 10 mm margins, 22 mm title block, 3 mm gap).
assert.equal(fitScale(8, 5, 400, 252), 20); // 8000/20 = 400, 5000/20 = 250
assert.equal(fitScale(8.8, 5.8, 400, 252), 25);
assert.equal(fitScale(0.1, 0.1, 400, 252), 10); // never bigger than the first standard scale
assert.equal(fitScale(1e6, 1e6, 400, 252), 2000); // nor smaller than the last

const base = (over: Partial<PlanData> = {}): PlanData => ({
  title: 'Salotto',
  subtitle: 'Progetto',
  date: '13/11/2026',
  axis: [1, 0],
  renderKey: 'room:r1',
  bounds: { minX: 0, maxX: 8, minZ: 0, maxZ: 5 },
  walls: [[[0, 0], [8, 0]], [[8, 0], [8, 5]], [[8, 5], [0, 5]], [[0, 5], [0, 0]]],
  boxes: [],
  models: [{ name: 'Tavolo', c: [4, 2.5], u: [1, 0], hu: 0.5, hv: 0.25 }],
  labels: [],
  measures: [{ kind: 'ruler', a: [1, 0, 1], b: [4, 0, 1], text: '3,00 m', owner: 'r', color: '#ff8800' }],
  ...over,
});

// 8 x 5 m content (+0.4 m each side): the landscape sheet gives 1:25, the portrait one needs 1:50 -> landscape is chosen
const d = base();
const L = planLayout(d, { paper: 'A3', orient: 'auto', scale: 'auto', dims: true });
assert.equal(L.landscape, true);
assert.equal(L.den, 25);
assert.equal(describeLayout(L), 'Scala 1:25 · A3 orizzontale');
near(L.rx, 4);
near(L.rz, 2.5);
const P = planLayout(d, { paper: 'A4', orient: 'portrait', scale: 100, dims: true });
assert.equal(P.landscape, false);
assert.equal(P.den, 100); // a chosen scale is kept
assert.equal(P.pw, 210);
// 'fit': the biggest round scale that fits, not a standard one. 8.8 x 5.8 m in 400 x 252 mm: max(22, 23.02) -> 1:25 (up to a multiple of 5)
const F = planLayout(d, { paper: 'A3', orient: 'landscape', scale: 'fit', dims: true });
assert.equal(F.den, 25);
// a small room: 3.2 x 2.8 m (+0.8) -> 14.3 -> 1:15 (up to a whole number below 1:20)
const small = planLayout(base({ walls: [[[0, 0], [3.2, 0]], [[3.2, 0], [3.2, 2.8]]], models: [], measures: [] }), { paper: 'A3', orient: 'landscape', scale: 'fit', dims: true });
assert.equal(small.den, 15);

// A room turned by 30 degrees: with its long wall as the axis the box is 8 x 5 again; with the world axes it is bigger
const t = (30 * Math.PI) / 180;
const rot = (p: P2): P2 => [p[0] * Math.cos(t) - p[1] * Math.sin(t) + 10, p[0] * Math.sin(t) + p[1] * Math.cos(t) + 3];
const walls = d.walls.map(([a, b]) => [rot(a), rot(b)] as [P2, P2]);
const turned = base({ walls, models: [], measures: [] });
const wb = turnedBounds(turned);
assert.ok(wb.maxX - wb.minX > 8.5); // not turned: the box of a turned room is wider
const axis: P2 = [Math.cos(t), Math.sin(t)]; // along the long wall
const tb = turnedBounds({ ...turned, axis });
near(tb.maxX - tb.minX, 8, 1e-6);
near(tb.maxZ - tb.minZ, 5, 1e-6);
// bestAxis picks it among a few candidates
const cand: P2[] = [[1, 0], axis, [Math.cos(t + Math.PI / 2), Math.sin(t + Math.PI / 2)]];
const picked = bestAxis(turned, cand);
near(picked[0], axis[0], 1e-6);
near(picked[1], axis[1], 1e-6);
// turn() is a rotation: lengths keep, and the axis maps to (1, 0)
near(Math.hypot(...turn(axis, [3, 4])), 5, 1e-9);
near(turn(axis, axis)[0], 1, 1e-9);
near(turn(axis, axis)[1], 0, 1e-9);

// A two-page PDF: valid structure, and a 3 m ruler at 1:25 is 120 mm = 340.157 pt long on the page
const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // not a real picture: the writer only stores the bytes
const keys: string[] = [];
const { pdf, layouts } = await buildPlanPdf([d, base({ title: 'Cucina', renderKey: 'room:r2', measures: [], overview: false })], { paper: 'A3', orient: 'auto', scale: 'auto', dims: true }, async (r) => {
  keys.push(r.key);
  near(r.widthM, (400 * 25) / 1000);
  near(r.cx, 4);
  near(r.cz, 2.5);
  assert.ok(r.pxW > 1000 && r.pxH > 1000);
  return { jpeg: fake, pxW: r.pxW, pxH: r.pxH };
});
assert.deepEqual(keys, ['room:r1', 'room:r2']);
assert.equal(layouts.length, 2);
const text = Buffer.from(pdf).toString('latin1');
assert.ok(text.startsWith('%PDF-1.4'));
assert.ok(text.trimEnd().endsWith('%%EOF'));
assert.equal((text.match(/\/Type \/Page /g) ?? []).length, 2);
assert.ok(text.includes('/Count 2'));
assert.equal((text.match(/\/Filter \/DCTDecode/g) ?? []).length, 2);
assert.ok(text.includes('(Salotto) Tj') && text.includes('(Cucina) Tj'));
assert.ok(text.includes('(Tavolo) Tj'));
assert.ok(text.includes('(3,00 m) Tj'));
assert.ok(text.includes('(Immersa \xb7 1/2) Tj') && text.includes('(Immersa \xb7 2/2) Tj'));
// the xref offsets point at "<n> 0 obj"
const start = Number(/startxref\n(\d+)/.exec(text)![1]);
assert.ok(text.slice(start).startsWith('xref'));
const offs = [...text.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
assert.equal(offs.length, 4 + 2 * 3); // catalog, pages, two fonts, then page + content + picture for each of the 2 pages
offs.forEach((o, i) => assert.ok(text.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
// the ruler line of page 1: "x y m x2 y2 l S" with 0.5 mm width; its length is 3 m / 25 = 120 mm
const ruler = /q 1 0\.533 0 RG [\d.]+ w ([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S Q/.exec(text);
assert.ok(ruler, 'ruler line');
near(Math.hypot(Number(ruler![3]) - Number(ruler![1]), Number(ruler![4]) - Number(ruler![2])), (120 * 72) / 25.4, 0.1);
// the picture fills the frame: 400 x 252 mm
const pic = /q ([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm \/Im1 Do Q/.exec(text)!;
near(Number(pic[1]), (400 * 72) / 25.4, 0.1);
near(Number(pic[2]), (252 * 72) / 25.4, 0.1);

// a turned page: the wall between two points 8 m apart along the axis is 8 m / 25 = 320 mm long on the page whatever the turn
const tp = base({ walls: [[rot([0, 0]), rot([8, 0])]], models: [], measures: [], axis });
const out2 = await buildPlanPdf([tp], { paper: 'A3', orient: 'landscape', scale: 25, dims: false }, async (r) => {
  near(r.axis[0], axis[0], 1e-9);
  return { jpeg: fake, pxW: r.pxW, pxH: r.pxH };
});
const t3 = Buffer.from(out2.pdf).toString('latin1');
const wl = /q 0\.165 0\.184 0\.227 RG [\d.]+ w ([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S Q/.exec(t3)!;
assert.ok(wl, 'wall line');
near(Math.abs(Number(wl[3]) - Number(wl[1])), (320 * 72) / 25.4, 0.1); // horizontal on the sheet
near(Number(wl[4]), Number(wl[2]), 0.1);

// text width: "Hello" in Helvetica 10 pt = (722+556+222+222+556)/1000*10 pt = 22.78 pt = 8.037 mm
near(textWidth('Hello', 10), (22.78 * 25.4) / 72, 0.01);
// accents and brackets are escaped / mapped
const pg = new PdfPage(100, 100);
pg.text('a(b)\\ è', 10, 10);
const t2 = Buffer.from(new PdfDoc([pg]).build()).toString('latin1');
assert.ok(t2.includes('(a\\(b\\)\\\\ \xe8) Tj'));
console.log('pdf: ok');
