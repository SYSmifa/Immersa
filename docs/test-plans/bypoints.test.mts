// Run: npx tsx docs/test-plans/bypoints.test.mts. A room made from points: the planes, and the two opposite points.
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { oppositePair, scanFromPoints } from '../../src/room/byPoints';
import { suggestCorners } from '../../src/room/anchors';
import type { Vec3 } from '../../src/room/types';

const pts: Vec3[] = [[0, 0.9, 0], [10, 1, 0], [10, 1, 6], [0, 1, 6]];
const [i, j] = oppositePair(pts);
assert.deepEqual([i, j], [0, 2], 'the diagonal');
const scan = scanFromPoints(pts.map((pos) => ({ pos })), 0, 3);
assert.equal(scan.planes.filter((p) => p.label === 'wall').length, 4);
assert.equal(scan.refs!.length, 2);
const wall = scan.planes[1]; // from (0,0) to (10,0): centre (5, 1.5, 0), normal along z
const n = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...wall.quat!));
assert.ok(Math.abs(Math.abs(n.z) - 1) < 1e-6 && Math.abs(n.x) < 1e-6, 'normal across the wall');
const up = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...wall.quat!));
assert.ok(Math.abs(up.y - 1) < 1e-6, 'plane z is up');
assert.ok(suggestCorners(scan.planes), 'the outline reads like a scanned room');
console.log('bypoints ok');
