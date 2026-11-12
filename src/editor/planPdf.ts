// The plan sheets of a project: for each page a to-scale picture seen from above (rendered by the editor, passed in as a JPEG) with
// the drawn parts in vector on top (walls, furniture volumes, names and sizes of the models, wall lengths, notes, rulers, scale
// bar, title block). A page is turned so that the longest wall of its room runs along a side of the sheet. Everything here is plain
// geometry and layout: the rendering itself is done by a callback, so it is testable without a browser.
import { PdfDoc, textWidth, type PdfPage } from './pdf';
import { formatLength, type Measure } from '../room/measure';

export const PAPERS = { A4: [210, 297], A3: [297, 420] } as const;
export type Paper = keyof typeof PAPERS;
export interface SheetOptions {
  paper: Paper;
  orient: 'auto' | 'portrait' | 'landscape';
  scale: 'auto' | 'fit' | number; // 'auto': the biggest standard scale that fits; 'fit': the biggest round scale that fits (fills the sheet); a number: 50 = 1:50
  dims: boolean; // sizes of models and walls
}
export const STANDARD_SCALES = [10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000, 2000];
export const DEFAULT_OPTIONS: SheetOptions = { paper: 'A3', orient: 'auto', scale: 'fit', dims: true };

const MARGIN = 10; // mm round the sheet
const TITLE_H = 22; // mm, the title block
const GAP = 3;
const PAD_M = 0.4; // metres of room round the content

export type P2 = [number, number];
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface PlanModel {
  name: string;
  c: P2; // centre in plan (metres, world)
  u: P2; // unit axis of its width
  hu: number; // half width
  hv: number; // half depth
}
export interface PlanData {
  title: string; // the room's name
  subtitle: string; // the project's name
  date: string;
  axis: P2; // the world direction that runs along the sheet's width (unit); [1, 0] = as it is
  overview?: boolean; // all the rooms together: names of the rooms, no sizes
  renderKey: string; // what the editor shows for this page (opaque here)
  bounds: Bounds; // used only when there is nothing else to measure
  walls: [P2, P2][]; // the scan's wall faces seen from above
  boxes: PlanModel[]; // the scan's furniture volumes
  models: PlanModel[];
  labels: { text: string; p: P2 }[]; // room names (overview)
  measures: Measure[]; // wall lengths / floor areas ('dim', 'label') and the annotations ('pin', 'note', 'ruler')
}
export interface PlanLayout {
  paper: Paper;
  landscape: boolean;
  pw: number;
  ph: number;
  den: number;
  area: { x: number; y: number; w: number; h: number }; // the drawing's frame on the sheet, mm
  rx: number; // the point at the centre of the frame, in the turned frame (along axis, across it)
  rz: number;
  axis: P2;
}
export type PlanRender = (r: { key: string; widthM: number; heightM: number; cx: number; cz: number; axis: P2; pxW: number; pxH: number }) => Promise<{ jpeg: Uint8Array; pxW: number; pxH: number }>;

const across = (u: P2): P2 => [-u[1], u[0]]; // the page's "down" in the world
// a world point in the turned frame
export const turn = (u: P2, p: P2): P2 => [p[0] * u[0] + p[1] * u[1], p[0] * -u[1] + p[1] * u[0]];

// The scale that fills the sheet, rounded up to a round-ish number (1:13, 1:35, 1:120) so that it can be read off a scale rule
const roundUp = (den: number) => {
  const step = den < 20 ? 1 : den < 100 ? 5 : 10;
  return Math.max(1, Math.ceil(den / step - 1e-9) * step);
};

// The smallest standard scale (the biggest drawing) at which wM x hM metres fit in areaW x areaH millimetres.
export function fitScale(wM: number, hM: number, areaW: number, areaH: number): number {
  for (const den of STANDARD_SCALES) if ((wM * 1000) / den <= areaW && (hM * 1000) / den <= areaH) return den;
  return STANDARD_SCALES[STANDARD_SCALES.length - 1];
}

const corners = (m: PlanModel): P2[] => {
  const v = across(m.u);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as P2[]).map(([a, b]) => [m.c[0] + m.u[0] * a * m.hu + v[0] * b * m.hv, m.c[1] + m.u[1] * a * m.hu + v[1] * b * m.hv]);
};

// Everything the page draws, as points of the world (to measure the drawing and to choose the turn).
export function dataPoints(d: PlanData): P2[] {
  const pts: P2[] = [];
  for (const [a, b] of d.walls) pts.push(a, b);
  for (const m of [...d.boxes, ...d.models]) pts.push(...corners(m));
  for (const l of d.labels) pts.push(l.p);
  for (const me of d.measures) {
    if (me.kind === 'dim' && Math.hypot(me.b[0] - me.a[0], me.b[2] - me.a[2]) < 0.02) continue;
    pts.push([me.a[0], me.a[2]], [me.b[0], me.b[2]]);
  }
  if (!pts.length) pts.push([d.bounds.minX, d.bounds.minZ], [d.bounds.maxX, d.bounds.maxZ]);
  return pts;
}

// The extent of the page's content in the turned frame.
export function turnedBounds(d: PlanData): Bounds {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of dataPoints(d)) {
    const [x, z] = turn(d.axis, p);
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minZ = Math.min(b.minZ, z);
    b.maxZ = Math.max(b.maxZ, z);
  }
  return b;
}

// Of the given directions, the one that makes the content's turned box the smallest (a tidy overview of several rooms).
export function bestAxis(d: PlanData, candidates: P2[]): P2 {
  let best = candidates[0] ?? ([1, 0] as P2);
  let area = Infinity;
  for (const u of candidates) {
    const b = turnedBounds({ ...d, axis: u });
    const a = (b.maxX - b.minX) * (b.maxZ - b.minZ);
    if (a < area - 1e-6) {
      area = a;
      best = u;
    }
  }
  return best;
}

export function planLayout(d: PlanData, o: SheetOptions): PlanLayout {
  const b = turnedBounds(d);
  const wM = b.maxX - b.minX + 2 * PAD_M;
  const hM = b.maxZ - b.minZ + 2 * PAD_M;
  const [s, l] = PAPERS[o.paper];
  const make = (landscape: boolean): PlanLayout => {
    const pw = landscape ? l : s;
    const ph = landscape ? s : l;
    const area = { x: MARGIN, y: MARGIN, w: pw - 2 * MARGIN, h: ph - 2 * MARGIN - TITLE_H - GAP };
    const den = o.scale === 'auto' ? fitScale(wM, hM, area.w, area.h) : o.scale === 'fit' ? roundUp(Math.max((wM * 1000) / area.w, (hM * 1000) / area.h)) : o.scale;
    return { paper: o.paper, landscape, pw, ph, den, area, rx: (b.minX + b.maxX) / 2, rz: (b.minZ + b.maxZ) / 2, axis: d.axis };
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

function drawSheet(page: PdfPage, d: PlanData, L: PlanLayout, o: SheetOptions, pageNo: number, pageCount: number, pic: { jpeg: Uint8Array; pxW: number; pxH: number }) {
  const { area, den } = L;
  const u = L.axis;
  const toPage = (x: number, z: number): [number, number] => {
    const [rx, rz] = turn(u, [x, z]);
    return [area.x + area.w / 2 + ((rx - L.rx) * 1000) / den, area.y + area.h / 2 + ((rz - L.rz) * 1000) / den];
  };
  const dims = o.dims && !d.overview;
  const halo = '#ffffff';
  const ang = (x1: number, y1: number, x2: number, y2: number) => {
    let a = (Math.atan2(-(y2 - y1), x2 - x1) * 180) / Math.PI;
    if (a > 90) a -= 180;
    if (a < -90) a += 180;
    return a;
  };
  const clip = (p: [number, number]) => p[0] >= area.x && p[0] <= area.x + area.w && p[1] >= area.y && p[1] <= area.y + area.h;
  const rect = (m: PlanModel) => corners(m).map((c) => toPage(c[0], c[1]));

  page.picture(pic.jpeg, pic.pxW, pic.pxH, area.x, area.y, area.w, area.h);
  page.rect(area.x, area.y, area.w, area.h, { stroke: '#222222', width: 0.35 });

  // the scan's furniture volumes: light, under everything else
  for (const b of d.boxes) page.polygon(rect(b), { fill: '#e6e8ec', stroke: '#b4bac4', width: 0.2 });

  // the walls: a dark line each, with its length when it is long enough to be worth saying
  for (const [a, b] of d.walls) {
    const [x1, y1] = toPage(a[0], a[1]);
    const [x2, y2] = toPage(b[0], b[1]);
    page.line(x1, y1, x2, y2, 0.5, '#2a2f3a');
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (dims && len >= 0.8) page.text(formatLength(len), (x1 + x2) / 2, (y1 + y2) / 2 - 0.9, { size: 6.5, align: 'center', angle: ang(x1, y1, x2, y2), color: '#2a2f3a', halo });
  }

  // models: the footprint and the name (and the size)
  for (const m of d.models) {
    page.polygon(rect(m), { stroke: '#1d4ed8', width: 0.2 });
    const [cx, cy] = toPage(m.c[0], m.c[1]);
    if (!clip([cx, cy])) continue;
    const wMm = (2 * m.hu * 1000) / den;
    const fits = textWidth(m.name, 7, true) < Math.max(wMm, (2 * m.hv * 1000) / den) * 1.4;
    page.text(fits ? m.name : m.name.slice(0, 14), cx, cy - (dims ? 0.6 : -1), { size: 7, bold: true, align: 'center', halo });
    if (dims) page.text(`${formatLength(2 * m.hu)} × ${formatLength(2 * m.hv)}`, cx, cy + 3, { size: 6, align: 'center', halo });
  }

  // wall lengths and floor areas, then the annotations
  for (const me of d.measures) {
    if (me.kind === 'dim') {
      if (!dims) continue;
      if (Math.hypot(me.b[0] - me.a[0], me.b[2] - me.a[2]) < 0.02) continue; // a height, not a length in plan
      const [x1, y1] = toPage(me.a[0], me.a[2]);
      const [x2, y2] = toPage(me.b[0], me.b[2]);
      const mid: [number, number] = [(x1 + x2) / 2, (y1 + y2) / 2];
      if (clip(mid)) page.text(me.text, mid[0], mid[1] - 0.8, { size: 6, align: 'center', angle: ang(x1, y1, x2, y2), halo });
    } else if (me.kind === 'label') {
      if (!dims) continue;
      const [x, y] = toPage(me.a[0], me.a[2]);
      if (clip([x, y])) page.text(me.text, x, y, { size: 8, bold: true, align: 'center', color: '#444444', halo });
    } else if (me.kind === 'ruler') {
      const [x1, y1] = toPage(me.a[0], me.a[2]);
      const [x2, y2] = toPage(me.b[0], me.b[2]);
      const col = me.color ?? '#ff8800';
      page.line(x1, y1, x2, y2, 0.5, col);
      for (const [x, y] of [[x1, y1], [x2, y2]]) page.rect(x - 0.8, y - 0.8, 1.6, 1.6, { fill: col });
      if (me.text) page.text(me.text, (x1 + x2) / 2, (y1 + y2) / 2 - 1.2, { size: 7, bold: true, align: 'center', angle: ang(x1, y1, x2, y2), color: '#222222', halo });
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
  for (const l of d.labels) {
    const [x, y] = toPage(l.p[0], l.p[1]);
    if (clip([x, y])) page.text(l.text, x, y, { size: 13, bold: true, align: 'center', color: '#8a93a3', halo });
  }

  // the title block: name, project, scale, date, a scale bar, page number
  const ty = area.y + area.h + GAP;
  page.rect(area.x, ty, area.w, TITLE_H, { stroke: '#222222', width: 0.35 });
  page.text(d.title, area.x + 4, ty + 9, { size: 15, bold: true });
  page.text(`${d.subtitle ? `${d.subtitle} · ` : ''}${describeLayout(L)} · ${d.date}`, area.x + 4, ty + 16.5, { size: 9, color: '#444444' });
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
  page.text(`Immersa · ${pageNo}/${pageCount}`, area.x + area.w - 4, ty + TITLE_H - 3, { size: 7, align: 'right', color: '#888888' });
}

export async function buildPlanPdf(pages: PlanData[], o: SheetOptions, render: PlanRender): Promise<{ pdf: Uint8Array; layouts: PlanLayout[] }> {
  const doc = new PdfDoc();
  const layouts: PlanLayout[] = [];
  for (let k = 0; k < pages.length; k++) {
    const d = pages[k];
    const L = planLayout(d, o);
    layouts.push(L);
    const { area, den } = L;
    // the picture: about 200 dpi, never more than 7000 pixels on a side
    const perMm = Math.min(200 / 25.4, 7000 / Math.max(area.w, area.h));
    const pxW = Math.round(area.w * perMm);
    const pxH = Math.round(area.h * perMm);
    const v = across(L.axis);
    const cx = L.rx * L.axis[0] + L.rz * v[0]; // the centre of the frame in the world
    const cz = L.rx * L.axis[1] + L.rz * v[1];
    const pic = await render({ key: d.renderKey, widthM: (area.w * den) / 1000, heightM: (area.h * den) / 1000, cx, cz, axis: L.axis, pxW, pxH });
    drawSheet(doc.add(L.pw, L.ph), d, L, o, k + 1, pages.length, pic);
  }
  return { pdf: doc.build(), layouts };
}
