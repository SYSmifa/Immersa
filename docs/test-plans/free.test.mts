// Models of a room that is gone land in the free space standing on the floor (height 0), whatever the old floor height was.
import assert from 'node:assert/strict';
import { adoptOrphans } from '../../src/room/free.ts';

const model = (id: string, roomId: string, y: number) => ({ id, roomId, name: id, path: 'p', pos: [1, y, 2] as [number, number, number], yaw: 0, scale: 1 });
const wall = (roomId: string, y: number) => ({ id: 'w', roomId, kind: 'wall' as const, a: [0, 0] as [number, number], b: [1, 0] as [number, number], y, height: 2.5, thickness: 0.1 });
const room = (id: string, floorY: number) => ({ id, name: id, createdAt: '', updatedAt: '', scan: { version: 1 as const, savedAt: 0, planes: [{ label: 'floor', pos: [0, floorY, 0] }] as any } });

// deleted room: the lowest model is on the floor
let p: any = { id: 'p', name: 'p', updatedAt: '', roomIds: [], models: [model('a', 'gone', -1.3), model('b', 'gone', -0.3)], structures: [wall('gone', -1.3)], annotations: [] };
assert.equal(adoptOrphans(p, []), 3);
assert.deepEqual(p.models.map((m: any) => +m.pos[1].toFixed(3)), [0, 1]);
assert.equal(p.models[0].roomId, '');
assert.ok(Math.abs(p.structures[0].y) < 1e-9);
assert.equal(p.models[0].pos[0], 1, 'x and z stay');

// room still there, only taken out of the project: its floor height is used
p = { id: 'p', name: 'p', updatedAt: '', roomIds: [], models: [model('a', 'r1', -1.2), model('b', 'r1', 0.3)], structures: [], annotations: [] };
adoptOrphans(p, [room('r1', -1.5)]);
assert.deepEqual(p.models.map((m: any) => +m.pos[1].toFixed(3)), [0.3, 1.8]);

// a room that is in the project is left alone
p = { id: 'p', name: 'p', updatedAt: '', roomIds: ['r1'], models: [model('a', 'r1', -1.2), model('f', '', 0.5)], structures: [], annotations: [] };
assert.equal(adoptOrphans(p, [room('r1', -1.5)]), 0);
assert.equal(p.models[0].pos[1], -1.2);
assert.equal(p.models[1].pos[1], 0.5, 'already free: untouched');
console.log('ok');
