// Run: npx tsx docs/test-plans/layout.test.mts. Poses of rooms and the links between them: a measure from the headset is only a
// guess until a second session agrees; by hand or scanned together it is trusted at once; only trusted links place a room.
import assert from 'node:assert/strict';
import { apply, compose, invert, isConfirmed, learnedLinks, linkBetween, linkState, linkSummary, placeByLinks, relative } from '../../src/room/layout';
import type { Alignment } from '../../src/room/align';
import type { Room } from '../../src/room/types';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const p3 = (a: number[], b: number[]) => a.every((v, i) => near(v, b[i], 1e-9));

const f = { yaw: 0.7, tx: 1, ty: 0.1, tz: -2 };
const g = { yaw: -1.9, tx: -3, ty: 0.02, tz: 0.5 };
const pt: [number, number, number] = [1.2, 0.3, -0.8];
assert.ok(p3(apply(compose(f, g), pt), apply(f, apply(g, pt))), 'compose = apply twice');
assert.ok(p3(apply(invert(f), apply(f, pt)), pt), 'invert undoes');

const room = (id: string, place: string, links?: Room['scan']['links']): Room => ({ id, name: id, place, createdAt: '', updatedAt: '', scan: { version: 1, savedAt: 0, planes: [{ label: 'floor', pos: [0, 0, 0] }], links } });
const withLinks = (r: Room, l: [import('../../src/room/types').RoomLink, import('../../src/room/types').RoomLink] | null, other: string, second: boolean): Room =>
  l ? room(r.id, r.place!, { ...r.scan.links, [other]: l[second ? 1 : 0] }) : r;

const sessionA = { yaw: 0.3, tx: 5, ty: 0, tz: 5 };
const bInA = { yaw: 0, tx: 6, ty: 0, tz: 0 };
const sessionB = compose(sessionA, bInA);
const wrongB = compose(sessionA, { ...bInA, tx: 7, tz: 0.4 }); // the headset moved B by a metre in another session

let A = room('A', 'Casa');
let B = room('B', 'Casa');
const apply2 = (l: ReturnType<typeof learnedLinks>) => {
  assert.ok(l && l.links, 'something to write');
  A = withLinks(A, l.links, 'B', false);
  B = withLinks(B, l.links, 'A', true);
};

// 1. first measure from the headset: a guess, not used
let l = learnedLinks(A, B, sessionA, sessionB, 'meta', 's1');
apply2(l);
assert.equal(linkState(A.scan.links!.B), 'tentative');
assert.equal(placeByLinks([A, B], new Map<string, Alignment>([['A', { ...sessionA, resid: 0, matched: 0, total: 0 }]])).size, 0, 'a guess places nothing');
assert.equal(learnedLinks(A, B, sessionA, sessionB, 'meta', 's1'), null, 'the same session counts once');

// 2. the same in another session: confirmed, and then it places B
l = learnedLinks(A, B, sessionA, sessionB, 'meta', 's2');
apply2(l);
assert.equal(linkState(A.scan.links!.B), 'confirmed');
assert.ok(isConfirmed(linkBetween(B, A)!.link), 'seen from B too');
const placed = placeByLinks([A, B], new Map<string, Alignment>([['A', { ...sessionA, resid: 0, matched: 0, total: 0 }]]));
assert.ok(placed.has('B') && p3(apply(placed.get('B')!, [0, 0, 0]), apply(sessionB, [0, 0, 0])), 'B placed from A');

// 3. a measure a metre off against a confirmed link is thrown away, with a note
l = learnedLinks(A, B, sessionA, wrongB, 'meta', 's3');
assert.ok(l && l.links === null && /scartata/.test(l.note), 'discarded');

// 4. a guess against a different measure: kept as a candidate; a later session that agrees with the candidate wins
let C = room('C', 'Casa');
let D = room('D', 'Casa');
const sessionC = { yaw: -0.4, tx: -2, ty: 0, tz: 3 };
const dRight = compose(sessionC, { yaw: 0, tx: 4, ty: 0, tz: 0 });
const dWrong = compose(sessionC, { yaw: 0, tx: 5.2, ty: 0, tz: 0 }); // first session: the headset had it a metre off
const apply3 = (r: ReturnType<typeof learnedLinks>) => {
  assert.ok(r && r.links);
  C = withLinks(C, r.links, 'D', false);
  D = withLinks(D, r.links, 'C', true);
};
apply3(learnedLinks(C, D, sessionC, dWrong, 'meta', 's1'));
apply3(learnedLinks(C, D, sessionC, dRight, 'meta', 's2')); // differs: a candidate
assert.equal(linkState(C.scan.links!.D), 'tentative');
assert.ok(C.scan.links!.D.cand, 'candidate kept');
apply3(learnedLinks(C, D, sessionC, dRight, 'meta', 's3')); // agrees with the candidate: it wins
assert.equal(linkState(C.scan.links!.D), 'confirmed');
assert.ok(near(C.scan.links!.D.tx, 4, 1e-9), 'the repeated measure is the link');

// 5. scanned together (no restart between): confirmed at once
const E = room('E', 'Casa');
const F = room('F', 'Casa');
const tog = learnedLinks(E, F, sessionA, sessionB, 'meta', 's1', true)!;
assert.equal(linkState(tog.links![0]), 'confirmed');

// 6. by hand: trusted, replaces the headset's (even a confirmed one), and the headset never replaces it
l = learnedLinks(A, B, sessionA, wrongB, 'manual', 's4');
assert.ok(l && l.links);
A = withLinks(A, l.links, 'B', false);
B = withLinks(B, l.links, 'A', true);
assert.equal(linkState(A.scan.links!.B), 'manual');
assert.ok(near(A.scan.links!.B.tx, 7, 1e-6));
assert.equal(learnedLinks(A, B, sessionA, sessionB, 'meta', 's5'), null, 'the headset does not replace a hand link');

// 7. summaries for the lists
const sum = linkSummary(A, [A, B, C, room('Z', 'Altrove')]);
assert.deepEqual(sum, [{ name: 'B', state: 'manual' }]);

// A is scanned again: its frame becomes the session's (a point of the old frame is a(q) in the new one). Its link to B goes through a,
// B's link to A through the inverse of a.
const a = sessionA;
const bToAnew = compose(a, bInA);
const pB: [number, number, number] = [0.4, 0.1, 1.1];
assert.ok(p3(apply(bToAnew, pB), apply(a, apply(bInA, pB))), 'own link after a rescan');
const aNewToB = compose(invert(bInA), invert(a));
const qNew: [number, number, number] = [2, 0, -1];
assert.ok(p3(apply(aNewToB, qNew), apply(invert(bInA), apply(invert(a), qNew))), "the other's link after a rescan");
assert.ok(near(relative(sessionA, sessionB).tx, 6, 1e-9));
console.log('ok');
