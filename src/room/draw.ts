import {
  BoxGeometry,
  BufferGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Quaternion,
  Vector3,
} from 'three';
import type { RoomBox, RoomPlane } from './types';

const wall = new LineBasicMaterial({ color: 0x00c8ff });
const floor = new LineBasicMaterial({ color: 0x40ff80 });
const furniture = new LineBasicMaterial({ color: 0xffa040 });

// Plane outlines as wireframe (floor green, the rest cyan), in the planes' own frame.
// Returns how many outlines could be drawn.
export function drawPlanes(planes: RoomPlane[], into: Group): number {
  let drawn = 0;
  for (const p of planes) {
    if (!p.poly || !p.quat || p.poly.length < 6) continue;
    const pts: Vector3[] = [];
    for (let i = 0; i < p.poly.length; i += 2) pts.push(new Vector3(p.poly[i], 0, p.poly[i + 1]));
    const line = new LineLoop(new BufferGeometry().setFromPoints(pts), p.label === 'floor' ? floor : wall);
    line.matrixAutoUpdate = false;
    line.matrix.compose(new Vector3(...p.pos), new Quaternion(...p.quat), new Vector3(1, 1, 1));
    into.add(line);
    drawn++;
  }
  return drawn;
}

// Furniture volumes as wireframe boxes: all 12 edges (orange), in the boxes' own frame.
export function drawBoxes(boxes: RoomBox[], into: Group): number {
  for (const b of boxes) {
    const size = new Vector3(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const centre = new Vector3(b.min[0] + size.x / 2, b.min[1] + size.y / 2, b.min[2] + size.z / 2);
    const geo = new EdgesGeometry(new BoxGeometry(size.x, size.y, size.z));
    geo.translate(centre.x, centre.y, centre.z);
    const edges = new LineSegments(geo, furniture);
    edges.matrixAutoUpdate = false;
    edges.matrix.compose(new Vector3(...b.pos), new Quaternion(...b.quat), new Vector3(1, 1, 1));
    into.add(edges);
  }
  return boxes.length;
}
