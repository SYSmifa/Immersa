// Run: npx tsx docs/test-plans/bypoints.test.mts. A room made from points: the planes, and the two opposite points.
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { DOOR, WINDOW, fitOpenings, oppositePair, scanFromPoints } from '../../src/room/byPoints';
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

// ---- doors and windows: the wall has a hole (it is made of pieces) ----
const area = (planes: typeof scan.planes) => planes.filter((p) => p.label === 'wall').reduce((t, p) => t + Math.abs((p.poly![2] - p.poly![0]) * (p.poly![5] - p.poly![1])), 0);
const full = area(scan.planes); // 2 * (10 + 6) * 3 = 96 m²
assert.ok(Math.abs(full - 96) < 1e-9);
const door = { wall: 0, at: 5, ...DOOR, kind: 'door' as const };
const withDoor = scanFromPoints(pts.map((pos) => ({ pos })), 0, 3, [door]);
assert.equal(withDoor.planes.filter((p) => p.label === 'wall').length, 3 + 3, 'door: left, right and above, on side 0');
assert.ok(Math.abs(full - area(withDoor.planes) - 0.9 * 2.1) < 1e-9, 'the hole is the door');
assert.equal(withDoor.openings!.length, 1);
const win = { wall: 1, at: 3, ...WINDOW, kind: 'window' as const };
const withBoth = scanFromPoints(pts.map((pos) => ({ pos })), 0, 3, [door, win]);
assert.equal(withBoth.planes.filter((p) => p.label === 'wall').length, 3 + 4 + 2, 'window: left, right, above and below');
assert.ok(Math.abs(full - area(withBoth.planes) - 0.9 * 2.1 - 1.2 * 1.2) < 1e-9);
// the pieces sit where the opening is: the door's lintel is above 2.1 m, on the wall line
const lintel = withDoor.planes.find((p) => p.label === 'wall' && Math.abs(p.pos[1] - 2.55) < 1e-9)!;
assert.ok(Math.abs(lintel.pos[0] - 5) < 1e-9 && Math.abs(lintel.pos[2]) < 1e-9);
// fitting: clamped inside the side and under the ceiling, overlapping ones dropped, wrong sides dropped
const fit = fitOpenings([{ wall: 0, at: 0, w: 2, h: 5, sill: 1, kind: 'window' }, { wall: 0, at: 0.5, w: 1, h: 1, sill: 0, kind: 'door' }, { wall: 9, at: 1, w: 1, h: 1, sill: 0, kind: 'door' }], pts, 3);
assert.equal(fit.length, 1);
assert.ok(fit[0].at - fit[0].w / 2 >= 0 && fit[0].sill + fit[0].h <= 3 + 1e-9, 'inside the wall, under the ceiling');
console.log('bypoints ok');
