import { Quaternion, Vector3 } from 'three';
import { planeNormal, type Alignment } from './align';
import type { RoomPlane, Vec3 } from './types';

// Manual alignment of a saved room with two touched points (no Meta planes needed): the saved room suggests two of its own
// corners (the vertical edges where two walls meet), the user touches those two corners in the real room, and the room is put
// where the two touches say. Corners are points in the room's own frame; only their position on the floor matters (the user
// touches the edge at any height).

export interface PlanSeg {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  kind: 'wall' | 'door' | 'window';
}

export interface CornerPlan {
  a: Vec3; // the two suggested corners, on the floor
  b: Vec3;
  segs: PlanSeg[]; // walls, doors and windows seen from above, to draw the plan
  floorY: number;
}

interface Line {
  nx: number;
  nz: number;
  d: number; // n . p for points on the wall
  t0: number; // extent along the tangent (-nz, nx)
  t1: number;
  kind: PlanSeg['kind'];
  minY: number;
}

const KIND: Record<string, PlanSeg['kind'] | undefined> = { wall: 'wall', door: 'door', window: 'window' };
const MARGIN = 0.5; // m: a corner may lie this far beyond the end of a wall (scans leave gaps at the corners)
const MIN_SPAN = 1.5; // m: the two corners must be at least this far apart to give a good rotation

// A plane's outline in the room's frame (the plan polygon, or just its centre if it has none).
function outline(p: RoomPlane): Vector3[] {
  const centre = new Vector3(...p.pos);
  if (!p.quat || !p.poly || p.poly.length < 6) return [centre];
  const q = new Quaternion(...p.quat);
  const out: Vector3[] = [];
  for (let i = 0; i < p.poly.length; i += 2) out.push(new Vector3(p.poly[i], 0, p.poly[i + 1]).applyQuaternion(q).add(centre));
  return out;
}

function lines(planes: RoomPlane[]): Line[] {
  const out: Line[] = [];
  for (const p of planes) {
    const kind = KIND[p.label];
    if (!kind || !p.quat) continue;
    const n = planeNormal(p.quat);
    const h = Math.hypot(n[0], n[2]);
    if (h < 0.7) continue; // not a vertical plane
    const nx = n[0] / h;
    const nz = n[2] / h;
    const pts = outline(p);
    const d = nx * p.pos[0] + nz * p.pos[2];
    let t0 = Infinity;
    let t1 = -Infinity;
    let minY = Infinity;
    for (const v of pts) {
      const t = -nz * v.x + nx * v.z;
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
      minY = Math.min(minY, v.y);
    }
    if (t1 - t0 < 0.2) continue;
    out.push({ nx, nz, d, t0, t1, kind, minY });
  }
  return out;
}

// The floor height of the saved scan: the floor plane, else the lowest edge of the walls.
export function floorHeight(planes: RoomPlane[]): number {
  const floors = planes.filter((p) => p.label === 'floor');
  if (floors.length) return floors.reduce((s, p) => s + p.pos[1], 0) / floors.length;
  const ys = lines(planes).filter((l) => l.kind === 'wall').map((l) => l.minY);
  return ys.length ? Math.min(...ys) : 0;
}

// Two corners of the room far from each other, and the plan to show them on. null when the scan has no usable walls.
const memo = new WeakMap<RoomPlane[], CornerPlan | null>();
export function suggestCorners(planes: RoomPlane[]): CornerPlan | null {
  if (memo.has(planes)) return memo.get(planes)!;
  const r = compute(planes);
  memo.set(planes, r);
  return r;
}

function compute(planes: RoomPlane[]): CornerPlan | null {
  const all = lines(planes);
  const walls = all.filter((l) => l.kind === 'wall');
  if (walls.length < 2) return null;
  const floorY = floorHeight(planes);
  const corners: [number, number][] = [];
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i];
      const b = walls[j];
      const det = a.nx * b.nz - a.nz * b.nx;
      if (Math.abs(det) < 0.7) continue; // nearly parallel: no corner (at least 45 degrees apart)
      const x = (a.d * b.nz - a.nz * b.d) / det;
      const z = (a.nx * b.d - a.d * b.nx) / det;
      const ta = -a.nz * x + a.nx * z;
      const tb = -b.nz * x + b.nx * z;
      if (ta < a.t0 - MARGIN || ta > a.t1 + MARGIN || tb < b.t0 - MARGIN || tb > b.t1 + MARGIN) continue; // not where both walls are
      if (corners.some((c) => Math.hypot(c[0] - x, c[1] - z) < 0.3)) continue;
      corners.push([x, z]);
    }
  }
  if (corners.length < 2) return null;
  let best: [number, number] | null = null;
  let bestD = 0;
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const d = Math.hypot(corners[i][0] - corners[j][0], corners[i][1] - corners[j][1]);
      if (d > bestD) {
        bestD = d;
        best = [i, j];
      }
    }
  }
  if (!best || bestD < MIN_SPAN) return null;
  const [ca, cb] = [corners[best[0]], corners[best[1]]];
  const segs: PlanSeg[] = all.map((l) => ({
    x1: l.nx * l.d + -l.nz * l.t0,
    z1: l.nz * l.d + l.nx * l.t0,
    x2: l.nx * l.d + -l.nz * l.t1,
    z2: l.nz * l.d + l.nx * l.t1,
    kind: l.kind,
  }));
  return { a: [ca[0], floorY, ca[1]], b: [cb[0], floorY, cb[1]], segs, floorY };
}

export interface TouchResult {
  alignment: Alignment;
  expected: number; // distance between the two corners in the saved room, m
  measured: number; // distance between the two touches, m
  ok: boolean; // the two distances agree: the right corners were touched
}

// Where the saved room goes, given its two corners (`a`, `b`, room frame) and the two touched points (`ta`, `tb`, session frame).
// Same convention as align.ts: x' = c x - s z + tx, z' = s x + c z + tz, y' = y + ty. `floorLive`: the real floor's height in the
// session (null: keep the saved floor height, the caller does not know it).
export function alignFromTouches(a: Vec3, b: Vec3, ta: Vec3, tb: Vec3, floorLive: number | null): TouchResult {
  const vx = b[0] - a[0];
  const vz = b[2] - a[2];
  const wx = tb[0] - ta[0];
  const wz = tb[2] - ta[2];
  const yaw = Math.atan2(vx * wz - vz * wx, vx * wx + vz * wz);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // the two corners land on the touches as well as they can: the midpoints coincide
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[2] + b[2]) / 2;
  const tx = (ta[0] + tb[0]) / 2 - (c * mx - s * mz);
  const tz = (ta[2] + tb[2]) / 2 - (s * mx + c * mz);
  const expected = Math.hypot(vx, vz);
  const measured = Math.hypot(wx, wz);
  const err = Math.abs(measured - expected);
  const ty = floorLive === null ? 0 : floorLive - a[1];
  return {
    alignment: { yaw, tx, ty, tz, resid: err / 2, matched: 2, total: 2 },
    expected,
    measured,
    ok: err <= Math.max(0.15, 0.06 * expected),
  };
}
