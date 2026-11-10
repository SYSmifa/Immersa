// Run: npx tsx docs/test-plans/wrap.test.mts. Label line breaking (headset notes): newlines, wrapping, long words, limit.
import assert from 'node:assert/strict';
import { wrapLines } from '../../src/room/measureView';

const width = (t: string, px: number) => t.length * px * 0.5; // 17 px per character at 34 px
const MAX = 348;

assert.deepEqual(wrapLines('Ciao', width, MAX), ['Ciao'], 'short text stays one line');
assert.deepEqual(wrapLines('uno\ndue', width, MAX), ['uno', 'due'], 'an explicit newline breaks');
const long = wrapLines('questa nota è molto lunga e deve andare a capo da sola', width, MAX);
assert.ok(long.length > 1 && long.every((l) => width(l, 34) <= MAX), `wrapped: ${long.join('|')}`);
const word = wrapLines('x'.repeat(60), width, MAX);
assert.ok(word.length > 1 && word.every((l) => width(l, 34) <= MAX), 'a very long word is cut');
const many = wrapLines(Array.from({ length: 30 }, (_, i) => `riga${i}`).join('\n'), width, MAX);
assert.equal(many.length, 8, 'at most 8 lines');
assert.ok(many[7].endsWith('…'));
console.log('ok');
