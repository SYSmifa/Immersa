import type { RoomPlane, Vec3 } from './types';

// Middle of the floor, on the floor (falls back to the lowest plane when no floor is labelled).
export function floorCentre(planes: RoomPlane[]): Vec3 {
  const floors = planes.filter((p) => p.label === 'floor');
  const src = floors.length ? floors : planes;
  if (!src.length) return [0, 0, 0];
  const mean = (i: number) => src.reduce((a, p) => a + p.pos[i], 0) / src.length;
  return [mean(0), floors.length ? mean(1) : Math.min(...src.map((p) => p.pos[1])), mean(2)];
}
