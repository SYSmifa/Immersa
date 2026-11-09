// Run: npx tsx docs/test-plans/measure.test.mts   (numbers worked out by hand, see the comments)
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { boxSolid, dimsOfSolid, dimsOfStructure, formatLength, gapsOfSolid, modelSolid, planeSeg, roomAxes, solidSegs, wallSegs, type MeasureContext } from '../../src/room/measure.ts';
import type { RoomModel, Structure } from '../../src/room/types.ts';

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const wall = (id: string, a: [number, number], b: [number, number]): Structure => ({ id, roomId: 'r', kind: 'wall', a, b, y: 0, height: 2.7, thickness: 0.1 });
// A 5 x 4 m room, walls 10 cm thick centred on the lines: inner faces at x = 0.05 and 4.95, z = 0.05 and 3.95.
const walls = [wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [5, 4]), wall('w3', [5, 4], [0, 4]), wall('w4', [0, 4], [0, 0])];
const wallFaces = walls.flatMap(wallSegs);
const model = (id: string, pos: [number, number, number], yaw = 0): RoomModel => ({ id, roomId: 'r', name: id, path: 'x', pos, yaw, scale: 1 });
const lo: [number, number, number] = [-0.5, 0, -0.25];
const hi: [number, number, number] = [0.5, 2, 0.25]; // 1 x 2 x 0.5 m
const ctx = (extra: Partial<MeasureContext> = {}): MeasureContext => ({ obstacles: wallFaces, axes: roomAxes(wallFaces), ceilingY: 2.7, floorY: 0, ...extra });
const gaps = (s: ReturnType<typeof modelSolid>, c: MeasureContext) => gapsOfSolid(s, c).map((m) => m.text).sort();

// formatting
assert.equal(formatLength(1.236), '1,24 m');
assert.equal(formatLength(0.85), '85 cm');
assert.equal(formatLength(0.055), '5,5 cm');
assert.equal(formatLength(0.008), '8 mm');

// a model with its sides on the room's axes: free distances to the wall faces and the ceiling
const a = modelSolid(model('a', [2, 0, 1.5]), lo, hi);
near(a.hu, 0.5);
near(a.hv, 0.25);
assert.deepEqual(gaps(a, ctx()), ['1,20 m', '1,45 m', '2,20 m', '2,45 m', '70 cm'].sort()); // -z, -x, +z, +x, ceiling

// dimensions
assert.deepEqual(dimsOfSolid(a).map((m) => m.text), ['1,00 m', '50 cm', '2,00 m']);

// turned by 30 degrees, measured along the room's axes: its leftmost point is 0.5 cos30 + 0.25 sin30 from the centre
const turned = modelSolid(model('t', [2, 0, 1.5], Math.PI / 6), lo, hi);
const left = gapsOfSolid(turned, ctx()).find((m) => m.a[0] < m.b[0] === false && Math.abs(m.a[2] - m.b[2]) < 1e-6 && m.b[0] < m.a[0]);
assert.ok(left);
near(Math.hypot(left.b[0] - left.a[0], 0), 2 - (0.5 * Math.cos(Math.PI / 6) + 0.25 * Math.sin(Math.PI / 6)) - 0.05);

// another object in the way: the gap is to its side, not to the wall
const b = modelSolid(model('b', [3.5, 0, 1.5]), [-0.2, 0, -0.25], [0.2, 1.5, 0.25]);
assert.ok(gaps(a, ctx({ obstacles: [...wallFaces, ...solidSegs(b)] })).includes('80 cm')); // 2.5 -> 3.3

// ... unless it is lower than where the first one starts (no overlap in height): the wall is what is seen
const raised = modelSolid(model('r', [2, 1.6, 1.5]), lo, hi);
const low = modelSolid(model('low', [3.5, 0, 1.5]), [-0.2, 0, -0.25], [0.2, 1.5, 0.25]);
const gRaised = gaps(raised, ctx({ obstacles: [...wallFaces, ...solidSegs(low)], ceilingY: 4 }));
assert.ok(gRaised.includes('2,45 m') && gRaised.includes('1,60 m')); // wall at +x, and 1.6 m above the floor

// a wall: length and thickness, height
assert.deepEqual(dimsOfStructure(walls[0]).map((m) => m.text), ['5,00 m · sp. 10 cm', '2,70 m']);

// roomAxes: the longest wall's direction
const ax = roomAxes(wallFaces)!;
near(Math.abs(ax[0]) + Math.abs(ax[1]), 1);

// a wall plane of the scan: vertical, 4 m along z, 2.7 m high, at x = 0
const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2);
const seg = planeSeg({ label: 'wall', pos: [0, 1.35, 2], quat: [q.x, q.y, q.z, q.w], poly: [-1.35, -2, 1.35, -2, 1.35, 2, -1.35, 2] }, 0);
assert.ok(seg, 'a vertical plane gives a wall face');
near(Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]), 4);
near(seg.y1 - seg.y0, 2.7);
near(seg.a[0], 0);

// a furniture box of the scan, turned 90 degrees about y
const bq = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
const bs = boxSolid({ label: 'table', pos: [1, 0, 1], quat: [bq.x, bq.y, bq.z, bq.w], min: [-1, 0, -0.5], max: [1, 0.8, 0.5] }, 0);
near(bs.hu, 1);
near(bs.hv, 0.5);
near(bs.y1, 0.8);
console.log('measure: all checks passed');

// the height line stands where the width and the depth meet
const [w, d, h] = dimsOfSolid(a);
assert.deepEqual(w.b, d.a);
assert.deepEqual(h.a, d.a);
// walls only, no vertical distances
const wallsOnly = gapsOfSolid(a, ctx({ vertical: false, ceilingY: null }));
assert.deepEqual(wallsOnly.map((m) => m.text).sort(), ['1,20 m', '1,45 m', '2,20 m', '2,45 m'].sort());
console.log('measure: corner and walls-only ok');
