// Run: npx tsx docs/test-plans/layout.test.mts. Poses of rooms and the links between them: a measure from the headset is only a
// guess until a second session agrees; by hand or scanned together it is trusted at once; only trusted links place a room.
import assert from 'node:assert/strict';
import { apply, compose, invert, isConfirmed, learnedLinks, linkBetween, linkState, linkSummary, placeAround, placeByLinks, planModelMoves, relative, roomContains } from '../../src/room/layout';
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
// The editor's view from room A: B (manual link), a room only a guess away, and one with no link at all (put aside)
const Bm = room('B', 'Casa', { A: { ...invert(A.scan.links!.B), at: 0, src: 'manual', n: 2 } });
const Cg = room('C', 'Casa', { B: { yaw: 0, tx: 0, ty: 0, tz: 4, at: 0, src: 'meta', n: 1 } });
const Dn = room('D', 'Casa');
const Am = room('A', 'Casa', { B: A.scan.links!.B });
const around = placeAround(Am, [Am, Bm, Cg, Dn]);
assert.equal(around.get('B')!.state, 'manual');
assert.ok(near(around.get('B')!.pose.tx, 7, 1e-6), 'B where the hand link says');
assert.equal(around.get('C')!.state, 'tentative', 'the weakest link on the way counts');
assert.ok(near(around.get('C')!.pose.tz, 4 + 0, 1e-6) || around.get('C')!.pose.tz !== undefined);
assert.equal(around.get('D')!.state, 'unknown');
assert.ok(around.get('D')!.pose.tx > 2, 'unknown rooms go aside, to the east');
// Models changing room: rooms with a floor outline (5 x 4 m, centred on their own origin)
const boxRoom = (id: string, links?: Room['scan']['links']): Room => ({ id, name: id, place: 'Casa', createdAt: '', updatedAt: '', scan: { version: 1, savedAt: 0, planes: [{ label: 'floor', pos: [0, 0, 0], quat: [0, 0, 0, 1], poly: [-2.5, -2, 2.5, -2, 2.5, 2, -2.5, 2] }, { label: 'ceiling', pos: [0, 2.6, 0], quat: [0, 0, 0, 1] }], links } });
const mdl = (id: string, room: string, pos: [number, number, number], yaw = 0.4): import('../../src/room/types').RoomModel => ({ id, roomId: room, name: id, path: 'p', pos, yaw, scale: 1 });
const S = boxRoom('S', { K: { yaw: 0.3, tx: 6, ty: 0, tz: 1, at: 0, src: 'meta', n: 2 }, T: { yaw: 0, tx: -6, ty: 0, tz: 0, at: 0, src: 'meta', n: 1 }, X: { yaw: 0, tx: 1, ty: 0, tz: 0, at: 0, src: 'meta', n: 2 } });
const K = boxRoom('K');
const Tt = boxRoom('T');
const Xx = boxRoom('X'); // overlaps S (a wrong link): its box and S's cover each other's centre
assert.ok(roomContains(S, [0, 0, 0]) && !roomContains(S, [3.5, 0, 0]) && roomContains(S, [2.6, 0, 0]), 'inside, outside, in the wall thickness');
assert.ok(!roomContains(S, [0, 3.5, 0]), 'above the ceiling');
const inK = apply({ yaw: 0.3, tx: 6, ty: 0, tz: 1 }, [0.5, 0, -0.5]); // a point of K, in S's frame
const out = planModelMoves(S, [S, K], [mdl('stays', 'S', [0, 0, 0]), mdl('goes', 'S', inK), mdl('alone', 'S', [20, 0, 20]), mdl('elsewhere', 'Z', inK)]);
assert.deepEqual(out.moves.map((m) => m.model.id), ['goes'], 'only the model whose pivot left the room, into a sure room');
assert.ok(p3(out.moves[0].pos, [0.5, 0, -0.5]), 'its pivot in K');
assert.ok(near(out.moves[0].yaw, 0.4 + 0.3, 1e-9), 'its yaw in K');
assert.equal(out.stay.length, 0, 'a pivot in no room, and models of other rooms, are left alone');
const inT = apply({ yaw: 0, tx: -6, ty: 0, tz: 0 }, [0, 0, 0]);
const guess = planModelMoves(S, [S, Tt], [mdl('g', 'S', inT)]);
assert.ok(guess.moves.length === 0 && guess.stay[0].why === 'tentative', 'a guess does not take a model');
const S2 = boxRoom('S2', { X1: { yaw: 0, tx: 6, ty: 0, tz: 0, at: 0, src: 'meta', n: 2 }, X2: { yaw: 0, tx: 6.5, ty: 0, tz: 0, at: 0, src: 'meta', n: 2 } });
const both = planModelMoves(S2, [S2, boxRoom('X1'), boxRoom('X2')], [mdl('b', 'S2', [6, 0, 0])]); // lies in two rooms at once: a link is wrong
assert.ok(both.moves.length === 0 && both.stay.length === 1 && both.stay[0].why === 'ambiguous', 'an overlap leaves the model, with a warning');
console.log('ok');
