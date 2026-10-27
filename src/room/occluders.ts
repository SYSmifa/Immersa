import { DoubleSide, Group, Mesh, MeshBasicMaterial, Path, Quaternion, Shape, ShapeGeometry, Vector2, Vector3 } from 'three';
import { planeNormal } from './align';
import { floorCentre } from './floor';
import type { RoomPlane } from './types';

const SURFACES = new Set(['floor', 'ceiling', 'wall', 'wall face', 'invisible wall']);
const OPENINGS = new Set(['door', 'window']);
const OUTSET = 0.05; // m: surfaces move this far away from the room's inside, so models touching a wall are not clipped
const EDGE = 0.001; // m: openings are kept this far inside their wall so they never touch its border

// Draws nothing but hides every virtual object behind it: the passthrough stays visible.
export function createOccluderMaterial() {
  return new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
}

// Debug view: show the occluders as a tinted translucent surface.
export function showOccluders(material: MeshBasicMaterial, on: boolean) {
  material.colorWrite = on;
  material.transparent = on;
  material.opacity = on ? 0.22 : 1;
  material.color.set(0xff40a0);
  material.needsUpdate = true;
}

// A room's shell (floor, ceiling, walls) as depth-only surfaces, in the planes' own frame, with
// doors and windows cut out as openings so the next room can be seen through them.
// Drawn before everything else, they hide the models of the other rooms behind the walls.
export function buildOccluders(planes: RoomPlane[], material: MeshBasicMaterial): Group {
  const group = new Group();
  const surfaces = planes.filter((p) => SURFACES.has(p.label) && p.quat && (p.poly?.length ?? 0) >= 6);
  if (!surfaces.length) return group;
  const [cx, floorY, cz] = floorCentre(planes);
  const ceiling = planes.find((p) => p.label === 'ceiling');
  const centre = new Vector3(cx, ceiling ? (floorY + ceiling.pos[1]) / 2 : floorY + 1.3, cz);
  const openings = planes.filter((p) => OPENINGS.has(p.label) && p.quat && (p.poly?.length ?? 0) >= 6);

  for (const p of surfaces) {
    const q = new Quaternion(...p.quat!);
    const pos = new Vector3(...p.pos);
    const outer = pairs(p.poly!);
    const shape = new Shape(outer);

    // Openings lying in this plane become holes.
    const inv = q.clone().invert();
    const xs = outer.map((v) => v.x);
    const zs = outer.map((v) => v.y);
    const [x0, x1, z0, z1] = [Math.min(...xs) + EDGE, Math.max(...xs) - EDGE, Math.min(...zs) + EDGE, Math.max(...zs) - EDGE];
    for (const d of openings) {
      const dq = new Quaternion(...d.quat!);
      const dpos = new Vector3(...d.pos);
      const local = pairs(d.poly!).map((v) => new Vector3(v.x, 0, v.y).applyQuaternion(dq).add(dpos).sub(pos).applyQuaternion(inv));
      if (!local.every((v) => Math.abs(v.y) < 0.25)) continue; // not in this plane
      const hole = local.map((v) => new Vector2(Math.min(x1, Math.max(x0, v.x)), Math.min(z1, Math.max(z0, v.z))));
      if (Math.abs(area(hole)) > 0.01) shape.holes.push(new Path(hole));
    }

    const geo = new ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2); // shape (x, y) -> plane (x, 0, z)
    const mesh = new Mesh(geo, material);
    const n = new Vector3(...planeNormal(p.quat!));
    const away = Math.sign(n.dot(pos.clone().sub(centre))) || 1;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.compose(pos.clone().addScaledVector(n, away * OUTSET), q, new Vector3(1, 1, 1));
    mesh.renderOrder = -10; // before the models, so they are depth-tested against it
    group.add(mesh);
  }
  return group;
}

const pairs = (flat: number[]) => {
  const out: Vector2[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(new Vector2(flat[i], flat[i + 1]));
  return out;
};
const area = (pts: Vector2[]) => pts.reduce((s, p, i) => s + (pts[(i + 1) % pts.length].x * p.y - p.x * pts[(i + 1) % pts.length].y), 0) / 2;
