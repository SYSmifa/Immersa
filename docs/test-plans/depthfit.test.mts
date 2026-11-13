// Run: npx tsx docs/test-plans/depthfit.test.mts   (depth correction maths: readings of the walls, the move that fits them, limits)
import assert from 'node:assert/strict';
import { apply, compose, createSettler, FIT, LIMITS, nextFix, NO_FIX, readWalls, solveMove, type Fix, type P2, type P3, type WallLine } from '../../src/xr/depthFit.ts';

const near = (a: number, b: number, eps = 5e-3) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
// a deterministic noise
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;

// Our room: 5 x 4 m, floor at y = 0, walls 2.6 m high. Normals point inwards.
const wallFrom = (id: string, a: P2, b: P2, n: P2): WallLine => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const t: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  return { id, n, d: n[0] * a[0] + n[1] * a[1], t, t0: t[0] * a[0] + t[1] * a[1], t1: t[0] * b[0] + t[1] * b[1], y0: 0, y1: 2.6 };
};
const ENDS: [string, P2, P2, P2][] = [
  ['w0', [0, 0], [5, 0], [0, 1]],
  ['w1', [5, 0], [5, 4], [-1, 0]],
  ['w2', [5, 4], [0, 4], [0, -1]],
  ['w3', [0, 4], [0, 0], [1, 0]],
];
// the walls as they stand when the room is moved by `fix` (what the app computes from the placed room)
const placed = (fix: Fix): WallLine[] =>
  ENDS.map(([id, a, b, n]) => {
    const a2 = apply(fix, a);
    const b2 = apply(fix, b);
    const n2: P2 = [Math.cos(fix.theta) * n[0] - Math.sin(fix.theta) * n[1], Math.sin(fix.theta) * n[0] + Math.cos(fix.theta) * n[1]];
    return wallFrom(id, a2, b2, n2);
  });
const walls = placed(NO_FIX);
// the TRUE room is ours moved by `fix` (what the depth sees): points on its walls, with noise, plus some furniture in front
function depthPoints(fix: Fix, noise = 0.01): P3[] {
  const pts: P3[] = [];
  const onWall = (a: P2, b: P2, n = 120) => {
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const p = apply(fix, [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]);
      pts.push([p[0] + rnd() * noise, 0.4 + 1.8 * ((i * 7919) % 100) / 100, p[1] + rnd() * noise]);
    }
  };
  onWall([0, 0], [5, 0]);
  onWall([5, 0], [5, 4]);
  onWall([5, 4], [0, 4]);
  onWall([0, 4], [0, 0]);
  // a wardrobe 40 cm in front of the first wall and a person 1 m from the second one: far from the walls, must be ignored
  for (let i = 0; i < 80; i++) pts.push([1 + (i % 10) * 0.1, 0.5 + (i % 7) * 0.2, 0.4 + rnd() * 0.01]);
  for (let i = 0; i < 40; i++) pts.push([4 + rnd() * 0.01, 1 + (i % 5) * 0.2, 1 + (i % 8) * 0.1]);
  return pts;
}

// no move: readings are ~0, nothing to fix
{
  const reads = readWalls(depthPoints(NO_FIX), walls);
  assert.equal(reads.length, 4);
  for (const r of reads) near(r.r, 0, 0.004);
  const s = solveMove(reads, walls)!;
  near(s.vx, 0, 0.004);
  near(s.vz, 0, 0.004);
  near(s.theta, 0, 0.003);
  assert.equal(nextFix(NO_FIX, s, [2.5, 2]), null); // below the quiet limit: left alone
}

// the real room is 6 cm east and 4 cm south of ours: the readings say so and the solution finds that shift
{
  const truth: Fix = { theta: 0, tx: 0.06, tz: 0.04 };
  const reads = readWalls(depthPoints(truth), walls);
  const byId = Object.fromEntries(reads.map((r) => [r.id, r.r]));
  near(byId.w0, 0.04, 0.004); // the wall z = 0 is 4 cm further in z, n = +z
  near(byId.w3, 0.06, 0.004); // x = 0 -> 6 cm, n = +x
  near(byId.w1, -0.06, 0.004); // x = 5 -> 5.06, n = -x: -6 cm
  near(byId.w2, -0.04, 0.004);
  const s = solveMove(reads, walls)!;
  near(s.vx, 0.06, 0.006);
  near(s.vz, 0.04, 0.006);
  near(s.theta, 0, 0.004);
  assert.equal(s.walls, 4);
}

// a turn of 1 degree about the room's centre: found as a turn, with its pivot
{
  const th = (1 * Math.PI) / 180;
  const c: P2 = [2.5, 2];
  const around = (p: P2): P2 => [c[0] + Math.cos(th) * (p[0] - c[0]) - Math.sin(th) * (p[1] - c[1]), c[1] + Math.sin(th) * (p[0] - c[0]) + Math.cos(th) * (p[1] - c[1])];
  // the Fix is p' = R p + t with the same effect as the turn about c
  const t = around([0, 0]);
  const fix: Fix = { theta: th, tx: t[0], tz: t[1] };
  const reads = readWalls(depthPoints(fix), walls);
  const s = solveMove(reads, walls)!;
  near(s.theta, th, 0.004);
  // applying the found move about its pivot gives almost the truth at the room's centre
  const fx = compose({ theta: s.theta, vx: s.vx, vz: s.vz, c: s.c }, NO_FIX);
  const got = apply(fx, c);
  const want = apply(fix, c);
  near(got[0], want[0], 0.006);
  near(got[1], want[1], 0.006);
}

// too few points / a short stretch of wall: not a reading
{
  const few = depthPoints(NO_FIX).slice(0, 6);
  assert.equal(readWalls(few, walls).length, 0);
  const short = Array.from({ length: 40 }, (_, i): P3 => [2 + i * 0.002, 1, 0.01]); // 8 cm of the first wall
  assert.equal(readWalls(short, walls).length, 0);
}
// points at the floor or the ceiling edge are not used (low = 30 cm)
{
  const floorish = Array.from({ length: 60 }, (_, i): P3 => [0.5 + i * 0.07, 0.1, 0.02]);
  assert.equal(readWalls(floorish, walls).length, 0);
}
// one wall alone: only the shift along it is found (the rest stays zero)
{
  const one = readWalls(depthPoints({ theta: 0, tx: 0.06, tz: 0.04 }), walls).filter((r) => r.id === 'w0');
  const s = solveMove(one, walls)!;
  near(s.vz, 0.04, 0.01);
  near(s.vx, 0, 0.01);
}

// limits: a big difference is applied in small steps (3 cm at most, half of what is found) and never beyond 25 cm in all
{
  const s = { vx: 0.2, vz: 0, theta: 0, c: [2.5, 2] as P2, walls: 4, rms: 0 };
  const a = nextFix(NO_FIX, s, [2.5, 2])!;
  near(a.fix.tx, 0.03, 1e-9);
  let f: Fix = NO_FIX;
  for (let i = 0; i < 30; i++) f = nextFix(f, s, [2.5, 2])?.fix ?? f;
  assert.ok(f.tx <= 0.25 + 1e-9, `${f.tx}`);
  near(f.tx, 0.24, 0.031); // it stopped at the limit
  // a turn beyond 3 degrees in all is not accepted
  let g: Fix = NO_FIX;
  const t = { vx: 0, vz: 0, theta: 0.2, c: [2.5, 2] as P2, walls: 4, rms: 0 };
  for (let i = 0; i < 40; i++) g = nextFix(g, t, [2.5, 2])?.fix ?? g;
  assert.ok(Math.abs(g.theta) <= LIMITS.maxTurn + 1e-9);
}

// it converges: the fix is applied, the next reading is taken against the corrected room
{
  const truth: Fix = { theta: 0, tx: 0.08, tz: -0.05 };
  let fix: Fix = NO_FIX;
  const pts = depthPoints(truth);
  for (let it = 0; it < 12; it++) {
    const now = placed(fix);
    const s = solveMove(readWalls(pts, now), now);
    if (!s) break;
    fix = nextFix(fix, s, [2.5, 2])?.fix ?? fix;
  }
  near(fix.tx, 0.08, 0.008);
  near(fix.tz, -0.05, 0.008);
  // and after a jump of the headset's own placement (the room 5 cm off again) it comes back by itself
  const jumped: Fix = { theta: 0, tx: fix.tx - 0.05, tz: fix.tz };
  fix = jumped;
  for (let it = 0; it < 12; it++) {
    const now = placed(fix);
    const s = solveMove(readWalls(pts, now), now);
    if (!s) break;
    fix = nextFix(fix, s, [2.5, 2])?.fix ?? fix;
  }
  near(fix.tx, 0.08, 0.008);
}
// settling: it holds once the moves asked for are small for 4 checks in a row, and wakes only for a big, lasting difference
{
  const st = createSettler();
  assert.deepEqual(st.step(0.05, 0.01), { apply: true, event: null }); // being brought in
  assert.deepEqual(st.step(0.006, 0.01), { apply: true, event: null });
  assert.deepEqual(st.step(0.02, 0.01), { apply: true, event: null }); // not calm again: the count restarts
  for (let i = 0; i < 3; i++) assert.deepEqual(st.step(0.004, 0.008), { apply: true, event: null });
  assert.deepEqual(st.step(0.004, 0.008), { apply: false, event: 'settled' });
  assert.equal(st.settled, true);
  // noise of a centimetre or two does nothing while held, however long it goes on
  for (let i = 0; i < 50; i++) assert.deepEqual(st.step(0.012 + (i % 3) * 0.004, 0.015), { apply: false, event: null });
  // a big difference for one or two checks only (a glitch) is ignored; the next calm check clears the count
  assert.deepEqual(st.step(0.08, 0.02), { apply: false, event: null });
  assert.deepEqual(st.step(0.08, 0.02), { apply: false, event: null });
  assert.deepEqual(st.step(0.005, 0.01), { apply: false, event: null });
  assert.deepEqual(st.step(0.08, 0.02), { apply: false, event: null });
  assert.deepEqual(st.step(0.08, 0.02), { apply: false, event: null });
  // three in a row: the room has really moved: wake up and correct again
  assert.deepEqual(st.step(0.08, 0.02), { apply: true, event: 'woke' });
  assert.equal(st.settled, false);
  st.reset();
  // a room that is right from the start settles without ever being moved
  const fresh = createSettler();
  let moves = 0;
  for (let i = 0; i < 4; i++) moves += fresh.step(0.003, 0.006).apply ? 1 : 0;
  assert.equal(fresh.settled, true);
  assert.equal(moves, 3); // the first three checks were "apply" but with moves under the quiet limit: nextFix does nothing then
}
void FIT;
console.log('depthfit: ok');
