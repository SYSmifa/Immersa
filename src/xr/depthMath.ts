import type { Vector3 } from 'three';

// Pure maths of the depth probe (see depthProbe.ts): flat things found in a cloud of points. Tested by docs/test-plans/depth.test.mts.

export interface Wall {
  nx: number;
  nz: number; // unit normal on the floor plane, pointing toward the head
  d: number; // n . p for points on the wall
  count: number;
  rms: number; // m
  span: number; // m along the wall
  lo: number; // extent along the wall, on the tangent (-nz, nx): from lo to hi (1st to 99th percentile)
  hi: number;
}

export const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
};
export const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
export const std = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
};
export const cm = (m: number, digits = 1) => `${m >= 0 ? '+' : ''}${(m * 100).toFixed(digits)}cm`;

// Height of the floor in a set of points: the 5 cm band (inside -0.5..0.5 m of the floor the headset assumes) holding the most points.
export function floorBand(P: Float32Array, n: number) {
  const bins = new Int32Array(100);
  for (let i = 0; i < n; i++) {
    const b = Math.floor((P[3 * i + 1] + 0.5) * 100);
    if (b >= 0 && b < 100) bins[b]++;
  }
  let best = 0;
  let at = 0;
  for (let b = 0; b + 5 <= 100; b++) {
    const c = bins[b] + bins[b + 1] + bins[b + 2] + bins[b + 3] + bins[b + 4];
    if (c > best) {
      best = c;
      at = b;
    }
  }
  const lo = (at - 50) / 100;
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const y = P[3 * i + 1];
    if (y >= lo && y < lo + 0.05) ys.push(y);
  }
  return { count: best, y: ys.length ? mean(ys) : NaN, sd: ys.length ? std(ys) : NaN };
}

// Total-least-squares line through (x, z) points: unit normal, offset, rms distance.
function fitLine(xs: number[], zs: number[]) {
  const n = xs.length;
  const mx = mean(xs);
  const mz = mean(zs);
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dz = zs[i] - mz;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
  }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz); // direction of the largest spread: along the wall
  const nx = -Math.sin(th);
  const nz = Math.cos(th);
  const d = nx * mx + nz * mz;
  let r = 0;
  for (let i = 0; i < n; i++) r += (nx * xs[i] + nz * zs[i] - d) ** 2;
  return { nx, nz, d, rms: Math.sqrt(r / n) };
}

// Vertical planes in the points between 0.25 m and 1.9 m of height: RANSAC on the floor projection, then a least-squares refit.
export function findWalls(P: Float32Array, n: number, head: Vector3): Wall[] {
  let xs: number[] = [];
  let zs: number[] = [];
  const stride = Math.max(1, Math.floor(n / 9000));
  for (let i = 0; i < n; i += stride) {
    const y = P[3 * i + 1];
    if (y > 0.25 && y < 1.9) {
      xs.push(P[3 * i]);
      zs.push(P[3 * i + 2]);
    }
  }
  const walls: Wall[] = [];
  for (let w = 0; w < 5 && xs.length > 500; w++) {
    let best: { nx: number; nz: number; d: number; c: number } | null = null;
    for (let it = 0; it < 200; it++) {
      const a = (Math.random() * xs.length) | 0;
      const b = (Math.random() * xs.length) | 0;
      const dx = xs[b] - xs[a];
      const dz = zs[b] - zs[a];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const nx = -dz / len;
      const nz = dx / len;
      const d = nx * xs[a] + nz * zs[a];
      let c = 0;
      for (let i = 0; i < xs.length; i++) if (Math.abs(nx * xs[i] + nz * zs[i] - d) < 0.03) c++;
      if (!best || c > best.c) best = { nx, nz, d, c };
    }
    if (!best || best.c < 400) break;
    let line = { nx: best.nx, nz: best.nz, d: best.d, rms: 0 };
    let ix: number[] = [];
    let iz: number[] = [];
    for (let pass = 0; pass < 3; pass++) {
      ix = [];
      iz = [];
      for (let i = 0; i < xs.length; i++) {
        if (Math.abs(line.nx * xs[i] + line.nz * zs[i] - line.d) < 0.03) {
          ix.push(xs[i]);
          iz.push(zs[i]);
        }
      }
      if (ix.length < 50) break;
      line = fitLine(ix, iz);
    }
    if (ix.length < 400) break;
    // the normal points toward the head
    let { nx, nz, d } = line;
    if (nx * head.x + nz * head.z - d < 0) {
      nx = -nx;
      nz = -nz;
      d = -d;
    }
    // extent along the wall, on the final tangent (-nz, nx)
    const ts = ix.map((x, i) => -nz * x + nx * iz[i]).sort((a, b) => a - b);
    const lo = ts[Math.floor(ts.length * 0.01)];
    const hi = ts[Math.floor(ts.length * 0.99)];
    if (hi - lo >= 0.8) walls.push({ nx, nz, d, count: ix.length, rms: line.rms, span: hi - lo, lo, hi });
    // remove the inliers and look for the next wall
    const keepX: number[] = [];
    const keepZ: number[] = [];
    for (let i = 0; i < xs.length; i++) {
      if (Math.abs(line.nx * xs[i] + line.nz * zs[i] - line.d) >= 0.05) {
        keepX.push(xs[i]);
        keepZ.push(zs[i]);
      }
    }
    xs = keepX;
    zs = keepZ;
  }
  return walls;
}


// Extent of the floor points (within 3 cm of height y) along a wall's tangent and normal, from the 1st to the 99th percentile:
// the rectangle the floor quad is drawn in. null with too few points.
export function floorExtent(P: Float32Array, n: number, y: number, nx: number, nz: number) {
  const ts: number[] = [];
  const ns: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(P[3 * i + 1] - y) > 0.03) continue;
    ts.push(-nz * P[3 * i] + nx * P[3 * i + 2]);
    ns.push(nx * P[3 * i] + nz * P[3 * i + 2]);
  }
  if (ts.length < 300) return null;
  ts.sort((a, b) => a - b);
  ns.sort((a, b) => a - b);
  const q = (v: number[], f: number) => v[Math.floor(v.length * f)];
  return { t0: q(ts, 0.01), t1: q(ts, 0.99), n0: q(ns, 0.01), n1: q(ns, 0.99) };
}
