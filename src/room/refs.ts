import type { Alignment } from './align';
import type { RoomRef, Vec3 } from './types';

// Reference points of a big space: 3-4 spots the user marks on the floor (room frame, the scan's). Every session the user touches
// them again and the room is aligned on them, so a hangar whose Meta walls are only approximate still lands right.
export const MIN_REFS = 3;
export const MAX_REFS = 4;
export const MIN_REF_GAP = 3; // m between two points: closer ones make the rotation unstable
export const REF_TOLERANCE = 0.15; // m (or 6%): how far a touched distance may differ from the saved one

export const refName = (r: RoomRef, i: number) => r.name?.trim() || `Punto ${i + 1}`;

// Can a point at `p` be added to `have`? The nearest point decides; null = fine, else the message to show.
export function refProblem(p: Vec3, have: Vec3[]): string | null {
  let near = Infinity;
  for (const h of have) near = Math.min(near, Math.hypot(p[0] - h[0], p[2] - h[2]));
  if (near < MIN_REF_GAP) return `Troppo vicino a un altro punto (${near.toFixed(1)} m): servono almeno ${MIN_REF_GAP} m`;
  return null;
}

export interface RefsFit {
  alignment: Alignment;
  worst: number; // m: the biggest gap between a touched distance and the saved one
  ok: boolean;
}

// Where the saved room goes, given its points (`saved`, room frame) and the touched ones (`touched`, session frame), in the same
// order. Least squares rotation + translation on the floor plane (2D Procrustes, no scale), same convention as align.ts:
// x' = c x - s z + tx, z' = s x + c z + tz. `floorLive`: the floor height of the session (null = keep the saved one).
export function alignFromRefs(saved: Vec3[], touched: Vec3[], floorLive: number | null): RefsFit {
  const n = Math.min(saved.length, touched.length);
  const mean = (a: Vec3[], i: number) => a.slice(0, n).reduce((s, p) => s + p[i], 0) / n;
  const sx = mean(saved, 0), sz = mean(saved, 2), tx0 = mean(touched, 0), tz0 = mean(touched, 2);
  let dot = 0;
  let cross = 0;
  for (let i = 0; i < n; i++) {
    const ax = saved[i][0] - sx, az = saved[i][2] - sz;
    const bx = touched[i][0] - tx0, bz = touched[i][2] - tz0;
    dot += ax * bx + az * bz;
    cross += ax * bz - az * bx;
  }
  const yaw = Math.atan2(cross, dot);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const tx = tx0 - (c * sx - s * sz);
  const tz = tz0 - (s * sx + c * sz);
  let worst = 0;
  let resid = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const e = Math.hypot(saved[i][0] - saved[j][0], saved[i][2] - saved[j][2]);
      const m = Math.hypot(touched[i][0] - touched[j][0], touched[i][2] - touched[j][2]);
      worst = Math.max(worst, Math.abs(m - e));
    }
    const px = c * saved[i][0] - s * saved[i][2] + tx - touched[i][0];
    const pz = s * saved[i][0] + c * saved[i][2] + tz - touched[i][2];
    resid += px * px + pz * pz;
  }
  const floorSaved = saved.reduce((a, p) => a + p[1], 0) / Math.max(1, saved.length);
  const ty = floorLive === null ? 0 : floorLive - floorSaved;
  const longest = Math.max(...saved.slice(0, n).flatMap((a, i) => saved.slice(i + 1, n).map((b) => Math.hypot(a[0] - b[0], a[2] - b[2]))), 1);
  return {
    alignment: { yaw, tx, ty, tz, resid: Math.sqrt(resid / n), matched: n, total: n },
    worst,
    ok: worst <= Math.max(REF_TOLERANCE, 0.06 * longest),
  };
}
