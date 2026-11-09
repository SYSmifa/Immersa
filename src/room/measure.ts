import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { planeNormal } from './align';
import { effective, floorPoints, polygonArea } from './structures';
import type { RoomBox, RoomModel, RoomPlane, Structure, Vec3 } from './types';

// Measures and distances, worked out from the room's data alone (no drawing): the editor and the headset show what this returns.
// Everything is in the room's frame, plan = (x, z), up = y.

export type P2 = [number, number];

// A vertical wall face seen from above: a segment in plan with the heights it covers.
export interface Seg {
  a: P2;
  b: P2;
  y0: number;
  y1: number;
  owner: string; // what it belongs to (a measure never stops on its own object)
}

// An oriented rectangle in plan with a height range: a model, or a furniture box of the scan.
export interface Solid {
  id: string;
  name: string;
  c: P2; // centre
  u: P2; // unit axis of its width (the other axis is u turned a quarter)
  hu: number; // half width, along u
  hv: number; // half depth, along v = (-u.z, u.x)
  y0: number;
  y1: number;
}

// `dim`: a line with its size. `gap`: a free distance to the next thing. `label`: only a text at a point (a === b).
export interface Measure {
  kind: 'dim' | 'gap' | 'label';
  a: Vec3;
  b: Vec3;
  text: string;
  owner: string;
}

export interface MeasureContext {
  obstacles: Seg[]; // wall faces and other objects' sides
  axes: P2 | null; // the room's own directions (along its walls); null: use the object's axes
  ceilingY: number | null;
  floorY: number;
  maxRange?: number; // free distances farther than this are not shown
}

const SAMPLES = 9; // rays across an object's side
const MAX_RANGE = 3;

export function formatLength(m: number): string {
  const comma = (n: number, d: number) => n.toFixed(d).replace('.', ',');
  if (m >= 1) return `${comma(m, 2)} m`;
  if (m >= 0.1) return `${Math.round(m * 100)} cm`;
  if (m >= 0.01) return `${comma(m * 100, 1)} cm`;
  return `${Math.round(m * 1000)} mm`;
}
export const formatArea = (m2: number) => `${m2.toFixed(2).replace('.', ',')} m²`;

const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z];
const perp = (u: P2): P2 => [-u[1], u[0]];

// ---- turning the room's data into solids and wall faces ----

function solidFromCorners(id: string, name: string, corners: Vector3[], u: P2): Solid {
  const v = perp(u);
  let [u0, u1, v0, v1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (const p of corners) {
    const pu = p.x * u[0] + p.z * u[1];
    const pv = p.x * v[0] + p.z * v[1];
    u0 = Math.min(u0, pu);
    u1 = Math.max(u1, pu);
    v0 = Math.min(v0, pv);
    v1 = Math.max(v1, pv);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  return { id, name, c: [u[0] * cu + v[0] * cv, u[1] * cu + v[1] * cv], u, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2, y0, y1 };
}

const cornersOf = (lo: Vec3, hi: Vec3, m: Matrix4) => {
  const out: Vector3[] = [];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) out.push(new Vector3(x, y, z).applyMatrix4(m));
  return out;
};

// A placed model. `lo`/`hi`: its box in its own frame at scale 1 (as the loaded file is, centred on x/z, base at y = 0).
export function modelSolid(m: RoomModel, lo: Vec3, hi: Vec3): Solid {
  const q = new Quaternion().setFromEuler(new Euler(m.tilt?.[0] ?? 0, m.yaw, m.tilt?.[1] ?? 0, 'YXZ'));
  const mat = new Matrix4().compose(new Vector3(...m.pos), q, new Vector3(m.scale, m.scale, m.scale));
  return solidFromCorners(m.id, m.name, cornersOf(lo, hi, mat), [Math.cos(m.yaw), -Math.sin(m.yaw)]);
}

// A furniture box of the scan (an oriented box in the scan's frame).
export function boxSolid(b: RoomBox, index: number): Solid {
  const q = new Quaternion(...b.quat);
  const mat = new Matrix4().compose(new Vector3(...b.pos), q, new Vector3(1, 1, 1));
  const x = new Vector3(1, 0, 0).applyQuaternion(q);
  const len = Math.hypot(x.x, x.z);
  const u: P2 = len > 0.05 ? [x.x / len, x.z / len] : [1, 0];
  return solidFromCorners(`box:${index}`, b.label, cornersOf(b.min, b.max, mat), u);
}

// The four sides of a solid as wall faces.
export function solidSegs(s: Solid): Seg[] {
  const v = perp(s.u);
  const p = (a: number, b: number): P2 => [s.c[0] + s.u[0] * a * s.hu + v[0] * b * s.hv, s.c[1] + s.u[1] * a * s.hu + v[1] * b * s.hv];
  const k = [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
  return k.map((a, i) => ({ a, b: k[(i + 1) % 4], y0: s.y0, y1: s.y1, owner: s.id }));
}

// A wall built in the editor: its four sides (it has a thickness).
export function wallSegs(st: Structure): Seg[] {
  if (st.kind !== 'wall') return [];
  const s = effective(st);
  const dx = s.b[0] - s.a[0];
  const dz = s.b[1] - s.a[1];
  const len = Math.max(0.01, Math.hypot(dx, dz));
  const off = s.align === 'left' ? s.thickness / 2 : s.align === 'right' ? -s.thickness / 2 : 0;
  const c: P2 = [(s.a[0] + s.b[0]) / 2 + (dz / len) * off, (s.a[1] + s.b[1]) / 2 - (dx / len) * off];
  const solid: Solid = { id: s.id, name: 'parete', c, u: [dx / len, dz / len], hu: len / 2, hv: s.thickness / 2, y0: s.y, y1: s.y + s.height };
  return solidSegs(solid);
}

const WALLS = new Set(['wall', 'wall face']);
// A wall plane of the scan: a vertical polygon, seen from above it is a segment.
export function planeSeg(p: RoomPlane, index: number): Seg | null {
  if (!WALLS.has(p.label) || !p.quat || !p.poly || p.poly.length < 6) return null;
  const n = planeNormal(p.quat);
  if (Math.abs(n[1]) > 0.5) return null; // not vertical
  const q = new Quaternion(...p.quat);
  const pos = new Vector3(...p.pos);
  const pts: Vector3[] = [];
  for (let i = 0; i < p.poly.length; i += 2) pts.push(new Vector3(p.poly[i], 0, p.poly[i + 1]).applyQuaternion(q).add(pos));
  const nl = Math.hypot(n[0], n[2]) || 1;
  const d: P2 = [-n[2] / nl, n[0] / nl]; // along the wall
  let [t0, t1, y0, y1, off] = [Infinity, -Infinity, Infinity, -Infinity, 0];
  for (const p3 of pts) {
    const t = p3.x * d[0] + p3.z * d[1];
    t0 = Math.min(t0, t);
    t1 = Math.max(t1, t);
    y0 = Math.min(y0, p3.y);
    y1 = Math.max(y1, p3.y);
    off += p3.x * (n[0] / nl) + p3.z * (n[2] / nl);
  }
  off /= pts.length;
  if (t1 - t0 < 0.1) return null;
  const nn: P2 = [n[0] / nl, n[2] / nl];
  return { a: [d[0] * t0 + nn[0] * off, d[1] * t0 + nn[1] * off], b: [d[0] * t1 + nn[0] * off, d[1] * t1 + nn[1] * off], y0, y1, owner: `plane:${index}` };
}

export const ceilingYOf = (planes: RoomPlane[]): number | null => planes.find((p) => p.label === 'ceiling')?.pos[1] ?? null;
export const floorYOf = (planes: RoomPlane[]): number => planes.find((p) => p.label === 'floor')?.pos[1] ?? 0;

// The room's own direction: along its longest wall (any multiple of 90° is the same), null without walls.
export function roomAxes(walls: Seg[]): P2 | null {
  let best: Seg | null = null;
  let bestLen = 0;
  for (const s of walls) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    if (len > bestLen) {
      best = s;
      bestLen = len;
    }
  }
  if (!best || bestLen < 0.5) return null;
  return [(best.b[0] - best.a[0]) / bestLen, (best.b[1] - best.a[1]) / bestLen];
}

// ---- rays ----

// First wall face hit by a ray in plan from `o` along `d`, among faces that cover some of the heights y0..y1.
function cast(o: P2, d: P2, segs: Seg[], y0: number, y1: number, skip: string): number | null {
  let best: number | null = null;
  for (const s of segs) {
    if (s.owner === skip || s.y1 <= y0 + 0.02 || s.y0 >= y1 - 0.02) continue;
    const rx = s.b[0] - s.a[0];
    const rz = s.b[1] - s.a[1];
    const den = d[0] * rz - d[1] * rx;
    if (Math.abs(den) < 1e-9) continue;
    const wx = s.a[0] - o[0];
    const wz = s.a[1] - o[1];
    const t = (wx * rz - wz * rx) / den;
    const k = (wx * d[1] - wz * d[0]) / den;
    if (t > 1e-4 && k >= 0 && k <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

// ---- what to show ----

// Width, depth and height of a solid, drawn along its bottom edges and one vertical edge.
export function dimsOfSolid(s: Solid): Measure[] {
  const v = perp(s.u);
  const at = (a: number, b: number, y: number): Vec3 => v3(s.c[0] + s.u[0] * a * s.hu + v[0] * b * s.hv, y, s.c[1] + s.u[1] * a * s.hu + v[1] * b * s.hv);
  return [
    { kind: 'dim', a: at(-1, -1, s.y0), b: at(1, -1, s.y0), text: formatLength(2 * s.hu), owner: s.id },
    { kind: 'dim', a: at(1, -1, s.y0), b: at(1, 1, s.y0), text: formatLength(2 * s.hv), owner: s.id },
    { kind: 'dim', a: at(-1, 1, s.y0), b: at(-1, 1, s.y1), text: formatLength(s.y1 - s.y0), owner: s.id },
  ];
}

// Length and height of a wall; edges and area of a floor.
export function dimsOfStructure(st: Structure): Measure[] {
  const s = effective(st);
  if (s.kind === 'wall') {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const dx = (s.b[0] - s.a[0]) / (len || 1);
    const dz = (s.b[1] - s.a[1]) / (len || 1);
    const off = s.align === 'left' ? s.thickness / 2 : s.align === 'right' ? -s.thickness / 2 : 0;
    const ox = (dz) * off;
    const oz = -dx * off;
    const top = s.y + s.height;
    return [
      { kind: 'dim', a: v3(s.a[0] + ox, top, s.a[1] + oz), b: v3(s.b[0] + ox, top, s.b[1] + oz), text: `${formatLength(len)} · sp. ${formatLength(s.thickness)}`, owner: s.id },
      { kind: 'dim', a: v3(s.a[0] + ox, s.y, s.a[1] + oz), b: v3(s.a[0] + ox, top, s.a[1] + oz), text: formatLength(s.height), owner: s.id },
    ];
  }
  const pts = floorPoints(s);
  const out: Measure[] = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return { kind: 'dim' as const, a: v3(p[0], s.y + s.thickness, p[1]), b: v3(q[0], s.y + s.thickness, q[1]), text: formatLength(Math.hypot(q[0] - p[0], q[1] - p[1])), owner: s.id };
  });
  const cx = pts.reduce((n, p) => n + p[0], 0) / pts.length;
  const cz = pts.reduce((n, p) => n + p[1], 0) / pts.length;
  out.push({ kind: 'label', a: v3(cx, s.y + s.thickness, cz), b: v3(cx, s.y + s.thickness, cz), text: formatArea(Math.abs(polygonArea(pts))), owner: s.id });
  return out;
}

// Free distances from a solid to the next wall face or object in four directions (along the room's own directions, else its
// own), and up to the ceiling / down to the floor.
export function gapsOfSolid(s: Solid, ctx: MeasureContext): Measure[] {
  const range = ctx.maxRange ?? MAX_RANGE;
  const e1: P2 = ctx.axes ?? s.u;
  const out: Measure[] = [];
  const corners = solidSegs(s).map((q) => q.a);
  const yMid = s.y0 + Math.min(0.9, (s.y1 - s.y0) / 2);
  for (const d of [e1, [-e1[0], -e1[1]] as P2, perp(e1), [-perp(e1)[0], -perp(e1)[1]] as P2]) {
    const p = perp(d);
    const pc = corners.map((q) => q[0] * p[0] + q[1] * p[1]);
    const pmin = Math.min(...pc);
    const pmax = Math.max(...pc);
    let best: { t: number; from: P2 } | null = null;
    // Rays across the side, and one from each corner: the nearest point of a turned object is a corner.
    const ts = [...pc, ...Array.from({ length: SAMPLES }, (_, k) => pmin + ((k + 0.5) / SAMPLES) * (pmax - pmin))];
    for (const t of ts) {
      // the far side of the solid in direction d, at this height across
      let dmax = -Infinity;
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        const pa = a[0] * p[0] + a[1] * p[1];
        const pb = b[0] * p[0] + b[1] * p[1];
        if ((pa - t) * (pb - t) > 0 || pa === pb) continue;
        const f = (t - pa) / (pb - pa);
        dmax = Math.max(dmax, (a[0] + (b[0] - a[0]) * f) * d[0] + (a[1] + (b[1] - a[1]) * f) * d[1]);
      }
      if (dmax === -Infinity) continue;
      const from: P2 = [d[0] * dmax + p[0] * t, d[1] * dmax + p[1] * t];
      const hit = cast(from, d, ctx.obstacles, s.y0, s.y1, s.id);
      if (hit !== null && (best === null || hit < best.t)) best = { t: hit, from };
    }
    if (best && best.t > 0.005 && best.t <= range) {
      out.push({ kind: 'gap', a: v3(best.from[0], yMid, best.from[1]), b: v3(best.from[0] + d[0] * best.t, yMid, best.from[1] + d[1] * best.t), text: formatLength(best.t), owner: s.id });
    }
  }
  if (ctx.ceilingY !== null) {
    const h = ctx.ceilingY - s.y1;
    if (h > 0.01 && h <= range) out.push({ kind: 'gap', a: v3(s.c[0], s.y1, s.c[1]), b: v3(s.c[0], ctx.ceilingY, s.c[1]), text: formatLength(h), owner: s.id });
  }
  if (s.y0 - ctx.floorY > 0.02) out.push({ kind: 'gap', a: v3(s.c[0], ctx.floorY, s.c[1]), b: v3(s.c[0], s.y0, s.c[1]), text: formatLength(s.y0 - ctx.floorY), owner: s.id });
  return out;
}
