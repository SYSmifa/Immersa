import { Quaternion, Vector3 } from 'three';
import type { RoomBox, RoomPlane, Vec3 } from './types';

const NEAR = 0.3; // m: a floor outline counts if you are this close to it (scans have rough edges)
const EDGE = 0.6; // m: walls sit on the footprint's edge
const CEILING = 5; // m above the floor

type Pt = [number, number];

function floorOutline(f: RoomPlane): Pt[] {
  const q = new Quaternion(...f.quat!);
  const pts: Pt[] = [];
  for (let i = 0; i < f.poly!.length; i += 2) {
    const v = new Vector3(f.poly![i], 0, f.poly![i + 1]).applyQuaternion(q);
    pts.push([v.x + f.pos[0], v.z + f.pos[2]]);
  }
  return pts;
}

function distToSegment(px: number, pz: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2)) : 0;
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}

function nearPolygon(pts: Pt[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    if (distToSegment(x, z, pts[j], pts[i]) <= NEAR) return true;
  }
  return inside;
}

const area = (pts: Pt[]) =>
  Math.abs(pts.reduce((s, p, i) => s + (pts[(i + 1) % pts.length][0] * p[1] - p[0] * pts[(i + 1) % pts.length][1]), 0)) / 2;

// The headset reports the planes of every room stored on it. Keep only the ones of the room
// you are standing in: the floor under your head and what sits around that floor.
// Without any floor outline there is nothing to judge by, so everything is kept.
export function roomAround(planes: RoomPlane[], boxes: RoomBox[], head: Vec3): { planes: RoomPlane[]; boxes: RoomBox[] } {
  const floors = planes.filter((p) => p.label === 'floor' && p.quat && (p.poly?.length ?? 0) >= 6);
  if (!floors.length) return { planes, boxes };
  let best: { pts: Pt[]; y: number; size: number } | null = null;
  for (const f of floors) {
    const height = head[1] - f.pos[1];
    if (height < 0.2 || height > 3.2) continue; // not standing above this floor
    const pts = floorOutline(f);
    if (!nearPolygon(pts, head[0], head[2])) continue;
    const size = area(pts);
    if (!best || size < best.size) best = { pts, y: f.pos[1], size };
  }
  if (!best) return { planes: [], boxes: [] };
  const xs = best.pts.map((p) => p[0]);
  const zs = best.pts.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs) - EDGE, Math.max(...xs) + EDGE, Math.min(...zs) - EDGE, Math.max(...zs) + EDGE];
  const y = best.y;
  const here = (pos: Vec3) => pos[0] >= x0 && pos[0] <= x1 && pos[2] >= z0 && pos[2] <= z1 && pos[1] >= y - 0.4 && pos[1] <= y + CEILING;
  return { planes: planes.filter((p) => here(p.pos)), boxes: boxes.filter((b) => here(b.pos)) };
}

// Split everything the headset reports into one group of planes per room: a floor outline and
// what sits around it. Used to align a saved room to the right room among several.
// Without floor outlines the planes cannot be told apart, so they come back as one group.
export function roomClusters(planes: RoomPlane[]): RoomPlane[][] {
  const floors = planes.filter((p) => p.label === 'floor' && p.quat && (p.poly?.length ?? 0) >= 6);
  if (!floors.length) return [planes];
  return floors.map((f) => {
    const pts = floorOutline(f);
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs) - EDGE, Math.max(...xs) + EDGE, Math.min(...zs) - EDGE, Math.max(...zs) + EDGE];
    const y = f.pos[1];
    return planes.filter((p) => p.pos[0] >= x0 && p.pos[0] <= x1 && p.pos[2] >= z0 && p.pos[2] <= z1 && p.pos[1] >= y - 0.4 && p.pos[1] <= y + CEILING);
  });
}
