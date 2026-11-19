import { modelSolid, type P2, type Seg, type Solid } from './measure';
import { floorPoints } from './structures';
import type { RoomModel, Structure, Vec3 } from './types';

// Zone di rispetto: the free space asked around something, that nothing else may enter.
// - of a model: a rectangle in plan, `f` / `b` / `l` / `r` metres beyond the model's box at its front (+Z of the file), back (-Z),
//   left (-X) and right (+X), as high as the model; it turns and moves with the model;
// - free: a floor of the project marked `zone` (a corridor, an exit...): any polygon, from the floor up to ZONE_HEIGHT.
// Another model that touches a zone invades it. A zone that touches a wall or leaves the room is reported too.
// Everything is in the room's frame.

export type Zone = NonNullable<RoomModel['zone']>;
export const DEFAULT_ZONE_M = 1;
export const FREE_ZONE_HEIGHT = 2.2; // a free zone is "free" up to this height above its floor
export const uniformZone = (m: number): Zone => ({ f: m, b: m, l: m, r: m });

// The zone of a model as a solid (like the model's own), from the model's box `lo`/`hi` in its own frame at scale 1.
export function zoneSolid(m: RoomModel, lo: Vec3, hi: Vec3): Solid | null {
  const z = m.zone;
  if (!z) return null;
  const k = 1 / Math.max(1e-6, m.scale); // margins are in metres, the box is at scale 1
  return modelSolid({ ...m, id: `zone:${m.id}`, name: m.name }, [lo[0] - z.l * k, lo[1], lo[2] - z.b * k], [hi[0] + z.r * k, hi[1], hi[2] + z.f * k]);
}

const EPS = 1e-4;
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];

// The four corners of a solid in plan.
export function solidPoly(s: Solid): P2[] {
  const v: P2 = [-s.u[1], s.u[0]];
  const p = (a: number, b: number): P2 => [s.c[0] + s.u[0] * a * s.hu + v[0] * b * s.hv, s.c[1] + s.u[1] * a * s.hu + v[1] * b * s.hv];
  return [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
}

// Do two solids overlap (in plan, as oriented rectangles, and in height)? Touching is not overlapping.
export function solidsOverlap(a: Solid, b: Solid): boolean {
  if (a.y1 <= b.y0 + EPS || b.y1 <= a.y0 + EPS) return false;
  const va: P2 = [-a.u[1], a.u[0]];
  const vb: P2 = [-b.u[1], b.u[0]];
  const d: P2 = [b.c[0] - a.c[0], b.c[1] - a.c[1]];
  for (const axis of [a.u, va, b.u, vb]) {
    const ra = a.hu * Math.abs(dot(a.u, axis)) + a.hv * Math.abs(dot(va, axis));
    const rb = b.hu * Math.abs(dot(b.u, axis)) + b.hv * Math.abs(dot(vb, axis));
    if (Math.abs(dot(d, axis)) >= ra + rb - EPS) return false;
  }
  return true;
}

// ---- polygons in plan ----
function inside(p: P2, poly: P2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
// Do the segments a-b and c-d cross properly (not just touch)?
function segsCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}
// Do two polygons (any shape) share area? Touching along an edge is not sharing.
export function polysOverlap(a: P2[], b: P2[]): boolean {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (segsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  // no crossing: one is inside the other (test a point of each, nudged towards the centre so that a shared edge does not count)
  const mid = (p: P2[]): P2 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  const toward = (q: P2, c: P2): P2 => [q[0] + (c[0] - q[0]) * 0.01, q[1] + (c[1] - q[1]) * 0.01];
  const ca = mid(a);
  const cb = mid(b);
  return a.some((q) => inside(toward(q, ca), b) && inside(toward(q, cb), b)) || b.some((q) => inside(toward(q, cb), a) && inside(toward(q, ca), a)) || inside(ca, b) || inside(cb, a);
}
// Does a wall face (a segment with heights) cut or lie inside a zone?
function segTouchesPoly(s: Seg, y0: number, y1: number, poly: P2[]): boolean {
  if (s.y1 <= y0 + EPS || s.y0 >= y1 - EPS) return false;
  for (let j = 0; j < poly.length; j++) if (segsCross(s.a, s.b, poly[j], poly[(j + 1) % poly.length])) return true;
  return inside(s.a, poly) && inside(s.b, poly);
}

export interface ZoneState {
  id: string; // the model, or the floor, that owns the zone
  name: string;
  free: boolean; // a free zone (a floor of the project), not a model's
  poly: P2[]; // the zone in plan
  y0: number;
  y1: number;
  invaders: string[]; // names of the models that are inside it
  walls: boolean; // it cuts a wall (it leaves the room, or goes through a built wall)
}

export interface ZoneInput {
  models: RoomModel[];
  structures: Structure[]; // of the same room; the floors with `zone` are free zones
  boxOf: (m: RoomModel) => { min: Vec3; max: Vec3 } | null; // a model's box (null while it loads)
  walls?: Seg[]; // wall faces of the room (the scan's and the built ones)
}

// Every zone (models' and free ones) with who is inside it. Only models of the same room are compared.
export function zoneStates({ models, structures, boxOf, walls = [] }: ZoneInput): ZoneState[] {
  const solids = new Map<string, Solid>();
  for (const m of models) {
    const b = boxOf(m);
    if (b) solids.set(m.id, modelSolid(m, b.min, b.max));
  }
  const out: ZoneState[] = [];
  const add = (id: string, name: string, free: boolean, poly: P2[], y0: number, y1: number, roomId: string, exceptModel?: string) => {
    const invaders = models
      .filter((o) => o.id !== exceptModel && o.roomId === roomId && solids.has(o.id))
      .filter((o) => {
        const s = solids.get(o.id)!;
        return s.y1 > y0 + EPS && s.y0 < y1 - EPS && polysOverlap(poly, solidPoly(s));
      })
      .map((o) => o.name);
    out.push({ id, name, free, poly, y0, y1, invaders, walls: walls.some((w) => w.owner !== exceptModel && segTouchesPoly(w, y0, y1, poly)) });
  };
  for (const m of models) {
    const b = m.zone ? boxOf(m) : null;
    const zs = b ? zoneSolid(m, b.min, b.max) : null;
    if (zs) add(m.id, m.name, false, solidPoly(zs), zs.y0, zs.y1, m.roomId, m.id);
  }
  structures.filter((s) => s.kind === 'floor' && s.zone).forEach((s, i) => add(s.id, `Zona ${i + 1}`, true, floorPoints(s), s.y, s.y + FREE_ZONE_HEIGHT, s.roomId));
  return out;
}

// "Banco invade la zona di Pressa" / "la zona di Pressa tocca un muro", for the lists.
export const invasionTexts = (states: ZoneState[]): string[] =>
  states.flatMap((z) => {
    const what = z.free ? z.name : `la zona di ${z.name}`; // "Zona 1" / "la zona di Pressa"
    return [...z.invaders.map((n) => `${n} invade ${what}`), ...(z.walls ? [`${z.free ? z.name : what} tocca un muro`.replace(/^l/, 'L')] : [])];
  });
