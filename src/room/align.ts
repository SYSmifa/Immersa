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

// First pass, rough: plane centres. A plane's centre depends on how far its outline reaches,
// which changes between scans, so this is only good to a few tens of centimetres.
// Each XR session has its own origin (position + yaw at session start, floor
// height estimate), so a saved room must be re-aligned to the live scan.
// Finds the yaw + translation mapping `from` plane centres onto `to` (ICP seeded
// with 24 yaw guesses, pairing planes with the same label, ignoring pairs that
// are too far apart so planes missing from one scan don't skew the fit).
// resid/matched count only inlier pairs (closer than INLIER). Null if no match.
function alignByCentres(from: RoomPlane[], to: RoomPlane[]): Alignment[] {
  if (!from.length || !to.length) return [];
  const found: { a: Alignment; cost: number }[] = [];

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
    if (inliers.length >= 1) found.push({ a: { yaw: th, tx, ty, tz, resid: mean(inliers), matched: inliers.length, total: from.length }, cost });
  }
  return found.sort((x, y) => x.cost - y.cost).map((c) => c.a);
}

// Walls, floor, ceiling, doors and windows stay put; furniture gets moved and re-classified.
const STRUCTURE = new Set(['floor', 'ceiling', 'wall', 'door', 'window', 'wall face', 'invisible wall']);
const structural = (planes: RoomPlane[]) => {
  const s = planes.filter((p) => STRUCTURE.has(p.label));
  return s.length >= 4 ? s : planes;
};

// Unit normal of a plane: its local Y axis rotated by the plane's orientation.
export function planeNormal(q: [number, number, number, number]): Vec3 {
  const [x, y, z, w] = q;
  return [2 * x * y - 2 * w * z, 1 - 2 * (z * z + x * x), 2 * w * x + 2 * y * z];
}

const MATCHED = 0.05; // m: a plane counts as found when it lies within this of its partner

// Second pass, precise: align the planes themselves, not their centres. For each saved plane
// matched to a live plane with the same label and orientation, the error is the distance of the
// saved plane from the live one measured along the live normal, which does not depend on how far
// either outline reaches. Gauss-Newton on yaw and translation.
function refine(from: RoomPlane[], to: RoomPlane[], start: Alignment): Alignment {
  const fromQ = from.filter((p) => p.quat);
  const toQ = to.filter((p) => p.quat);
  if (fromQ.length < 3 || toQ.length < 3) return start;
  let { yaw, tx, ty, tz } = start;
  let pairs = 0;
  for (let it = 0; it < 8; it++) {
    const gate = Math.max(0.1, 1.5 * 0.6 ** it);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const A = Array.from({ length: 4 }, () => new Array<number>(4).fill(0));
    const b = [0, 0, 0, 0];
    pairs = 0;
    for (const p of fromQ) {
      const rx = c * p.pos[0] - s * p.pos[2];
      const rz = s * p.pos[0] + c * p.pos[2];
      const P: Vec3 = [rx + tx, p.pos[1] + ty, rz + tz];
      const n0 = planeNormal(p.quat!);
      const n: Vec3 = [c * n0[0] - s * n0[2], n0[1], s * n0[0] + c * n0[2]];
      let best: { m: Vec3; r: number } | null = null;
      for (const q of toQ) {
        if (q.label !== p.label) continue;
        const m = planeNormal(q.quat!);
        if (Math.abs(n[0] * m[0] + n[1] * m[1] + n[2] * m[2]) < 0.9) continue; // not the same orientation
        const r = m[0] * (P[0] - q.pos[0]) + m[1] * (P[1] - q.pos[1]) + m[2] * (P[2] - q.pos[2]);
        if (Math.abs(r) < gate && (!best || Math.abs(r) < Math.abs(best.r))) best = { m, r };
      }
      if (!best) continue;
      pairs++;
      const g = [-best.m[0] * rz + best.m[2] * rx, best.m[0], best.m[1], best.m[2]]; // d(error) / d(yaw, tx, ty, tz)
      for (let i = 0; i < 4; i++) {
        b[i] -= best.r * g[i];
        for (let j = 0; j < 4; j++) A[i][j] += g[i] * g[j];
      }
    }
    if (pairs < 3) break;
    for (let i = 0; i < 4; i++) A[i][i] += 1e-6; // a direction no plane constrains stays put
    const d = solve4(A, b);
    if (!d) break;
    yaw += d[0];
    tx += d[1];
    ty += d[2];
    tz += d[3];
    if (Math.hypot(d[1], d[2], d[3]) < 1e-4 && Math.abs(d[0]) < 1e-5) break;
  }

  // Score: how many saved planes now lie on a live plane, and how far off they are.
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const errors: number[] = [];
  for (const p of fromQ) {
    const P: Vec3 = [c * p.pos[0] - s * p.pos[2] + tx, p.pos[1] + ty, s * p.pos[0] + c * p.pos[2] + tz];
    const n0 = planeNormal(p.quat!);
    const n: Vec3 = [c * n0[0] - s * n0[2], n0[1], s * n0[0] + c * n0[2]];
    let e = Infinity;
    for (const q of toQ) {
      if (q.label !== p.label) continue;
      const m = planeNormal(q.quat!);
      if (Math.abs(n[0] * m[0] + n[1] * m[1] + n[2] * m[2]) < 0.9) continue;
      e = Math.min(e, Math.abs(m[0] * (P[0] - q.pos[0]) + m[1] * (P[1] - q.pos[1]) + m[2] * (P[2] - q.pos[2])));
    }
    if (e < MATCHED) errors.push(e);
  }
  if (!errors.length) return start;
  return { yaw, tx, ty, tz, resid: mean(errors), matched: errors.length, total: from.length };
}

// Gaussian elimination for a 4x4 system; null if singular.
function solve4(A: number[][], b: number[]): number[] | null {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < 4; i++) {
    let piv = i;
    for (let r = i + 1; r < 4; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    if (Math.abs(M[piv][i]) < 1e-12) return null;
    [M[i], M[piv]] = [M[piv], M[i]];
    for (let r = i + 1; r < 4; r++) {
      const f = M[r][i] / M[i][i];
      for (let k = i; k < 5; k++) M[r][k] -= f * M[i][k];
    }
  }
  const x = [0, 0, 0, 0];
  for (let i = 3; i >= 0; i--) {
    let sum = M[i][4];
    for (let k = i + 1; k < 4; k++) sum -= M[i][k] * x[k];
    x[i] = sum / M[i][i];
  }
  return x;
}

// Which saved planes are the live ones, and how is the saved room placed? Structural planes only:
// rough fit on the centres, then precise on the planes (needs orientations; scans saved before
// they were stored fall back to the rough fit). Null if nothing matches.
export function alignPlanes(from: RoomPlane[], to: RoomPlane[]): Alignment | null {
  const f = structural(from);
  const t = structural(to);
  const seeds = alignByCentres(f, t);
  if (!seeds.length) return null;
  // A box-shaped room looks the same turned by 180 degrees, so the best centre fit can be the
  // wrong way round: refine the best few and keep the one in which the most planes are found
  // (doors and windows tell the two ways apart).
  let best: Alignment | null = null;
  let bestScore = -Infinity;
  for (const seed of seeds.slice(0, 8)) {
    const fine = { ...refine(f, t, { ...seed, total: f.length }), total: f.length };
    const score = fine.matched - fine.resid * 5;
    if (score > bestScore) {
      bestScore = score;
      best = fine;
    }
  }
  return best;
}
