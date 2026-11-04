import { Box3, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import type { PartEdit } from './types';

// Components of a model = nodes of the loaded file. A component is named by its path: the child indices from the file's
// scene root ("0/2" = third child of the first child). Moving a component changes its own matrix only; the model's
// holder, picking box and the other components stay as they are.
const ORIG = 'origMatrix';
const PIVOT = 'pivot0';

// The file's scene: holder > wrapper (centres the model) > scene root > nodes.
export function sceneRoot(holder: Object3D): Object3D | null {
  return holder.children[0]?.children[0] ?? null;
}

export function pathOf(holder: Object3D, node: Object3D): string | null {
  const root = sceneRoot(holder);
  const idx: number[] = [];
  let o: Object3D | null = node;
  while (o && o !== root) {
    if (!o.parent) return null;
    idx.unshift(o.parent.children.indexOf(o));
    o = o.parent;
  }
  return o === root && idx.length ? idx.join('/') : null;
}

export function nodeByPath(holder: Object3D, path: string): Object3D | null {
  let o = sceneRoot(holder);
  for (const i of path.split('/')) {
    o = o?.children[Number(i)] ?? null;
    if (!o) return null;
  }
  return o;
}

// The component that a hit mesh belongs to: wrappers with a single child are skipped, so a door made of a group with one
// panel inside is one component. Picking the component that is already chosen goes up one level (its parent), if any.
export function partFromMesh(holder: Object3D, mesh: Object3D, current: string | null): string | null {
  const root = sceneRoot(holder);
  if (!root) return null;
  let node: Object3D = mesh;
  while (node.parent && node.parent !== root && node.parent.children.length === 1) node = node.parent;
  let path = pathOf(holder, node);
  if (path && path === current) {
    const up = node.parent && node.parent !== root ? pathOf(holder, node.parent) : null;
    if (up) path = up;
  }
  return path;
}

// Where the component was in the file: kept the first time it is touched.
function original(node: Object3D): Matrix4 {
  return (node.userData[ORIG] ??= node.matrix.clone()) as Matrix4;
}

// Bottom centre of the component's footprint, in the holder's frame, as it is in the file (a point on the floor
// under the component, which is where its gizmo and its turning / scaling are centred).
export function pivotOf(holder: Object3D, node: Object3D): Vector3 {
  let p = node.userData[PIVOT] as Vector3 | undefined;
  if (p) return p;
  const m0 = original(node);
  const now = node.matrix.clone();
  node.matrix.copy(m0);
  node.matrix.decompose(node.position, node.quaternion, node.scale);
  holder.updateWorldMatrix(true, true);
  const inv = new Matrix4().copy(holder.matrixWorld).invert();
  const box = new Box3();
  const m = new Matrix4();
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    m.multiplyMatrices(inv, mesh.matrixWorld);
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(m));
  });
  p = box.isEmpty() ? new Vector3() : new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  node.userData[PIVOT] = p;
  node.matrix.copy(now);
  node.matrix.decompose(node.position, node.quaternion, node.scale);
  return p;
}

const EDITED = 'partEdited';
// Puts every component where `parts` says (and the others back where the file had them). Cheap when nothing changes.
export function applyParts(holder: Object3D, parts: Record<string, PartEdit> | undefined) {
  const keys = Object.keys(parts ?? {}).filter((k) => {
    const e = parts![k];
    return e.d || e.yaw || (e.scale !== undefined && e.scale !== 1);
  });
  // Put back what was moved before.
  const before = (holder.userData[EDITED] as string[] | undefined) ?? [];
  for (const k of before) {
    const n = nodeByPath(holder, k);
    const m0 = n?.userData[ORIG] as Matrix4 | undefined;
    if (n && m0) {
      n.matrix.copy(m0);
      n.matrix.decompose(n.position, n.quaternion, n.scale);
    }
  }
  holder.updateWorldMatrix(true, true);
  const inv = new Matrix4();
  const pr = new Matrix4();
  const M = new Matrix4();
  const T = new Matrix4();
  const R = new Matrix4();
  const S = new Matrix4();
  // Outer components first, so an inner one is moved inside its already moved parent.
  for (const k of keys.sort((a, b) => a.split('/').length - b.split('/').length)) {
    const n = nodeByPath(holder, k);
    if (!n?.parent) continue;
    const c = pivotOf(holder, n);
    const e = parts![k];
    original(n);
    n.parent.updateWorldMatrix(true, false);
    inv.copy(holder.matrixWorld).invert();
    pr.multiplyMatrices(inv, n.parent.matrixWorld); // the parent's frame inside the holder
    const s = e.scale ?? 1;
    M.makeTranslation(...(e.d ?? [0, 0, 0]))
      .multiply(T.makeTranslation(c.x, c.y, c.z))
      .multiply(R.makeRotationY(e.yaw ?? 0))
      .multiply(S.makeScale(s, s, s))
      .multiply(T.makeTranslation(-c.x, -c.y, -c.z));
    n.matrix.copy(pr).invert().multiply(M).multiply(pr).multiply(n.userData[ORIG] as Matrix4);
    n.matrix.decompose(n.position, n.quaternion, n.scale);
    n.updateWorldMatrix(false, true);
  }
  holder.userData[EDITED] = keys;
  delete holder.userData.localBox; // the picking box grows or shrinks with the moved components
  holder.userData.partsMoved = keys.length > 0;
}

// Names for the UI: the node's own name, else its kind and index.
export function partName(node: Object3D): string {
  return node.name?.replace(/_/g, ' ').trim() || `Componente ${node.parent ? node.parent.children.indexOf(node) + 1 : ''}`.trim();
}

// World position of a component's pivot, after its edit.
export function pivotWorld(holder: Object3D, node: Object3D, edit: PartEdit | undefined): Vector3 {
  const c = pivotOf(holder, node).clone();
  if (edit?.d) c.add(new Vector3(...edit.d));
  holder.updateWorldMatrix(true, false);
  return holder.localToWorld(c);
}
