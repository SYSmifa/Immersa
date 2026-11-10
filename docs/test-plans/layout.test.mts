// Run: npx tsx docs/test-plans/layout.test.mts. Poses of rooms and the links between them.
import assert from 'node:assert/strict';
import { apply, compose, invert, learnedLinks, linkBetween, placeByLinks, relative } from '../../src/room/layout';
import type { Alignment } from '../../src/room/align';
import type { Room } from '../../src/room/types';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const p3 = (a: number[], b: number[]) => a.every((v, i) => near(v, b[i], 1e-9));

const f = { yaw: 0.7, tx: 1, ty: 0.1, tz: -2 };
const g = { yaw: -1.9, tx: -3, ty: 0.02, tz: 0.5 };
const pt: [number, number, number] = [1.2, 0.3, -0.8];
assert.ok(p3(apply(compose(f, g), pt), apply(f, apply(g, pt))), 'compose = apply twice');
assert.ok(p3(apply(invert(f), apply(f, pt)), pt), 'invert undoes');
assert.ok(p3(apply(compose(invert(f), f), pt), pt));

// Rooms A, B, C of one place. B is 6 m to the east of A (same frame orientation); C is 4 m north of B, turned 90 degrees.
const room = (id: string, place: string, links?: Room['scan']['links']): Room => ({ id, name: id, place, createdAt: '', updatedAt: '', scan: { version: 1, savedAt: 0, planes: [{ label: 'floor', pos: [0, 0, 0] }], links } });
const A0 = room('A', 'Casa');
const B0 = room('B', 'Casa');
const sessionA = { yaw: 0.3, tx: 5, ty: 0, tz: 5 }; // where A is in this session
const bInA = { yaw: 0, tx: 6, ty: 0, tz: 0 };
const sessionB = compose(sessionA, bInA);
const cInB = { yaw: Math.PI / 2, tx: 0, ty: 0, tz: -4 };

const learned = learnedLinks(A0, B0, sessionA, sessionB, 'meta')!;
assert.ok(learned, 'link learned');
assert.ok(near(learned[0].tx, 6, 1e-9) && near(learned[0].yaw, 0, 1e-9), 'B in A');
const A = room('A', 'Casa', { B: learned[0] });
const B = room('B', 'Casa', { A: learned[1], C: { ...cInB, at: 0, src: 'meta' } });
const C = room('C', 'Casa');
assert.ok(linkBetween(B, A), 'B knows A');
assert.equal(learnedLinks(A, B, sessionA, sessionB, 'manual'), null, 'a manual measure does not replace a meta one');
assert.equal(learnedLinks(A, B, sessionA, sessionB, 'meta'), null, 'nothing changed: nothing to write');
const moved = learnedLinks(A, B, sessionA, compose(sessionA, { ...bInA, tx: 6.2 }), 'meta');
assert.ok(moved && near(moved[0].tx, 6.2, 1e-9), 'a 20 cm change is written');
assert.equal(learnedLinks(A, room('Z', 'Altrove'), sessionA, sessionB, 'meta'), null, 'other place: never');

// A is placed (in the session); B and C follow, C through B.
const placed = new Map<string, Alignment>([['A', { ...sessionA, resid: 0, matched: 0, total: 0 }]]);
const out = placeByLinks([A, B, C], placed);
assert.ok(out.has('B') && out.has('C'));
const b = out.get('B')!;
assert.ok(p3(apply(b, [0, 0, 0]), apply(sessionB, [0, 0, 0])), 'B where it should be');
const c = out.get('C')!;
assert.ok(p3(apply(c, [1, 0, 0]), apply(compose(sessionB, cInB), [1, 0, 0])), 'C through B');
assert.ok(near(relative(sessionB, c).tz, -4, 1e-9));
assert.equal(placeByLinks([A, room('D', 'Casa')], placed).size, 0, 'no link, no placement');
// A is scanned again: its frame becomes the session's (a point q of the old frame is a(q) in the new one). Its link to B (B -> A) goes
// through a; B's link to A (A -> B) through the inverse of a.
const a = sessionA;
const bToAold = bInA;
const bToAnew = compose(a, bToAold);
const pB: [number, number, number] = [0.4, 0.1, 1.1];
assert.ok(p3(apply(bToAnew, pB), apply(a, apply(bToAold, pB))), 'own link after a rescan');
const aToB = invert(bToAold);
const aNewToB = compose(aToB, invert(a));
const qNew: [number, number, number] = [2, 0, -1];
assert.ok(p3(apply(aNewToB, qNew), apply(aToB, apply(invert(a), qNew))), 'the other\'s link after a rescan');
console.log('ok');
