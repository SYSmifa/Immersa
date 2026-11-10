// Run: npx tsx docs/test-plans/places.test.mts. The rules of places: one place per project.
import assert from 'node:assert/strict';
import { addRoomError, compatibleRooms, knownPlaces, placeChangeConflict, placeOfRooms } from '../../src/room/places';
import type { Project, Room } from '../../src/room/types';

const room = (id: string, place?: string, at = '2026-01-01T00:00:00Z'): Room => ({ id, name: id.toUpperCase(), createdAt: at, updatedAt: at, scan: { version: 1, savedAt: 0, planes: [] }, place });
const a1 = room('a1', 'Casa mia', '2026-02-01T00:00:00Z');
const a2 = room('a2', ' casa MIA ', '2026-03-01T00:00:00Z');
const b1 = room('b1', 'Capannone');
const n1 = room('n1');
const proj = (id: string, roomIds: string[]): Project => ({ id, name: `P${id}`, updatedAt: '', roomIds, models: [], structures: [], annotations: [] });

assert.deepEqual(knownPlaces([a1, a2, b1, n1]), ['casa MIA', 'Capannone'], 'same place under different spellings counts once, newest spelling first');
assert.equal(placeOfRooms([a1, a2]), 'casa MIA');
assert.equal(placeOfRooms([a1, b1]), undefined, 'two places: none');
assert.equal(addRoomError([a1], a2), '', 'same place');
assert.ok(addRoomError([a1], b1).includes('un solo luogo'), 'other place refused');
assert.ok(addRoomError([a1], n1).includes('non ha un luogo'), 'a room without a place is not mixed in');
assert.equal(addRoomError([], b1), '', 'first room: anything');
assert.equal(addRoomError([n1], b1), '', 'no place yet in the project');
assert.deepEqual(compatibleRooms([a1], [a1, a2, b1, n1]).map((r) => r.id), ['a1', 'a2', 'n1']);
assert.equal(compatibleRooms([], [a1, b1]).length, 2);
assert.equal(placeChangeConflict('a2', 'Capannone', [a1, a2, b1], [proj('1', ['a1', 'a2'])]), 'P1', 'moving a2 would split project 1');
assert.equal(placeChangeConflict('b1', 'Casa mia', [a1, a2, b1], [proj('2', ['b1'])]), '', 'b1 is alone in its project');
console.log('ok');
