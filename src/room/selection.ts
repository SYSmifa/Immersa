import { Box3, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

// Light-blue outline for the selected model: the edges of its bounding box (in the model's own frame, so it follows
// move / rotate / scale), drawn as strips of fixed width in metres because 1 px lines are hard to see in the headset.
export const SELECT_COLOR = 0x35b8ff;
const WIDTH = 0.012;
const material = new LineMaterial({ color: SELECT_COLOR, linewidth: WIDTH, worldUnits: true, depthTest: false });

const EDGES: [number, number][] = [
  [0, 1], [1, 3], [3, 2], [2, 0], // bottom
  [4, 5], [5, 7], [7, 6], [6, 4], // top
  [0, 4], [1, 5], [2, 6], [3, 7], // verticals
];

// Bounding box of everything under `holder`, in the holder's local frame (null while nothing is loaded yet).
export function localBox(holder: Object3D): Box3 | null {
  holder.updateWorldMatrix(true, true);
  const inv = new Matrix4().copy(holder.matrixWorld).invert();
  const box = new Box3();
  const m = new Matrix4();
  holder.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || o.userData.selectionOutline) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    m.multiplyMatrices(inv, mesh.matrixWorld);
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(m));
  });
  return box.isEmpty() ? null : box;
}

// Adds the outline to `holder`; returns it, or null if the model has no geometry yet.
export function addOutline(holder: Object3D): Object3D | null {
  const box = localBox(holder);
  if (!box) return null;
  const pad = 0.01;
  const min = box.min.clone().subScalar(pad);
  const max = box.max.clone().addScalar(pad);
  const corner = (i: number) => new Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
  const pts: number[] = [];
  for (const [a, b] of EDGES) pts.push(...corner(a).toArray(), ...corner(b).toArray());
  const lines = new LineSegments2(new LineSegmentsGeometry().setPositions(pts), material);
  lines.userData.selectionOutline = true;
  lines.raycast = () => undefined; // never picked
  lines.renderOrder = 999;
  holder.add(lines);
  return lines;
}

export function removeOutline(holder: Object3D) {
  for (const c of [...holder.children]) {
    if (!c.userData.selectionOutline) continue;
    holder.remove(c);
    (c as LineSegments2).geometry.dispose();
  }
}
