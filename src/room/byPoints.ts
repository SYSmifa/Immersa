import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Opening, RoomPlane, RoomRef, RoomScan, Vec3 } from './types';

// A room made from points touched along its perimeter (no headset scan): the floor polygon and one wall per side, in the same
// format as a scanned room, so it opens, draws and hides models behind its walls like any other. The room's frame is the
// session's at the time of creation (like a fresh scan).
export const WALL_HEIGHT = 3; // m, default
export const MIN_CONTOUR = 3;
export const MIN_CONTOUR_GAP = 0.01; // m between two consecutive points

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

export const DOOR = { w: 0.9, h: 2.1, sill: 0 };
export const WINDOW = { w: 1.2, h: 1.2, sill: 0.9 };
export const MIN_OPENING = 0.3; // m, narrowest and lowest opening
const MIN_PIECE = 0.005;

export const sideLength = (pts: Vec3[], i: number) => {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  return Math.hypot(b[0] - a[0], b[2] - a[2]);
};

// The openings that fit the room: on an existing side, inside it, under the ceiling and not on top of each other (a later one that
// overlaps an earlier one is dropped). Sorted by side, then along the side.
export function fitOpenings(openings: Opening[] | undefined, pts: Vec3[], height: number): Opening[] {
  const out: Opening[] = [];
  const sorted = [...(openings ?? [])].filter((o) => Number.isInteger(o.wall) && o.wall >= 0 && o.wall < pts.length).sort((a, b) => a.wall - b.wall || a.at - b.at);
  for (const o of sorted) {
    const len = sideLength(pts, o.wall);
    const w = Math.min(Math.max(MIN_OPENING, o.w), len);
    const sill = Math.max(0, o.sill);
    const h = Math.min(Math.max(MIN_OPENING, o.h), height - sill);
    if (len < MIN_OPENING || h < MIN_OPENING) continue;
    const at = Math.min(len - w / 2, Math.max(w / 2, o.at));
    const prev = out[out.length - 1];
    if (prev && prev.wall === o.wall && at - w / 2 < prev.at + prev.w / 2 - 1e-6) continue;
    out.push({ ...o, w, h, sill, at });
  }
  return out;
}

export function planesFromPoints(pts: Vec3[], floorY: number, height = WALL_HEIGHT, openings?: Opening[]): RoomPlane[] {
  const planes: RoomPlane[] = [];
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
  planes.push({ label: 'floor', pos: [cx, floorY, cz], quat: [0, 0, 0, 1], poly: pts.flatMap((p) => [p[0] - cx, p[2] - cz]) });
  const fitted = fitOpenings(openings, pts, height);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (len < 1e-3) continue;
    const t = new Vector3((b[0] - a[0]) / len, 0, (b[2] - a[2]) / len); // along the wall
    const n = new Vector3(t.z, 0, -t.x); // plane normal (local Y), horizontal
    const up = new Vector3(0, 1, 0); // local Z
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(t, n, up));
    // The wall as rectangles [x0, x1] x [y0, y1] (m along the side, m above the floor): the whole side, or what is left around the
    // openings (the pieces between them, and above / below each one).
    const rects: [number, number, number, number][] = [];
    let x = 0;
    for (const o of fitted.filter((f) => f.wall === i)) {
      const x0 = o.at - o.w / 2;
      const x1 = o.at + o.w / 2;
      if (x0 - x > MIN_PIECE) rects.push([x, x0, 0, height]);
      if (o.sill > MIN_PIECE) rects.push([x0, x1, 0, o.sill]);
      if (height - (o.sill + o.h) > MIN_PIECE) rects.push([x0, x1, o.sill + o.h, height]);
      x = x1;
    }
    if (len - x > MIN_PIECE) rects.push([x, len, 0, height]);
    for (const [x0, x1, y0, y1] of rects) {
      const mx = (x0 + x1) / 2;
      const hw = (x1 - x0) / 2;
      const hh = (y1 - y0) / 2;
      planes.push({
        label: 'wall',
        pos: [a[0] + t.x * mx, floorY + (y0 + y1) / 2, a[2] + t.z * mx],
        quat: [q.x, q.y, q.z, q.w],
        poly: [-hw, -hh, hw, -hh, hw, hh, -hw, hh],
      });
    }
  }
  return planes;
}

// The scan of a room made from `points` (names kept): `refs` are the two opposite ones, the points to touch again to place it.
export function scanFromPoints(points: RoomRef[], floorY: number, height = WALL_HEIGHT, openings?: Opening[]): RoomScan {
  const [i, j] = oppositePair(points.map((p) => p.pos));
  const fitted = fitOpenings(openings, points.map((p) => p.pos), height);
  return {
    version: 1,
    savedAt: Date.now(),
    planes: planesFromPoints(points.map((p) => p.pos), floorY, height, fitted),
    boxes: [],
    refs: [points[i], points[j]].map((p) => ({ pos: [...p.pos] as Vec3, ...(p.name ? { name: p.name } : {}) })),
    contour: points.map((p) => ({ pos: [...p.pos] as Vec3, ...(p.name ? { name: p.name } : {}) })),
    height,
    ...(fitted.length ? { openings: fitted } : {}),
  };
}
