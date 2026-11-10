// Run: npx tsx docs/test-plans/depth.test.mts. The depth probe's maths on a synthetic room: a floor at y = 0.02 and two walls
// (x = 2.00 and z = -1.50), 5 mm of noise, a few stray points. It must find the floor height and both walls to about 1 cm.
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { findWalls, floorBand, floorExtent } from '../../src/xr/depthMath';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const pts: number[] = [];
const add = (x: number, y: number, z: number) => pts.push(x + rnd() * 0.01, y + rnd() * 0.01, z + rnd() * 0.01);
for (let i = 0; i < 6000; i++) add(rnd() * 6, 0.02, rnd() * 6); // floor
for (let i = 0; i < 4000; i++) add(2, 0.3 + (rnd() + 0.5) * 1.5, rnd() * 4); // wall x = 2
for (let i = 0; i < 4000; i++) add(rnd() * 4, 0.3 + (rnd() + 0.5) * 1.5, -1.5); // wall z = -1.5
for (let i = 0; i < 300; i++) add(rnd() * 4, 0.3 + (rnd() + 0.5) * 1.5, rnd() * 4); // clutter
const P = new Float32Array(pts);
const n = pts.length / 3;

const f = floorBand(P, n);
assert.ok(Math.abs(f.y - 0.02) < 0.01, `floor y ${f.y}`);

const walls = findWalls(P, n, new Vector3(0, 1.6, 0));
assert.ok(walls.length >= 2, `walls: ${walls.length}`);
const near = (nx: number, nz: number, d: number) => walls.find((w) => Math.abs(w.nx * nx + w.nz * nz) > 0.99 && Math.abs(w.d - d) < 0.02);
assert.ok(near(-1, 0, -2) || near(1, 0, 2), 'wall x = 2 found within 2 cm');
assert.ok(near(0, 1, 1.5) || near(0, -1, -1.5), 'wall z = -1.5 found within 2 cm');
const wx = walls.find((w) => Math.abs(w.nx) > 0.99)!;
assert.ok(Math.abs(wx.hi - wx.lo - 4) < 0.15, `wall extent ${wx.hi - wx.lo}`);
const ext = floorExtent(P, n, 0.02, wx.nx, wx.nz)!;
assert.ok(ext && Math.abs(ext.t1 - ext.t0 - 6) < 0.3 && Math.abs(ext.n1 - ext.n0 - 6) < 0.3, 'floor extent about 6 x 6');
console.log('ok', walls.map((w) => `${w.count}pt d=${w.d.toFixed(3)}`).join(' | '));
