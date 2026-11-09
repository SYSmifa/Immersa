// Run: npx tsx docs/test-plans/annotations.test.mts
import assert from 'node:assert/strict';
import { annotationLabel, annotationLength, annotationMeasures, annotationName, copyAnnotation, newAnnotation } from '../../src/room/annotations.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

// a ruler: 3-4-5 triangle
const r = newAnnotation('ruler', 'room1', [0, 0, 0], [3, 4, 0]);
near(annotationLength(r)!, 5);
assert.equal(annotationLabel(r), '5,00 m');
assert.equal(annotationName(r), 'Metro 5,00 m');
r.text = 'cavo';
assert.equal(annotationLabel(r), '5,00 m · cavo');

// the things to draw: two crosses (3 segments each) and the line with its label
const m = annotationMeasures(r);
assert.equal(m.filter((x) => x.kind === 'pin').length, 6);
const line = m.find((x) => x.kind === 'ruler')!;
assert.deepEqual([line.a, line.b], [[0, 0, 0], [3, 4, 0]]);
assert.equal(line.text, '5,00 m · cavo');
assert.ok(m.every((x) => x.owner === r.id && x.color === r.color));

// a note: one cross and its text at the point; empty text still says something
const n = newAnnotation('note', '', [1, 2, 3]);
assert.equal(annotationLength(n), null);
assert.equal(annotationLabel(n), 'Nota');
n.text = '  passa il cavo qui ';
assert.equal(annotationLabel(n), 'passa il cavo qui');
assert.equal(annotationName(n), 'Nota: passa il cavo qui');
const nm = annotationMeasures(n);
assert.equal(nm.filter((x) => x.kind === 'pin').length, 3);
assert.deepEqual(nm.find((x) => x.kind === 'note')!.a, [1, 2, 3]);

// a copy keeps the content and gets its own id (and does not share the points)
const c = copyAnnotation(r, 1);
assert.notEqual(c.id, r.id);
assert.deepEqual({ ...c, id: '' }, { ...r, id: '' });
c.a[0] = 9;
assert.equal(r.a[0], 0);
console.log('annotations: all checks passed');
