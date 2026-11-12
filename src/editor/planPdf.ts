// The plan sheet of a project: a to-scale picture seen from above (rendered by the editor, passed in as a JPEG) with the
// drawn parts in vector on top (names and sizes of the models, wall lengths, notes, rulers, scale bar, title block).
// Everything here is plain geometry and layout: the rendering itself is done by a callback, so it is testable without a browser.
import { PdfPage, textWidth } from './pdf';
import { formatLength, type Measure } from '../room/measure';

export const PAPERS = { A4: [210, 297], A3: [297, 420] } as const;
export type Paper = keyof typeof PAPERS;
export interface SheetOptions {
  paper: Paper;
  orient: 'auto' | 'portrait' | 'landscape';
  scale: 'auto' | number; // the denominator: 50 = 1:50
  dims: boolean; // sizes of models and walls
}
export const STANDARD_SCALES = [10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000, 2000];
export const DEFAULT_OPTIONS: SheetOptions = { paper: 'A3', orient: 'auto', scale: 'auto', dims: true };

const MARGIN = 10; // mm round the sheet
const TITLE_H = 22; // mm, the title block
const GAP = 3;
const PAD_M = 0.4; // metres of room round the content

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface PlanModel {
  name: string;
  c: [number, number]; // centre in plan (metres)
  u: [number, number]; // unit axis of its width
  hu: number; // half width
  hv: number; // half depth
}
export interface PlanData {
  title: string;
  date: string;
  bounds: Bounds;
  walls: [[number, number], [number, number]][]; // the scan's wall faces seen from above (the picture shows them white on white)
  models: PlanModel[];
  measures: Measure[]; // wall lengths / floor areas ('dim', 'label') and the annotations ('pin', 'note', 'ruler')
}
export interface PlanLayout {
  paper: Paper;
  landscape: boolean;
  pw: number;
  ph: number;
  den: number;
  area: { x: number; y: number; w: number; h: number }; // the drawing's frame on the sheet, mm
  cx: number; // the world point at the centre of the frame
  cz: number;
}
export type PlanRender = (r: { widthM: number; heightM: number; cx: number; cz: number; pxW: number; pxH: number }) => Promise<{ jpeg: Uint8Array; pxW: number; pxH: number }>;

// The smallest standard scale (the biggest drawing) at which wM x hM metres fit in areaW x areaH millimetres.
export function fitScale(wM: number, hM: number, areaW: number, areaH: number): number {
  for (const den of STANDARD_SCALES) if ((wM * 1000) / den <= areaW && (hM * 1000) / den <= areaH) return den;
  return STANDARD_SCALES[STANDARD_SCALES.length - 1];
}

export function planLayout(b: Bounds, o: SheetOptions): PlanLayout {
  const wM = b.maxX - b.minX + 2 * PAD_M;
  const hM = b.maxZ - b.minZ + 2 * PAD_M;
  const [s, l] = PAPERS[o.paper];
  const make = (landscape: boolean) => {
    const pw = landscape ? l : s;
    const ph = landscape ? s : l;
    const area = { x: MARGIN, y: MARGIN, w: pw - 2 * MARGIN, h: ph - 2 * MARGIN - TITLE_H - GAP };
    const den = o.scale === 'auto' ? fitScale(wM, hM, area.w, area.h) : o.scale;
    return { paper: o.paper, landscape, pw, ph, den, area, cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2 } as PlanLayout;
  };
  if (o.orient === 'portrait') return make(false);
  if (o.orient === 'landscape') return make(true);
  const p = make(false);
  const ls = make(true);
  if (ls.den !== p.den) return ls.den < p.den ? ls : p;
  return wM >= hM ? ls : p; // same scale: the shape that suits the plan
}

// "Scala 1:50 · A3 orizzontale", also for the choice window
export const describeLayout = (L: PlanLayout) => `Scala 1:${L.den} · ${L.paper} ${L.landscape ? 'orizzontale' : 'verticale'}`;

const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (cur && (cur + ' ' + w).length > max) {
        lines.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    lines.push(cur);
  }
  return lines.slice(0, 8);
}

export async function buildPlanPdf(data: PlanData, o: SheetOptions, render: PlanRender): Promise<{ pdf: Uint8Array; layout: PlanLayout }> {
  const L = planLayout(data.bounds, o);
  const { area, den } = L;
  const page = new PdfPage(L.pw, L.ph);
  const toPage = (x: number, z: number): [number, number] => [area.x + area.w / 2 + ((x - L.cx) * 1000) / den, area.y + area.h / 2 + ((z - L.cz) * 1000) / den];

  // the picture: about 200 dpi, never more than 7000 pixels on a side
  const perMm = Math.min(200 / 25.4, 7000 / Math.max(area.w, area.h));
  const pxW = Math.round(area.w * perMm);
  const pxH = Math.round(area.h * perMm);
  const pic = await render({ widthM: (area.w * den) / 1000, heightM: (area.h * den) / 1000, cx: L.cx, cz: L.cz, pxW, pxH });
  page.picture(pic.jpeg, pic.pxW, pic.pxH, area.x, area.y, area.w, area.h);
  page.rect(area.x, area.y, area.w, area.h, { stroke: '#222222', width: 0.35 });

  const clip = (p: [number, number]) => p[0] >= area.x && p[0] <= area.x + area.w && p[1] >= area.y && p[1] <= area.y + area.h;
  const halo = '#ffffff';

  // the room's walls: a dark line each, with its length when it is long enough to be worth saying
  for (const [a, b] of data.walls) {
    const [x1, y1] = toPage(a[0], a[1]);
    const [x2, y2] = toPage(b[0], b[1]);
    page.line(x1, y1, x2, y2, 0.5, '#2a2f3a');
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (o.dims && len >= 0.8) {
      let ang = (Math.atan2(-(y2 - y1), x2 - x1) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      page.text(formatLength(len), (x1 + x2) / 2, (y1 + y2) / 2 - 0.9, { size: 6.5, align: 'center', angle: ang, color: '#2a2f3a', halo });
    }
  }

  // models: the footprint and the name (and the size)
  for (const m of data.models) {
    const v: [number, number] = [-m.u[1], m.u[0]];
    const corner = (a: number, b: number) => toPage(m.c[0] + m.u[0] * a * m.hu + v[0] * b * m.hv, m.c[1] + m.u[1] * a * m.hu + v[1] * b * m.hv);
    page.polygon([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], { stroke: '#1d4ed8', width: 0.2 });
    const [cx, cy] = toPage(m.c[0], m.c[1]);
    if (!clip([cx, cy])) continue;
    const wMm = (2 * m.hu * 1000) / den;
    const fits = textWidth(m.name, 7, true) < Math.max(wMm, 2 * m.hv * 1000 / den) * 1.4;
    page.text(fits ? m.name : m.name.slice(0, 14), cx, cy - (o.dims ? 0.6 : -1), { size: 7, bold: true, align: 'center', halo });
    if (o.dims) page.text(`${formatLength(2 * m.hu)} × ${formatLength(2 * m.hv)}`, cx, cy + 3, { size: 6, align: 'center', halo });
  }

  // wall lengths and floor areas, then the annotations
  for (const me of data.measures) {
    if (me.kind === 'dim') {
      if (!o.dims) continue;
      const dx = me.b[0] - me.a[0];
      const dz = me.b[2] - me.a[2];
      if (Math.hypot(dx, dz) < 0.02) continue; // a height, not a length in plan
      const [x1, y1] = toPage(me.a[0], me.a[2]);
      const [x2, y2] = toPage(me.b[0], me.b[2]);
      const mid: [number, number] = [(x1 + x2) / 2, (y1 + y2) / 2];
      if (!clip(mid)) continue;
      let ang = (Math.atan2(-(y2 - y1), x2 - x1) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      page.text(me.text, mid[0], mid[1] - 0.8, { size: 6, align: 'center', angle: ang, halo });
    } else if (me.kind === 'label') {
      if (!o.dims) continue;
      const [x, y] = toPage(me.a[0], me.a[2]);
      if (clip([x, y])) page.text(me.text, x, y, { size: 8, bold: true, align: 'center', color: '#444444', halo });
    } else if (me.kind === 'ruler') {
      const [x1, y1] = toPage(me.a[0], me.a[2]);
      const [x2, y2] = toPage(me.b[0], me.b[2]);
      const col = me.color ?? '#ff8800';
      page.line(x1, y1, x2, y2, 0.5, col);
      for (const [x, y] of [[x1, y1], [x2, y2]]) page.rect(x - 0.8, y - 0.8, 1.6, 1.6, { fill: col });
      let ang = (Math.atan2(-(y2 - y1), x2 - x1) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      if (me.text) page.text(me.text, (x1 + x2) / 2, (y1 + y2) / 2 - 1.2, { size: 7, bold: true, align: 'center', angle: ang, color: '#222222', halo });
    } else if (me.kind === 'pin') {
      const [x, y] = toPage(me.a[0], me.a[2]);
      const col = me.color ?? '#ff8800';
      page.line(x - 1.6, y, x + 1.6, y, 0.5, col);
      page.line(x, y - 1.6, x, y + 1.6, 0.5, col);
    } else if (me.kind === 'note' && me.text) {
      const [x, y] = toPage(me.a[0], me.a[2]);
      if (!clip([x, y])) continue;
      const col = me.color ?? '#ff8800';
      const lines = wrap(me.text, 28);
      const w = Math.max(...lines.map((s) => textWidth(s, 7))) + 3;
      const h = lines.length * 3.2 + 2;
      page.rect(x - w / 2, y - h - 1, w, h, { fill: '#fffbe6', stroke: col, width: 0.3 });
      lines.forEach((s, i) => page.text(s, x - w / 2 + 1.5, y - h - 1 + 3 + i * 3.2, { size: 7, color: '#222222' }));
    }
  }

  // the title block: name, scale, date, a scale bar
  const ty = area.y + area.h + GAP;
  page.rect(area.x, ty, area.w, TITLE_H, { stroke: '#222222', width: 0.35 });
  page.text(data.title, area.x + 4, ty + 9, { size: 15, bold: true });
  page.text(`${describeLayout(L)} · ${data.date}`, area.x + 4, ty + 16.5, { size: 9, color: '#444444' });
  const barMax = Math.min(70, area.w * 0.35);
  let barM = NICE[0];
  for (const n of NICE) if ((n * 1000) / den <= barMax) barM = n;
  const barW = (barM * 1000) / den;
  const bx = area.x + area.w - 6 - barW - 14;
  const by = ty + 12;
  const seg = 4;
  for (let i = 0; i < seg; i++) page.rect(bx + (i * barW) / seg, by, barW / seg, 2.2, { fill: i % 2 ? '#ffffff' : '#222222', stroke: '#222222', width: 0.2 });
  page.text('0', bx, by - 1.4, { size: 7, align: 'center' });
  page.text(formatLength(barM), bx + barW, by - 1.4, { size: 7, align: 'center' });
  page.text('Immersa', area.x + area.w - 4, ty + TITLE_H - 3, { size: 7, align: 'right', color: '#888888' });

  return { pdf: page.build(), layout: L };
}
