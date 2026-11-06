import DxfParser from 'dxf-parser';
import type { Structure } from '../room/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
// A CAD floor plan (DXF) becomes walls and floors. The plan is flat: X, Y of the drawing -> x, z of the scene (the plan
// reads like it does on paper seen from above). The file says which layer holds what only by its name, so the user picks the
// layers in a dialog; units come from the header ($INSUNITS) or a guess from the size.

export type PlanUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export const PLAN_UNIT_M: Record<PlanUnit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };

export interface PlanLine {
  layer: string;
  pts: [number, number][]; // drawing units
  closed: boolean;
}

export interface PlanInfo {
  lines: PlanLine[];
  layers: { name: string; lines: number; closed: number }[];
  unit: PlanUnit; // from the header, else a guess
  unitKnown: boolean;
  size: [number, number]; // width, depth of the whole drawing in drawing units
}

// A building or a room: between a small room and a big hall or campus.
export const plausibleSize = (metres: number) => metres >= 2 && metres <= 250;
// Without a usable unit in the file: a house is 5-30 m, so 5-30 in metres, 500-3000 in centimetres, 5000-30000 in millimetres.
export const guessUnit = (longest: number): PlanUnit => (longest <= 60 ? 'm' : longest <= 2500 ? 'cm' : 'mm');

const INSUNITS: Record<number, PlanUnit> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };

type Mat = [number, number, number, number, number, number]; // 2D affine: x' = a x + c y + e, y' = b x + d y + f
const IDENT: Mat = [1, 0, 0, 1, 0, 0];
const apply = (m: Mat, p: { x: number; y: number }): [number, number] => [m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5]];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

// Angles of an ARC in the parser's output are in radians (checked against the sample file); an arc becomes a polyline.
function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number): { x: number; y: number }[] {
  let end = a1;
  while (end <= a0) end += Math.PI * 2;
  const n = Math.max(4, Math.ceil(((end - a0) / (Math.PI * 2)) * 48));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: cx + r * Math.cos(a0 + ((end - a0) * i) / n), y: cy + r * Math.sin(a0 + ((end - a0) * i) / n) }));
}

export function parsePlan(text: string): PlanInfo {
  const dxf: any = new DxfParser().parseSync(text);
  if (!dxf) throw new Error('Il file non è un DXF che riesco a leggere (serve un DXF in formato testo).');
  const lines: PlanLine[] = [];
  const blocks: Record<string, any> = dxf.blocks ?? {};
  const emit = (e: any, m: Mat, layer: string, depth: number) => {
    const lay = e.layer && e.layer !== '0' ? e.layer : layer;
    switch (e.type) {
      case 'LINE':
        if (e.vertices?.length >= 2) lines.push({ layer: lay, pts: e.vertices.slice(0, 2).map((v: any) => apply(m, v)), closed: false });
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE':
        if (e.vertices?.length >= 2) lines.push({ layer: lay, pts: e.vertices.map((v: any) => apply(m, v)), closed: !!e.shape });
        break;
      case 'ARC':
        if (e.center && e.radius > 0) lines.push({ layer: lay, pts: arcPoints(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle).map((v) => apply(m, v)), closed: false });
        break;
      case 'INSERT': {
        const b = blocks[e.name];
        if (!b?.entities || depth > 3) break;
        const sx = e.xScale ?? 1;
        const sy = e.yScale ?? 1;
        const rot = ((e.rotation ?? 0) * Math.PI) / 180; // INSERT rotation is in degrees
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        const base = b.position ?? { x: 0, y: 0 };
        const place: Mat = [c * sx, s * sx, -s * sy, c * sy, e.position?.x ?? 0, e.position?.y ?? 0];
        const inner = mul(m, mul(place, [1, 0, 0, 1, -base.x, -base.y]));
        for (const child of b.entities) emit(child, inner, lay, depth + 1);
        break;
      }
    }
  };
  for (const e of dxf.entities ?? []) emit(e, IDENT, e.layer ?? '0', 0);
  if (!lines.length) throw new Error('Nel DXF non ci sono linee, polilinee o archi da usare.');

  const byLayer = new Map<string, { lines: number; closed: number }>();
  for (const l of lines) {
    const x = byLayer.get(l.layer) ?? { lines: 0, closed: 0 };
    x.lines++;
    if (l.closed) x.closed++;
    byLayer.set(l.layer, x);
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of lines) for (const [x, y] of l.pts) (minX = Math.min(minX, x), maxX = Math.max(maxX, x), minY = Math.min(minY, y), maxY = Math.max(maxY, y));
  const size: [number, number] = [maxX - minX, maxY - minY];
  const code = Number(dxf.header?.['$INSUNITS'] ?? 0);
  const longest = Math.max(size[0], size[1]);
  // The header is often wrong (a plan in millimetres saved as "metres"), so it counts only when the size it gives is believable.
  const header = INSUNITS[code];
  const known = header && plausibleSize(longest * PLAN_UNIT_M[header]) ? header : undefined;
  const unit: PlanUnit = known ?? guessUnit(longest);
  return { lines, layers: [...byLayer].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.lines - a.lines), unit, unitKnown: !!known, size };
}

// Layers that look like walls / floors by name (the dialog starts with these ticked).
export const guessWallLayers = (names: string[]) => names.filter((n) => /mur|wall|pareti|parete|wand|mur/i.test(n));
export const guessFloorLayers = (names: string[]) => names.filter((n) => /pav|floor|room|stanz|local|boden|sol/i.test(n));

export interface PlanOptions {
  unit: PlanUnit;
  wallLayers: string[];
  floorLayers: string[]; // closed polylines on these become floors
  mode: 'axis' | 'double'; // each line is a wall's axis / walls are drawn with two parallel lines
  thickness: number; // m, for axis mode (and lines without a pair)
  height: number; // m
  boxFloor: boolean; // when there are no floor layers: one floor under everything
}

type Seg = { a: [number, number]; b: [number, number]; t: number };

const len = (s: Seg) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
const dirOf = (s: Seg): [number, number] => {
  const l = len(s) || 1;
  return [(s.b[0] - s.a[0]) / l, (s.b[1] - s.a[1]) / l];
};

// Walls drawn as two parallel lines: the lines that run side by side, 4-60 cm apart and overlapping, become one wall on
// their midline, as thick as the gap. The span is the union of the two (so that corners are closed).
function pairLines(segs: Seg[]): Seg[] {
  const used = new Array<boolean>(segs.length).fill(false);
  const out: Seg[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const s = segs[i];
    const d = dirOf(s);
    const n: [number, number] = [-d[1], d[0]];
    let best = -1;
    let bestGap = Infinity;
    for (let j = i + 1; j < segs.length; j++) {
      if (used[j]) continue;
      const q = segs[j];
      const e = dirOf(q);
      if (Math.abs(d[0] * e[1] - d[1] * e[0]) > 0.035) continue; // not parallel (about 2 degrees)
      const off = (q.a[0] - s.a[0]) * n[0] + (q.a[1] - s.a[1]) * n[1];
      const gap = Math.abs(off);
      if (gap < 0.04 || gap > 0.6) continue;
      // overlap along the direction
      const p0 = 0;
      const p1 = len(s);
      const q0 = (q.a[0] - s.a[0]) * d[0] + (q.a[1] - s.a[1]) * d[1];
      const q1 = (q.b[0] - s.a[0]) * d[0] + (q.b[1] - s.a[1]) * d[1];
      const lo = Math.max(p0, Math.min(q0, q1));
      const hi = Math.min(p1, Math.max(q0, q1));
      if (hi - lo < 0.3 * Math.min(len(s), len(q))) continue;
      if (gap < bestGap) (best = j, bestGap = gap);
    }
    if (best < 0) {
      used[i] = true;
      if (len(s) >= 0.6) out.push(s); // a long line alone stays a wall of the default thickness; a short one is the end of a wall (a door jamb)
      continue;
    }
    const q = segs[best];
    used[i] = used[best] = true;
    const q0 = (q.a[0] - s.a[0]) * d[0] + (q.a[1] - s.a[1]) * d[1];
    const q1 = (q.b[0] - s.a[0]) * d[0] + (q.b[1] - s.a[1]) * d[1];
    const lo = Math.min(0, q0, q1);
    const hi = Math.max(len(s), q0, q1);
    const off = ((q.a[0] - s.a[0]) * n[0] + (q.a[1] - s.a[1]) * n[1]) / 2; // midline is halfway to the other line
    out.push({
      a: [s.a[0] + d[0] * lo + n[0] * off, s.a[1] + d[1] * lo + n[1] * off],
      b: [s.a[0] + d[0] * hi + n[0] * off, s.a[1] + d[1] * hi + n[1] * off],
      t: bestGap,
    });
  }
  return out;
}

// Walls on the same line, same thickness, touching or overlapping: one longer wall.
function mergeCollinear(segs: Seg[]): Seg[] {
  const list = segs.map((s) => ({ ...s }));
  for (let changed = true; changed; ) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const s = list[i];
        const q = list[j];
        if (Math.abs(s.t - q.t) > 0.01) continue;
        const d = dirOf(s);
        const e = dirOf(q);
        if (Math.abs(d[0] * e[1] - d[1] * e[0]) > 0.0175) continue; // 1 degree
        const n: [number, number] = [-d[1], d[0]];
        if (Math.abs((q.a[0] - s.a[0]) * n[0] + (q.a[1] - s.a[1]) * n[1]) > 0.015) continue;
        const q0 = (q.a[0] - s.a[0]) * d[0] + (q.a[1] - s.a[1]) * d[1];
        const q1 = (q.b[0] - s.a[0]) * d[0] + (q.b[1] - s.a[1]) * d[1];
        const lo = Math.min(0, q0, q1);
        const hi = Math.max(len(s), q0, q1);
        if (hi - lo > len(s) + len(q) + 0.03) continue; // a gap: a door
        list[i] = { a: [s.a[0] + d[0] * lo, s.a[1] + d[1] * lo], b: [s.a[0] + d[0] * hi, s.a[1] + d[1] * hi], t: s.t };
        list.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return list;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// The plan as structures (roomId '' = the project's free space), centred on the origin, y up.
export function planToStructures(info: PlanInfo, o: PlanOptions): Structure[] {
  const k = PLAN_UNIT_M[o.unit];
  const tx = (p: [number, number]): [number, number] => [p[0] * k, -p[1] * k]; // drawing y -> scene -z
  let segs: Seg[] = [];
  const walls = new Set(o.wallLayers);
  for (const l of info.lines) {
    if (!walls.has(l.layer)) continue;
    const pts = l.pts.map(tx);
    const n = l.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= 0.01) segs.push({ a, b, t: o.thickness });
    }
  }
  if (o.mode === 'double') segs = pairLines(segs.map((s) => ({ ...s, t: o.thickness })));
  segs = mergeCollinear(segs).filter((s) => len(s) >= 0.05);

  const floorPolys: [number, number][][] = [];
  const floorLayers = new Set(o.floorLayers);
  for (const l of info.lines) if (floorLayers.has(l.layer) && l.closed && l.pts.length >= 3) floorPolys.push(l.pts.map(tx));

  // Everything is centred on the middle of what was built.
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const grow = (p: [number, number]) => (minX = Math.min(minX, p[0]), maxX = Math.max(maxX, p[0]), minZ = Math.min(minZ, p[1]), maxZ = Math.max(maxZ, p[1]));
  for (const s of segs) (grow(s.a), grow(s.b));
  for (const poly of floorPolys) poly.forEach(grow);
  if (!isFinite(minX)) return [];
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const c = (p: [number, number]): [number, number] => [+(p[0] - cx).toFixed(3), +(p[1] - cz).toFixed(3)];

  const out: Structure[] = [];
  for (const poly of floorPolys) {
    const pts = poly.map(c);
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    out.push({ id: newId(), roomId: '', kind: 'floor', a: [Math.min(...xs), Math.min(...zs)], b: [Math.max(...xs), Math.max(...zs)], y: 0, height: o.height, thickness: 0.05, pts });
  }
  if (!floorPolys.length && o.boxFloor) {
    const a = c([minX, minZ]);
    const b = c([maxX, maxZ]);
    out.push({ id: newId(), roomId: '', kind: 'floor', a, b, y: 0, height: o.height, thickness: 0.05, pts: [a, [b[0], a[1]], b, [a[0], b[1]]] });
  }
  for (const s of segs) out.push({ id: newId(), roomId: '', kind: 'wall', a: c(s.a), b: c(s.b), y: 0, height: o.height, thickness: +s.t.toFixed(3), align: 'center' });
  return out;
}
