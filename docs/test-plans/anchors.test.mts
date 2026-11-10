// Run: npx tsx docs/test-plans/anchors.test.mts. Manual alignment with two touched corners: the corners suggested for a 5 x 3 m
// room are the far ones; touching them at a known pose gives that pose back; touching the wrong corners is caught.
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { alignFromTouches, suggestCorners } from '../../src/room/anchors';
import type { RoomPlane } from '../../src/room/types';

// A wall plane at `pos`, facing `normal` (horizontal), 2.5 m high and `len` long. planeNormal() is the plane's local Y.
const wall = (pos: [number, number, number], normal: [number, number, number], len: number): RoomPlane => {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...normal));
  return { label: 'wall', pos, quat: [q.x, q.y, q.z, q.w], poly: [-len / 2, -1.25, len / 2, -1.25, len / 2, 1.25, -len / 2, 1.25] };
};
const room: RoomPlane[] = [
  wall([0, 1.25, -1.5], [0, 0, 1], 5), // north wall (z = -1.5), faces +z
  wall([0, 1.25, 1.5], [0, 0, -1], 5), // south
  wall([2.5, 1.25, 0], [-1, 0, 0], 3), // east
  wall([-2.5, 1.25, 0], [1, 0, 0], 3), // west
  { label: 'floor', pos: [0, 0.02, 0], quat: [0, 0, 0, 1], poly: [-2.5, -1.5, 2.5, -1.5, 2.5, 1.5, -2.5, 1.5] },
];

const plan = suggestCorners(room)!;
assert.ok(plan, 'corners found');
const d = Math.hypot(plan.a[0] - plan.b[0], plan.a[2] - plan.b[2]);
assert.ok(Math.abs(d - Math.hypot(5, 3)) < 0.05, `far corners: ${d}`); // the diagonal
assert.ok(Math.abs(plan.floorY - 0.02) < 1e-6, 'floor height');
assert.equal(plan.segs.length, 4);

// The room is really at yaw 30 degrees and (1, 0, -2): touching its two corners must give that back.
const yaw = Math.PI / 6;
const put = (p: [number, number, number]): [number, number, number] => [Math.cos(yaw) * p[0] - Math.sin(yaw) * p[2] + 1, p[1] + 0.1, Math.sin(yaw) * p[0] + Math.cos(yaw) * p[2] - 2];
const r = alignFromTouches(plan.a, plan.b, put(plan.a), put(plan.b), 0.12);
assert.ok(r.ok, 'consistent touches');
assert.ok(Math.abs(r.alignment.yaw - yaw) < 1e-6, `yaw ${r.alignment.yaw}`);
assert.ok(Math.abs(r.alignment.tx - 1) < 1e-6 && Math.abs(r.alignment.tz + 2) < 1e-6, `t ${r.alignment.tx} ${r.alignment.tz}`);
assert.ok(Math.abs(r.alignment.ty - 0.1) < 1e-6, `ty ${r.alignment.ty}`);

// A touch 3 cm off on one corner: still ok, small residual.
const off = put(plan.b);
off[0] += 0.03;
assert.ok(alignFromTouches(plan.a, plan.b, put(plan.a), off, null).ok);

// Touching a nearer corner instead of the far one: the distances do not agree.
const near = alignFromTouches(plan.a, plan.b, put(plan.a), put([plan.a[0] + 2, 0, plan.a[2]]), null);
assert.ok(!near.ok, 'wrong corner caught');
console.log('ok', plan.a.map((v) => v.toFixed(2)).join(','), plan.b.map((v) => v.toFixed(2)).join(','));
