import { formatLength, type Measure } from './measure';
import type { Annotation, Vec3 } from './types';

// Notes and rulers left in a project: what they look like as data, and how they turn into things to draw (the same lines and
// labels as the measures, see measure.ts). Pure, no drawing here.

export const ANNOTATION_COLORS = ['#ffb020', '#2dd4bf', '#ff6b6b', '#8b9cff'];
export const DEFAULT_COLOR = ANNOTATION_COLORS[0];
const PIN = 0.04; // m, half size of the cross that marks a point

const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newAnnotation(kind: Annotation['kind'], roomId: string, a: Vec3, b?: Vec3, text = ''): Annotation {
  return { id: newId(), roomId, kind, a: [...a], ...(kind === 'ruler' && b ? { b: [...b] as Vec3 } : {}), text, color: DEFAULT_COLOR };
}

// A ruler's length in metres; null for a note.
export function annotationLength(a: Annotation): number | null {
  return a.kind === 'ruler' && a.b ? Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1], a.b[2] - a.a[2]) : null;
}

// What its label says: the length (and the text, if any) for a ruler, the text for a note.
export function annotationLabel(a: Annotation): string {
  const len = annotationLength(a);
  const text = a.text.trim();
  if (len === null) return text || 'Nota';
  return text ? `${formatLength(len)} · ${text}` : formatLength(len);
}

// The name it has in lists.
export const annotationName = (a: Annotation) => (a.kind === 'ruler' ? `Metro ${formatLength(annotationLength(a) ?? 0)}` : a.text.trim() ? `Nota: ${a.text.trim().slice(0, 24)}` : 'Nota');

function cross(p: Vec3, owner: string, color: string): Measure[] {
  const seg = (dx: number, dy: number, dz: number): Measure => ({ kind: 'pin', a: [p[0] - dx, p[1] - dy, p[2] - dz], b: [p[0] + dx, p[1] + dy, p[2] + dz], text: '', owner, color });
  return [seg(PIN, 0, 0), seg(0, PIN, 0), seg(0, 0, PIN)];
}

// Things to draw for one annotation, in its room's frame.
export function annotationMeasures(a: Annotation): Measure[] {
  const color = a.color || DEFAULT_COLOR;
  if (a.kind === 'note' || !a.b) return [...cross(a.a, a.id, color), { kind: 'note', a: a.a, b: a.a, text: annotationLabel(a), owner: a.id, color }];
  return [...cross(a.a, a.id, color), ...cross(a.b, a.id, color), { kind: 'ruler', a: a.a, b: a.b, text: annotationLabel(a), owner: a.id, color }];
}

// A copy for another project: new id, same content.
export const copyAnnotation = (a: Annotation, i = 0): Annotation => ({ ...structuredClone(a), id: `${newId()}${i}` });
