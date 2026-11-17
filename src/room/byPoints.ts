import { Matrix4, Quaternion, Vector3 } from 'three';
import type { RoomPlane, RoomRef, RoomScan, Vec3 } from './types';

// A room made from points touched along its perimeter (no headset scan): the floor polygon and one wall per side, in the same
// format as a scanned room, so it opens, draws and hides models behind its walls like any other. The room's frame is the
// session's at the time of creation (like a fresh scan).
export const WALL_HEIGHT = 3; // m, default
export const MIN_CONTOUR = 3;
export const MIN_CONTOUR_GAP = 0.3; // m between two consecutive points

// The two points farthest apart: "opposite", so that touching just them again fixes the room's position and turn.
export function oppositePair(pts: Vec3[]): [number, number] {
  let best: [number, number] = [0, Math.min(1, pts.length - 1)];
  let far = -1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][2] - pts[j][2]);
      if (d > far) {
        far = d;
        best = [i, j];
      }
    }
  }
  return best;
}

export function planesFromPoints(pts: Vec3[], floorY: number, height = WALL_HEIGHT): RoomPlane[] {
  const planes: RoomPlane[] = [];
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
  planes.push({ label: 'floor', pos: [cx, floorY, cz], quat: [0, 0, 0, 1], poly: pts.flatMap((p) => [p[0] - cx, p[2] - cz]) });
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (len < 1e-3) continue;
    const t = new Vector3((b[0] - a[0]) / len, 0, (b[2] - a[2]) / len); // along the wall
    const n = new Vector3(t.z, 0, -t.x); // plane normal (local Y), horizontal
    const up = new Vector3(0, 1, 0); // local Z
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(t, n, up));
    planes.push({
      label: 'wall',
      pos: [(a[0] + b[0]) / 2, floorY + height / 2, (a[2] + b[2]) / 2],
      quat: [q.x, q.y, q.z, q.w],
      poly: [-len / 2, -height / 2, len / 2, -height / 2, len / 2, height / 2, -len / 2, height / 2],
    });
  }
  return planes;
}

// The scan of a room made from `points` (names kept): `refs` are the two opposite ones, the points to touch again to place it.
export function scanFromPoints(points: RoomRef[], floorY: number, height = WALL_HEIGHT): RoomScan {
  const [i, j] = oppositePair(points.map((p) => p.pos));
  return {
    version: 1,
    savedAt: Date.now(),
    planes: planesFromPoints(points.map((p) => p.pos), floorY, height),
    boxes: [],
    refs: [points[i], points[j]].map((p) => ({ pos: [...p.pos] as Vec3, ...(p.name ? { name: p.name } : {}) })),
    contour: points.map((p) => ({ pos: [...p.pos] as Vec3, ...(p.name ? { name: p.name } : {}) })),
    height,
  };
}
