import { Quaternion, Vector3 } from 'three';
import type { RoomPlane } from './types';

// How big a scanned space is, to know when reference points are mandatory (see room/refs.ts). The thresholds are LOW on purpose
// while testing in a living room; raise them (a hangar is hundreds of m2) once the field tests say where Meta's walls stop being true.
export const BIG_AREA = 30; // m2 of floor
export const BIG_SIDE = 12; // m: longest side of the floor's bounding box

export interface SpaceSize {
  area: number; // m2
  side: number; // m, longest side of the bounding box
}

export function floorPoints(planes: RoomPlane[]): [number, number][][] {
  const polys: [number, number][][] = [];
  for (const p of planes) {
    if (p.label !== 'floor' || !p.quat || !p.poly || p.poly.length < 6) continue;
    const q = new Quaternion(...p.quat);
    const c = new Vector3(...p.pos);
    const pts: [number, number][] = [];
    for (let i = 0; i < p.poly.length; i += 2) {
      const v = new Vector3(p.poly[i], 0, p.poly[i + 1]).applyQuaternion(q).add(c);
      pts.push([v.x, v.z]);
    }
    polys.push(pts);
  }
  return polys;
}

const shoelace = (pts: [number, number][]) => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    s += x1 * z2 - x2 * z1;
  }
  return Math.abs(s) / 2;
};

// The floor's area and longest side; with no floor plane, the walls' bounding box stands in for both.
export function spaceSize(planes: RoomPlane[]): SpaceSize {
  const polys = floorPoints(planes);
  let pts: [number, number][];
  let area: number;
  if (polys.length) {
    pts = polys.flat();
    area = polys.reduce((a, p) => a + shoelace(p), 0);
  } else {
    pts = planes.filter((p) => p.label === 'wall').map((p) => [p.pos[0], p.pos[2]] as [number, number]);
    area = 0;
  }
  if (pts.length < 2) return { area: 0, side: 0 };
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const d = Math.max(...zs) - Math.min(...zs);
  return { area: area || w * d, side: Math.max(w, d) };
}

export function isBigSpace(planes: RoomPlane[]): boolean {
  const s = spaceSize(planes);
  return s.area >= BIG_AREA || s.side >= BIG_SIDE;
}
