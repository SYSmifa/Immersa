import { BufferGeometry, Group, LineBasicMaterial, LineLoop, Points, PointsMaterial, Quaternion, Vector3 } from 'three';
import type { RoomPlane } from './types';

const wall = new LineBasicMaterial({ color: 0x00c8ff });
const floor = new LineBasicMaterial({ color: 0x40ff80 });

// Plane outlines as wireframe (floor green, the rest cyan), in the planes' own frame.
// Returns how many outlines could be drawn. With markCentres, plane centres get yellow dots.
export function drawPlanes(planes: RoomPlane[], into: Group, markCentres = false): number {
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
  if (markCentres) {
    const centres = planes.map((p) => new Vector3(...p.pos));
    const mat = new PointsMaterial({ color: 0xffd000, size: 8, sizeAttenuation: false });
    into.add(new Points(new BufferGeometry().setFromPoints(centres), mat));
  }
  return drawn;
}
