import type { RoomPlane, Vec3 } from './types';

export interface Alignment {
  yaw: number; // radians, rotation in the xz plane (x' = c*x - s*z, z' = s*x + c*z)
  tx: number;
  ty: number;
  tz: number;
  resid: number; // mean distance of matched planes after alignment, metres
  matched: number;
  total: number;
}

const INLIER = 0.15; // m
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

// Each XR session has its own origin (position + yaw at session start, floor
// height estimate), so a saved room must be re-aligned to the live scan.
// Finds the yaw + translation mapping `from` plane centres onto `to` (ICP seeded
// with 24 yaw guesses, pairing planes with the same label, ignoring pairs that
// are too far apart so planes missing from one scan don't skew the fit).
// resid/matched count only inlier pairs (closer than INLIER). Null if no match.
export function alignPlanes(from: RoomPlane[], to: RoomPlane[]): Alignment | null {
  if (!from.length || !to.length) return null;
  let best: Alignment | null = null;
  let bestCost = Infinity;

  for (let deg = 0; deg < 360; deg += 15) {
    let th = (deg * Math.PI) / 180;
    const ca = [mean(from.map((p) => p.pos[0])), mean(from.map((p) => p.pos[2]))];
    const cb = [mean(to.map((p) => p.pos[0])), mean(to.map((p) => p.pos[2]))];
    let tx = cb[0] - (Math.cos(th) * ca[0] - Math.sin(th) * ca[1]);
    let tz = cb[1] - (Math.sin(th) * ca[0] + Math.cos(th) * ca[1]);
    let ty = 0;
    const apply = (p: Vec3): Vec3 => {
      const c = Math.cos(th);
      const s = Math.sin(th);
      return [c * p[0] - s * p[2] + tx, p[1] + ty, s * p[0] + c * p[2] + tz];
    };

    let pairs: [Vec3, Vec3][] = [];
    for (let it = 0; it < 12; it++) {
      const gate = Math.max(INLIER, 2 * 0.7 ** it); // tightens as the fit improves
      pairs = [];
      for (const p of from) {
        const t = apply(p.pos);
        let bestC: RoomPlane | null = null;
        let bestD = Infinity;
        for (const c of to) {
          const d = c.label === p.label ? dist(t, c.pos) : Infinity;
          if (d < bestD) {
            bestD = d;
            bestC = c;
          }
        }
        if (bestC && bestD < gate) pairs.push([p.pos, bestC.pos]);
      }
      if (pairs.length < 2) break;
      const ma = [mean(pairs.map((q) => q[0][0])), mean(pairs.map((q) => q[0][2]))];
      const mb = [mean(pairs.map((q) => q[1][0])), mean(pairs.map((q) => q[1][2]))];
      let cross = 0;
      let dot = 0;
      for (const [a, b] of pairs) {
        const ax = a[0] - ma[0];
        const az = a[2] - ma[1];
        const bx = b[0] - mb[0];
        const bz = b[2] - mb[1];
        cross += ax * bz - az * bx;
        dot += ax * bx + az * bz;
      }
      th = Math.atan2(cross, dot);
      tx = mb[0] - (Math.cos(th) * ma[0] - Math.sin(th) * ma[1]);
      tz = mb[1] - (Math.sin(th) * ma[0] + Math.cos(th) * ma[1]);
      ty = mean(pairs.map(([a, b]) => b[1] - a[1]));
    }
    // Truncated cost over all saved planes: unmatched ones count as 0.3 m.
    let cost = 0;
    const inliers: number[] = [];
    for (const p of from) {
      const t = apply(p.pos);
      let d = Infinity;
      for (const c of to) if (c.label === p.label) d = Math.min(d, dist(t, c.pos));
      cost += Math.min(d, 0.3);
      if (d < INLIER) inliers.push(d);
    }
    if (cost < bestCost && inliers.length >= 2) {
      bestCost = cost;
      best = { yaw: th, tx, ty, tz, resid: mean(inliers), matched: inliers.length, total: from.length };
    }
  }
  return best;
}
