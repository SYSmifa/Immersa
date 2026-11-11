// Run: npx tsx docs/test-plans/gen-annotations-golden.mts
// Writes unity/Tests/Core.Tests/Fixtures/annotations-golden.json: random notes and rulers, and random texts to wrap, with what
// src/room/annotations.ts and wrapLines (the source of truth) compute. The C# port (Annotations.cs) is tested against it.
import { writeFileSync } from 'node:fs';
import { annotationLabel, annotationLength, annotationMeasures, annotationName, newAnnotation } from '../../src/room/annotations.ts';
import { wrapLines } from '../../src/room/measureView.ts';
import type { Annotation, Vec3 } from '../../src/room/types.ts';

let seed = 99;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 1000) / 1000;
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const v = (): Vec3 => [r(-6, 6), r(0, 3), r(-6, 6)];
const WORDS = ['passa', 'il', 'cavo', 'qui', 'attenzione', 'alla', 'colonna', 'quadro', 'elettrico', 'a', 'muro', 'sotto', 'la', 'finestra', 'x', 'macchinario', 'ingresso'];
const text = () => {
  const n = Math.floor(rnd() * 12);
  let s = Array.from({ length: n }, () => pick(WORDS)).join(pick([' ', ' ', '  ', ' \t', '\n']));
  if (rnd() < 0.15) s = '  ' + s + '  ';
  if (rnd() < 0.1) s += 'z'.repeat(Math.floor(rnd() * 70));
  return s;
};

const annotations = Array.from({ length: 60 }, (_, i) => {
  const kind = rnd() < 0.5 ? 'note' : 'ruler';
  const a = newAnnotation(kind, rnd() < 0.2 ? '' : 'r1', v(), kind === 'ruler' ? v() : undefined, rnd() < 0.7 ? text() : '');
  a.id = `a${i}`;
  if (rnd() < 0.5) a.color = pick(['#ffb020', '#2dd4bf', '#ff6b6b', '#8b9cff', '']);
  if (kind === 'note' && rnd() < 0.5) a.scale = pick([1, 0.4, 2.5, 4, 0]);
  const anchor: Vec3 | null = rnd() < 0.5 ? (rnd() < 0.3 ? [...a.a] as Vec3 : v()) : null;
  return {
    annotation: a, anchor,
    length: annotationLength(a), label: annotationLabel(a), name: annotationName(a), measures: annotationMeasures(a, anchor),
  };
});

const width = (t: string, px: number) => t.length * px * 0.5;
const wraps = Array.from({ length: 80 }, () => {
  const t = text() + (rnd() < 0.2 ? '\n' + text() : '') + (rnd() < 0.1 ? Array.from({ length: 12 }, (_, k) => `riga${k}`).join('\n') : '');
  const maxW = pick([348, 200, 120, 60, 800]);
  return { text: t, maxW, lines: wrapLines(t, width, maxW) };
});
writeFileSync('unity/Tests/Core.Tests/Fixtures/annotations-golden.json', JSON.stringify({ annotations, wraps }));
console.log('annotations', annotations.length, 'wraps', wraps.length, 'multi-line', wraps.filter((w) => w.lines.length > 1).length, 'capped', wraps.filter((w) => w.lines.length === 8).length);
