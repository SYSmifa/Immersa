// Zone di rispetto: the zone follows the model (margins per side, yaw, scale) and an overlap is detected, touching is not one.
import assert from 'node:assert/strict';
import { invasionTexts, polysOverlap, solidsOverlap, uniformZone, zoneSolid, zoneStates as states } from '../../src/room/zones.ts';
const zoneStates = (models: any[], boxOf: any, structures: any[] = [], walls: any[] = []) => states({ models, structures, boxOf, walls });

const model = (id: string, x: number, z: number, extra: object = {}) => ({ id, roomId: 'r', name: id, path: 'p', pos: [x, 0, z] as [number, number, number], yaw: 0, scale: 1, ...extra });
const box = () => ({ min: [-0.5, 0, -0.5] as [number, number, number], max: [0.5, 1, 0.5] as [number, number, number] }); // 1 × 1 × 1 m

// margins: 1 m everywhere around a 1 m box = a 3 m square
const press = model('Pressa', 0, 0, { zone: uniformZone(1) });
const z = zoneSolid(press, box().min, box().max)!;
assert.ok(Math.abs(z.hu - 1.5) < 1e-9 && Math.abs(z.hv - 1.5) < 1e-9);
assert.equal(zoneSolid(model('x', 0, 0), box().min, box().max), null, 'no zone, no solid');

// a model 2 m away (its box 1.5..2.5) touches the zone edge (1.5): not an invasion; at 1.9 it is one
let st = zoneStates([press, model('Banco', 2, 0)], box);
assert.deepEqual(st[0].invaders, []);
st = zoneStates([press, model('Banco', 1.9, 0)], box);
assert.deepEqual(invasionTexts(st), ['Banco invade la zona di Pressa']);

// per side: only 0.2 m behind (-Z): a model 1 m behind the box edge is out, one in front (+Z, 1 m) is in
const side = model('Pressa', 0, 0, { zone: { f: 1, b: 0.2, l: 0, r: 0 } });
assert.deepEqual(zoneStates([side, model('A', 0, -1.2)], box)[0].invaders, [], 'behind: only 0.2 m asked');
assert.deepEqual(zoneStates([side, model('B', 0, 1.4)], box)[0].invaders, ['B'], 'in front: 1 m asked');

// it turns with the model (yaw 90°: the front looks along ±X)
const turned = model('Pressa', 0, 0, { yaw: Math.PI / 2, zone: { f: 1, b: 0, l: 0, r: 0 } });
const hits = (x: number, z: number) => zoneStates([turned, model('C', x, z)], box)[0].invaders.length;
assert.equal(hits(1.4, 0) + hits(-1.4, 0), 1, 'one side of X only');
assert.equal(hits(0, 1.4) + hits(0, -1.4), 0, 'Z is now the width: nothing there');

// height: a model above the zone (y from 1.2) does not touch it; another room is not compared
const high = { ...model('High', 1.9, 0), pos: [1.9, 1.2, 0] as [number, number, number] };
assert.deepEqual(zoneStates([press, high], box)[0].invaders, []);
assert.deepEqual(zoneStates([press, { ...model('Else', 1.9, 0), roomId: 'other' }], box)[0].invaders, []);

// scale: margins stay in metres
const big = model('Big', 0, 0, { scale: 2, zone: uniformZone(1) });
const zb = zoneSolid(big, box().min, box().max)!;
assert.ok(Math.abs(zb.hu - 2) < 1e-9, 'a 2 m box plus 1 m each side = half width 2');
assert.ok(solidsOverlap(z, z));

// free zones: a floor with `zone` is a polygon up to 2.2 m; a model touching it invades it
const corridor = { id: 'z1', roomId: 'r', kind: 'floor', a: [0, 0], b: [1, 1], pts: [[2, -3], [3, -3], [3, 3], [2, 3]], y: 0, height: 0, thickness: 0.1, zone: true };
const plain = { ...corridor, id: 'f1', zone: undefined };
let fz = zoneStates([model('Banco', 2.5, 0)], box, [corridor, plain]);
assert.equal(fz.length, 1, 'only the floor with zone is a zone');
assert.equal(fz[0].name, 'Zona 1');
assert.deepEqual(fz[0].invaders, ['Banco']);
assert.deepEqual(zoneStates([model('Banco', 0, 0)], box, [corridor])[0].invaders, []);
assert.deepEqual(invasionTexts(fz), ['Banco invade Zona 1']);
// an L-shaped zone: a model in the notch is outside
const L = { ...corridor, pts: [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]] };
assert.deepEqual(zoneStates([model('In', 0.5, 3)], box, [L])[0].invaders, ['In']);
assert.deepEqual(zoneStates([model('Notch', 3, 3)], box, [L])[0].invaders, [], 'the notch of the L is free');
// polygons: crossing, containing, apart, touching along an edge
const sq = (x: number, z: number, r: number) => [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]] as [number, number][];
assert.ok(polysOverlap(sq(0, 0, 1), sq(1, 0, 1)));
assert.ok(polysOverlap(sq(0, 0, 3), sq(0, 0, 1)), 'one inside the other');
assert.ok(!polysOverlap(sq(0, 0, 1), sq(5, 0, 1)));
assert.ok(!polysOverlap(sq(0, 0, 1), sq(2, 0, 1)), 'touching is not overlapping');

// walls: a zone that cuts a wall is reported (a wall face is a segment with heights)
const wall = (ax: number, az: number, bx: number, bz: number) => ({ a: [ax, az], b: [bx, bz], y0: 0, y1: 2.5, owner: 'w' });
const near = zoneStates([press], box, [], [wall(1.2, -3, 1.2, 3)]);
assert.equal(near[0].walls, true, 'the zone reaches 1.5 m: a wall at 1.2 m cuts it');
assert.deepEqual(invasionTexts(near), ['La zona di Pressa tocca un muro']);
assert.equal(zoneStates([press], box, [], [wall(1.6, -3, 1.6, 3)])[0].walls, false, 'a wall at 1.6 m is outside');
assert.equal(zoneStates([press], box, [], [{ ...wall(1.2, -3, 1.2, 3), y0: 3, y1: 4 }])[0].walls, false, 'above the zone');
console.log('ok');
