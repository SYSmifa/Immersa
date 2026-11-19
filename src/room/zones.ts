import { modelSolid, type P2, type Solid } from './measure';
import type { RoomModel, Vec3 } from './types';

// Zone di rispetto: the free space a model asks for around itself (maintenance, safety). It is a rectangle in plan, `f` / `b` / `l` / `r`
// metres beyond the model's box at its front (+Z of the file), back (-Z), left (-X) and right (+X), as high as the model. It turns and
// moves with the model. Another model that touches it invades it. Everything is in the room's frame.

export type Zone = NonNullable<RoomModel['zone']>;
export const DEFAULT_ZONE_M = 1;
export const uniformZone = (m: number): Zone => ({ f: m, b: m, l: m, r: m });

// The zone as a solid (like the model's own), from the model's box `lo`/`hi` in its own frame at scale 1.
export function zoneSolid(m: RoomModel, lo: Vec3, hi: Vec3): Solid | null {
  const z = m.zone;
  if (!z) return null;
  const k = 1 / Math.max(1e-6, m.scale); // margins are in metres, the box is at scale 1
  return modelSolid({ ...m, id: `zone:${m.id}`, name: m.name }, [lo[0] - z.l * k, lo[1], lo[2] - z.b * k], [hi[0] + z.r * k, hi[1], hi[2] + z.f * k]);
}

const EPS = 1e-4;
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];

// Do two solids overlap (in plan, as oriented rectangles, and in height)? Touching is not overlapping.
export function solidsOverlap(a: Solid, b: Solid): boolean {
  if (a.y1 <= b.y0 + EPS || b.y1 <= a.y0 + EPS) return false;
  const va: P2 = [-a.u[1], a.u[0]];
  const vb: P2 = [-b.u[1], b.u[0]];
  const d: P2 = [b.c[0] - a.c[0], b.c[1] - a.c[1]];
  for (const axis of [a.u, va, b.u, vb]) {
    const ra = a.hu * Math.abs(dot(a.u, axis)) + a.hv * Math.abs(dot(va, axis));
    const rb = b.hu * Math.abs(dot(b.u, axis)) + b.hv * Math.abs(dot(vb, axis));
    if (Math.abs(dot(d, axis)) >= ra + rb - EPS) return false;
  }
  return true;
}

export interface ZoneState {
  id: string; // the model that owns the zone
  name: string;
  solid: Solid;
  invaders: string[]; // names of the models that are inside it
}

// Every zone of the given models (those with `zone`), and who invades it. `boxOf` gives a model's box (null while it loads); only
// models of the same room are compared (their coordinates are in the same frame).
export function zoneStates(models: RoomModel[], boxOf: (m: RoomModel) => { min: Vec3; max: Vec3 } | null): ZoneState[] {
  const solids = new Map<string, Solid>();
  for (const m of models) {
    const b = boxOf(m);
    if (b) solids.set(m.id, modelSolid(m, b.min, b.max));
  }
  const out: ZoneState[] = [];
  for (const m of models) {
    const b = m.zone ? boxOf(m) : null;
    const zs = b ? zoneSolid(m, b.min, b.max) : null;
    if (!zs) continue;
    const invaders = models.filter((o) => o.id !== m.id && o.roomId === m.roomId && solids.has(o.id) && solidsOverlap(zs, solids.get(o.id)!)).map((o) => o.name);
    out.push({ id: m.id, name: m.name, solid: zs, invaders });
  }
  return out;
}

// "Banco invade la zona di Pressa" lines, for the lists.
export const invasionTexts = (states: ZoneState[]): string[] => states.flatMap((z) => z.invaders.map((n) => `${n} invade la zona di ${z.name}`));
