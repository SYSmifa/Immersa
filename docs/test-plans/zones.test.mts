// Zone di rispetto: the zone follows the model (margins per side, yaw, scale) and an overlap is detected, touching is not one.
import assert from 'node:assert/strict';
import { invasionTexts, solidsOverlap, uniformZone, zoneSolid, zoneStates } from '../../src/room/zones.ts';

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
console.log('ok');
