// Pure maths of the depth correction: from depth points of the real room and the wall lines of our own (saved) room, as it is
// placed now, how far is each wall from where the depth says it is, and which small move (a shift and a turn in the floor plane)
// of the room brings them together. No three.js here: plain numbers, so it is tested in Node (docs/test-plans/depthfit.test.mts).
//
// Conventions: a point is [x, y, z] in the session's world; the floor plane is (x, z). A wall line is n . p = d with n a unit
// normal in (x, z). A turn is `theta` radians in the sense of three's rotation about Y seen from above: R(theta) maps (x, z) to
// (x cos - z sin, x sin + z cos).

export type P3 = [number, number, number];
export type P2 = [number, number];

export interface WallLine {
  id: string;
  n: P2; // unit normal
  d: number; // n . p = d on the wall
  t: P2; // unit direction along the wall (n turned a quarter)
  t0: number; // extent along t (t . p)
  t1: number;
  y0: number; // height range of the wall
  y1: number;
}

// How the room is moved to follow what the depth sees: p' = R(theta) p + shift (in the world).
export interface Fix {
  theta: number;
  tx: number;
  tz: number;
}
export const NO_FIX: Fix = { theta: 0, tx: 0, tz: 0 };

export const apply = (f: Fix, p: P2): P2 => [Math.cos(f.theta) * p[0] - Math.sin(f.theta) * p[1] + f.tx, Math.sin(f.theta) * p[0] + Math.cos(f.theta) * p[1] + f.tz];

// The move `step` (about the pivot c) done after `old`: step(old(p)).
export function compose(step: { theta: number; vx: number; vz: number; c: P2 }, old: Fix): Fix {
  const cs = Math.cos(step.theta);
  const sn = Math.sin(step.theta);
  // step(p) = R(d)(p - c) + c + v = R(d) p + (c - R(d) c + v)
  const sx = step.c[0] - (cs * step.c[0] - sn * step.c[1]) + step.vx;
  const sz = step.c[1] - (sn * step.c[0] + cs * step.c[1]) + step.vz;
  return { theta: old.theta + step.theta, tx: cs * old.tx - sn * old.tz + sx, tz: sn * old.tx + cs * old.tz + sz };
}

export interface WallReading {
  id: string;
  r: number; // median signed distance (m) of the depth points to the wall line: the depth minus our wall, along n
  n: number; // how many points
  q: P2; // the mean position of those points along the wall (a point of the wall line)
  spread: number; // how far apart along the wall the points are (m)
  slope: number; // how the distance changes along the wall (m per m): a turn of the room tilts the wall's readings
  noise: number; // median absolute deviation of the distances (m)
}

export interface FitOptions {
  gate: number; // a point counts for a wall when it is within this distance of it (m)
  margin: number; // stay this far from the ends of a wall (m)
  minPoints: number; // points a wall needs
  minSpread: number; // and how far apart along it they must be (m)
  low: number; // ignore depth points closer than this to the floor / the top of the wall (m)
}
export const FIT: FitOptions = { gate: 0.12, margin: 0.15, minPoints: 12, minSpread: 0.5, low: 0.3 };

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

// Each wall's reading, from the depth points near it. A point is given to the wall it is nearest to (the walls of a room do not
// come within `gate` of each other except in the corners, where it does not matter much).
export function readWalls(points: P3[], walls: WallLine[], o: FitOptions = FIT): WallReading[] {
  const got = new Map<string, { dist: number[]; t: number[] }>();
  for (const p of points) {
    let best: WallLine | null = null;
    let bestD = o.gate;
    let bestT = 0;
    for (const w of walls) {
      if (p[1] < w.y0 + o.low || p[1] > w.y1 - o.low) continue; // floor, furniture tops, ceiling edges
      const t = w.t[0] * p[0] + w.t[1] * p[2];
      if (t < w.t0 + o.margin || t > w.t1 - o.margin) continue;
      const dist = Math.abs(w.n[0] * p[0] + w.n[1] * p[2] - w.d);
      if (dist < bestD) {
        bestD = dist;
        best = w;
        bestT = t;
      }
    }
    if (!best) continue;
    const e = got.get(best.id) ?? { dist: [], t: [] };
    e.dist.push(best.n[0] * p[0] + best.n[1] * p[2] - best.d);
    e.t.push(bestT);
    got.set(best.id, e);
  }
  const out: WallReading[] = [];
  for (const w of walls) {
    const e = got.get(w.id);
    if (!e || e.dist.length < o.minPoints) continue;
    const spread = Math.max(...e.t) - Math.min(...e.t);
    if (spread < o.minSpread) continue;
    const r = median(e.dist);
    const tm = median(e.t);
    const tMean = e.t.reduce((a, b) => a + b, 0) / e.t.length;
    const dMean = e.dist.reduce((a, b) => a + b, 0) / e.dist.length;
    let sxy = 0;
    let sxx = 0;
    e.t.forEach((t, i) => {
      sxy += (t - tMean) * (e.dist[i] - dMean);
      sxx += (t - tMean) ** 2;
    });
    out.push({ id: w.id, r, n: e.dist.length, q: [w.n[0] * w.d + w.t[0] * tm, w.n[1] * w.d + w.t[1] * tm], spread, slope: sxx > 1e-9 ? sxy / sxx : 0, noise: median(e.dist.map((d) => Math.abs(d - r))) });
  }
  return out;
}

export interface Solved {
  vx: number;
  vz: number;
  theta: number;
  c: P2; // the pivot of the turn
  walls: number;
  rms: number; // what is left of the readings after the move (m)
}

// The small move (shift v and turn theta about c) that brings our walls to the depth's. For each wall two readings:
//   its offset:  n . v + theta * n . perp(q - c) = r        (perp(u) = (-u_z, u_x))
//   its slope:   sigma * theta = slope                      (sigma = n . perp(t) = +-1: a turn tilts the wall's readings)
// Each with its own uncertainty (a systematic centimetre, and the noise of the points over their number and spread). A prior
// keeps what no reading fixes at zero: with one wall only the shift along it is found; the offsets alone cannot see a turn about
// the middle of the walls, the slopes can.
export function solveMove(reads: WallReading[], walls: WallLine[], priorShift = 0.5, priorTurn = 0.035): Solved | null {
  const rs = reads.map((r) => ({ r, w: walls.find((x) => x.id === r.id)! })).filter((x) => x.w);
  if (!rs.length) return null;
  const c: P2 = [rs.reduce((a, x) => a + x.r.q[0], 0) / rs.length, rs.reduce((a, x) => a + x.r.q[1], 0) / rs.length];
  const M = [
    [1 / priorShift ** 2, 0, 0],
    [0, 1 / priorShift ** 2, 0],
    [0, 0, 1 / priorTurn ** 2],
  ];
  const b = [0, 0, 0];
  const add = (row: number[], value: number, sd: number) => {
    const k = 1 / (sd * sd);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) M[i][j] += k * row[i] * row[j];
      b[i] += k * row[i] * value;
    }
  };
  const eqs: { row: number[]; value: number }[] = [];
  for (const { r, w } of rs) {
    const u: P2 = [r.q[0] - c[0], r.q[1] - c[1]];
    const nEff = Math.min(r.n, 50);
    const sdR = Math.hypot(0.008, r.noise / Math.sqrt(nEff));
    const rowR = [w.n[0], w.n[1], w.n[0] * -u[1] + w.n[1] * u[0]];
    add(rowR, r.r, sdR);
    eqs.push({ row: rowR, value: r.r });
    const sigma = w.n[0] * -w.t[1] + w.n[1] * w.t[0];
    const sdS = Math.hypot(0.003, r.noise / (Math.max(r.spread, 0.3) * Math.sqrt(nEff / 12)));
    const rowS = [0, 0, sigma];
    add(rowS, r.slope, sdS);
    eqs.push({ row: rowS, value: r.slope });
  }
  const x = solve3(M, b);
  if (!x) return null;
  let sq = 0;
  for (const e of eqs) sq += (e.value - (e.row[0] * x[0] + e.row[1] * x[1] + e.row[2] * x[2])) ** 2;
  return { vx: x[0], vz: x[1], theta: x[2], c, walls: rs.length, rms: Math.sqrt(sq / eqs.length) };
}

function solve3(m: number[][], b: number[]): number[] | null {
  const a = m.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(a[j][i]) > Math.abs(a[p][i])) p = j;
    if (Math.abs(a[p][i]) < 1e-12) return null;
    [a[i], a[p]] = [a[p], a[i]];
    for (let j = i + 1; j < 3; j++) {
      const f = a[j][i] / a[i][i];
      for (let k = i; k < 4; k++) a[j][k] -= f * a[i][k];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = a[i][3];
    for (let j = i + 1; j < 3; j++) s -= a[i][j] * x[j];
    x[i] = s / a[i][i];
  }
  return x;
}

export interface Limits {
  gain: number; // the part of the found move applied at each check (0..1)
  stepShift: number; // m, the most it moves at one check
  stepTurn: number; // radians
  maxShift: number; // m, the most the correction may move the room, in all, from where the headset put it
  maxTurn: number; // radians
  quiet: number; // m: smaller moves are not applied (no jitter)
}
export const LIMITS: Limits = { gain: 0.5, stepShift: 0.03, stepTurn: (0.5 * Math.PI) / 180, maxShift: 0.25, maxTurn: (3 * Math.PI) / 180, quiet: 0.003 };

// One check: the move that was found, damped and limited, done after the correction so far. `at` is a point of the room (its
// floor centre) where the size of the whole correction is measured. Null: nothing to do.
export function nextFix(old: Fix, s: Solved, at: P2, lim: Limits = LIMITS): { fix: Fix; moved: number } | null {
  let vx = s.vx * lim.gain;
  let vz = s.vz * lim.gain;
  let th = s.theta * lim.gain;
  const len = Math.hypot(vx, vz);
  if (len > lim.stepShift) {
    vx *= lim.stepShift / len;
    vz *= lim.stepShift / len;
  }
  th = Math.max(-lim.stepTurn, Math.min(lim.stepTurn, th));
  if (Math.hypot(vx, vz) < lim.quiet && Math.abs(th) * Math.hypot(s.c[0] - at[0], s.c[1] - at[1]) < lim.quiet) return null;
  const fix = compose({ theta: th, vx, vz, c: s.c }, old);
  const p = apply(fix, at);
  if (Math.hypot(p[0] - at[0], p[1] - at[1]) > lim.maxShift || Math.abs(fix.theta) > lim.maxTurn) return null; // too far from the headset's: not believed
  return { fix, moved: Math.hypot(vx, vz) };
}

// When to stop. The depth is noisy by a centimetre or so, so correcting at every check would never stop: the room would wander by
// a few millimetres with whatever the headset is looking at. Instead: apply corrections while the room is being brought in; once
// the move that would still be applied has been small for a few checks in a row, HOLD the room where it is; wake up only when the
// difference gets clearly big (the headset moved the room) and stays so for a few checks.
export interface SettleOptions {
  calmBelow: number; // m: a proposed move under this is "nothing to do"
  rmsBelow: number; // m: and the readings agree under this
  calmChecks: number; // this many in a row to settle
  wakeAbove: number; // m: a proposed move over this wakes it up
  wakeChecks: number; // this many in a row
}
export const SETTLE: SettleOptions = { calmBelow: 0.01, rmsBelow: 0.02, calmChecks: 4, wakeAbove: 0.025, wakeChecks: 3 };

export function createSettler(o: SettleOptions = SETTLE) {
  let settled = false;
  let calm = 0;
  let off = 0;
  return {
    get settled() {
      return settled;
    },
    reset() {
      settled = false;
      calm = 0;
      off = 0;
    },
    // `big`: the size of the whole move the readings ask for (m; a turn counted by its effect at the walls), `rms` what is left over.
    // `apply`: do the (damped) correction now. `event`: the state changed.
    step(big: number, rms: number): { apply: boolean; event: 'settled' | 'woke' | null } {
      if (settled) {
        if (big < o.wakeAbove) {
          off = 0;
          return { apply: false, event: null };
        }
        if (++off < o.wakeChecks) return { apply: false, event: null };
        settled = false;
        calm = 0;
        off = 0;
        return { apply: true, event: 'woke' };
      }
      if (big < o.calmBelow && rms < o.rmsBelow) {
        if (++calm >= o.calmChecks) {
          settled = true;
          off = 0;
          return { apply: false, event: 'settled' };
        }
      } else calm = 0;
      return { apply: true, event: null };
    },
  };
}
