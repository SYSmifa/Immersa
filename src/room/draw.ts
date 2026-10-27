import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { RoomBox, RoomPlane } from './types';

const wall = new LineBasicMaterial({ color: 0x00c8ff });
const floor = new LineBasicMaterial({ color: 0x40ff80 });
const furniture = new LineBasicMaterial({ color: 0xffa040 });

const fill = (color: number, opacity: number) =>
  new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide });
const floorFill = fill(0x40ff80, 0.18);
const wallFill = fill(0x00c8ff, 0.06);
const boxFill = fill(0xffa040, 0.2);

// The room's shell, which can be hidden to look into the room from above.
// The ceiling is never drawn: it only gets in the way.
const SHELL = new Set(['wall', 'door', 'window', 'wall face', 'invisible wall']);

// A furniture plane (a table top, a couch seat) is redundant when the same piece of
// furniture already has its box: skip planes whose centre lies inside (or on) a box.
function coveredByBox(p: RoomPlane, boxes: RoomBox[]): boolean {
  const SLACK = 0.1; // m
  return boxes.some((b) => {
    const local = new Vector3(...p.pos).sub(new Vector3(...b.pos)).applyQuaternion(new Quaternion(...b.quat).invert());
    return (
      local.x >= b.min[0] - SLACK && local.x <= b.max[0] + SLACK &&
      local.y >= b.min[1] - SLACK && local.y <= b.max[1] + SLACK &&
      local.z >= b.min[2] - SLACK && local.z <= b.max[2] + SLACK
    );
  });
}

// Plane outlines as wireframe (floor green, the rest cyan), in the planes' own frame.
// With `solid`, floor and shell planes also get a faint translucent fill.
// Shell planes (walls, doors, windows) go into the returned group so they can be hidden.
// Furniture planes that already have a box in `boxes` are not drawn twice.
export function drawPlanes(planes: RoomPlane[], into: Group, solid = false, boxes: RoomBox[] = []): { drawn: number; shell: Group } {
  const shell = new Group();
  into.add(shell);
  let drawn = 0;
  for (const p of planes) {
    if (!p.poly || !p.quat || p.poly.length < 6) continue;
    if (p.label === 'ceiling') continue;
    const isShell = SHELL.has(p.label);
    const isFloor = p.label === 'floor';
    if (!isShell && !isFloor && coveredByBox(p, boxes)) continue;
    const target = isShell ? shell : into;
    const pts: Vector3[] = [];
    for (let i = 0; i < p.poly.length; i += 2) pts.push(new Vector3(p.poly[i], 0, p.poly[i + 1]));
    const place = (o: Object3D) => {
      o.matrixAutoUpdate = false;
      o.matrix.compose(new Vector3(...p.pos), new Quaternion(...p.quat!), new Vector3(1, 1, 1));
      target.add(o);
    };
    place(new LineLoop(new BufferGeometry().setFromPoints(pts), isFloor ? floor : wall));
    if (solid && (isFloor || isShell)) {
      // Triangulated in (x, z) of the plane's own frame.
      const geo = new ShapeGeometry(new Shape(pts.map((v) => new Vector2(v.x, v.z))));
      geo.rotateX(Math.PI / 2);
      const mesh = new Mesh(geo, isFloor ? floorFill : wallFill);
      mesh.renderOrder = -1;
      place(mesh);
    }
    drawn++;
  }
  return { drawn, shell };
}

// Furniture volumes as boxes: all 12 edges (orange), optionally with a translucent fill.
export function drawBoxes(boxes: RoomBox[], into: Group, solid = false): number {
  for (const b of boxes) {
    const size = new Vector3(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const centre = new Vector3(b.min[0] + size.x / 2, b.min[1] + size.y / 2, b.min[2] + size.z / 2);
    const box = new BoxGeometry(size.x, size.y, size.z).translate(centre.x, centre.y, centre.z);
    const parts: Object3D[] = [new LineSegments(new EdgesGeometry(box), furniture)];
    if (solid) {
      const mesh = new Mesh(box, boxFill);
      mesh.renderOrder = -1;
      parts.push(mesh);
    }
    for (const o of parts) {
      o.matrixAutoUpdate = false;
      o.matrix.compose(new Vector3(...b.pos), new Quaternion(...b.quat), new Vector3(1, 1, 1));
      into.add(o);
    }
  }
  return boxes.length;
}
