// Run: npx tsx docs/test-plans/refs.test.mts. Reference points of big spaces: size detection, the minimum gap, and the alignment
// on 3-4 touched points (gives the pose back, tolerates noise, catches a wrong point).
import assert from 'node:assert/strict';
import { BIG_AREA, isBigSpace, spaceSize } from '../../src/room/bigSpace';
import { alignFromRefs, refProblem, refsCollinear } from '../../src/room/refs';
import type { RoomPlane, Vec3 } from '../../src/room/types';

const floor = (w: number, d: number): RoomPlane => ({ label: 'floor', pos: [0, 0, 0], quat: [0, 0, 0, 1], poly: [-w / 2, -d / 2, w / 2, -d / 2, w / 2, d / 2, -w / 2, d / 2] });
assert.ok(Math.abs(spaceSize([floor(8, 5)]).area - 40) < 1e-6);
assert.ok(isBigSpace([floor(8, 5)]), '40 m2 is big at the test threshold');
assert.ok(!isBigSpace([floor(4, 5)]), '20 m2 is not');
assert.ok(isBigSpace([floor(13, 1)]), 'a long side is big');
assert.ok(BIG_AREA <= 40);

const have: Vec3[] = [[0, 0, 0]];
assert.ok(refProblem([1, 0, 1], have), 'too close');
assert.equal(refProblem([3, 0, 0], have), null, 'exactly 3 m is fine');

const saved: Vec3[] = [[0, 0, 0], [6, 0, 0], [6, 0, 4], [0, 0, 4]];
const yaw = 0.7;
const put = (p: Vec3, n = 0): Vec3 => [Math.cos(yaw) * p[0] - Math.sin(yaw) * p[2] + 2 + n, p[1] + 0.1, Math.sin(yaw) * p[0] + Math.cos(yaw) * p[2] - 3 + n];
let f = alignFromRefs(saved, saved.map((p) => put(p)), 0.1);
assert.ok(Math.abs(f.alignment.yaw - yaw) < 1e-9 && f.ok && f.alignment.resid < 1e-9);
assert.ok(Math.abs(f.alignment.tx - 2) < 1e-9 && Math.abs(f.alignment.tz + 3) < 1e-9);
f = alignFromRefs(saved.slice(0, 3), saved.slice(0, 3).map((p) => put(p)), null);
assert.ok(Math.abs(f.alignment.yaw - yaw) < 1e-9 && f.ok, 'three points');
const noisy = saved.map((p, i) => put(p, (i % 2 ? 1 : -1) * 0.02));
f = alignFromRefs(saved, noisy, null);
assert.ok(f.ok && Math.abs(f.alignment.yaw - yaw) < 0.02, 'noise of 2 cm');
const wrong = saved.map((p) => put(p));
wrong[2] = put([6, 0, 5.5]); // touched 1.5 m away from where it should be
assert.ok(!alignFromRefs(saved, wrong, null).ok, 'a wrong point is caught');
assert.ok(refsCollinear([[0, 0, 0], [5, 0, 0.2], [10, 0, 0]]), 'nearly a line is warned');
assert.equal(refsCollinear([[0, 0, 0], [6, 0, 0], [3, 0, 5]]), null, 'a triangle is fine');
console.log('refs ok');
