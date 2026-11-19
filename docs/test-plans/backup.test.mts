// Backup file: build → parse round trip, links and ids re-addressed on import, names made unique.
import assert from 'node:assert/strict';
import { buildBackup, parseBackup, remapProject, remapScan, selectForBackup, uniqueName } from '../../src/editor/backup.ts';

const link = { yaw: 0, tx: 5, ty: 0, tz: 0, at: 1, src: 'meta' as const, n: 2 };
const scan = (links?: Record<string, typeof link>) => ({ version: 1 as const, savedAt: 1, planes: [], ...(links ? { links } : {}) });
const room = (id: string, links?: Record<string, typeof link>) => ({ id, name: `Stanza ${id}`, place: 'Casa', createdAt: '', updatedAt: '', scan: scan(links) });
const model = (id: string, roomId: string, path: string) => ({ id, roomId, name: id, path, pos: [0, 0, 0] as [number, number, number], yaw: 0, scale: 1 });
const A = room('A', { B: link, Z: link });
const B = room('B', { A: link });
const Z = room('Z');
const p1 = { id: 'p1', name: 'Uno', updatedAt: '', roomIds: ['A', 'B'], models: [model('m1', 'A', 'u/x.glb'), model('m2', 'B', 'local:c.glb'), model('m3', 'A', 'u/gone.glb')], structures: [], annotations: [], tone: 2 };
const p2 = { id: 'p2', name: 'Due', updatedAt: '', roomIds: ['Z'], models: [], structures: [], annotations: [] };

// one project: only its rooms, links to rooms outside dropped
const one = selectForBackup([A, B, Z], [p1, p2], p1);
assert.deepEqual(one.rooms.map((r) => r.id), ['A', 'B']);
assert.deepEqual(Object.keys(one.rooms[0].scan.links!), ['B'], 'the link to Z is dropped');
assert.equal(one.projects.length, 1);
// everything
assert.equal(selectForBackup([A, B, Z], [p1, p2]).rooms.length, 3);

// build → parse
const glb = new Uint8Array([1, 2, 3, 4]);
const { bytes, missing } = await buildBackup(one, async (p) => (p === 'u/x.glb' ? glb : null));
assert.deepEqual(missing, ['u/gone.glb'], 'unreadable files are reported, local: ones are not asked for');
const { backup, files } = parseBackup(bytes);
assert.equal(backup.projects[0].name, 'Uno');
assert.deepEqual([...files[backup.files['u/x.glb']]], [1, 2, 3, 4]);
assert.throws(() => parseBackup(new Uint8Array([1, 2, 3])), /non è un backup/);

// import: new ids, links re-addressed, paths re-addressed
const idMap = new Map([['A', 'A2'], ['B', 'B2']]);
assert.deepEqual(Object.keys(remapScan(backup.rooms[0].scan, idMap).links!), ['B2']);
const c = remapProject(backup.projects[0], idMap, new Map([['u/x.glb', 'new/y.glb']]));
assert.deepEqual(c.roomIds, ['A2', 'B2']);
assert.equal(c.models[0].roomId, 'A2');
assert.equal(c.models[0].path, 'new/y.glb');
assert.equal(c.models[1].path, 'local:c.glb');

// names
assert.equal(uniqueName('Cucina', ['salotto']), 'Cucina');
assert.equal(uniqueName('Cucina', [' cucina ']), 'Cucina (2)');
assert.equal(uniqueName('Cucina', ['Cucina', 'Cucina (2)']), 'Cucina (3)');
console.log('ok');
