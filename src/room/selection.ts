import { Box3, DoubleSide, Material, Matrix4, Mesh, MeshBasicMaterial, Object3D, Ray, Vector3 } from 'three';

// The selected model is drawn with a semi-transparent light-blue material (no extra geometry, so no extra triangles);
// the original materials come back when it is deselected.
export const SELECT_COLOR = 0x35b8ff;
const selectedMaterial = new MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.55, side: DoubleSide });
const ORIGINAL = 'originalMaterial';

// Returns false while the model has no geometry yet.
export function applySelectionLook(holder: Object3D): boolean {
  let any = false;
  holder.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    any = true;
    if (!m.userData[ORIGINAL]) m.userData[ORIGINAL] = m.material;
    m.material = selectedMaterial;
  });
  return any;
}

export function clearSelectionLook(holder: Object3D) {
  holder.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && m.userData[ORIGINAL]) {
      m.material = m.userData[ORIGINAL] as Material | Material[];
      delete m.userData[ORIGINAL];
    }
  });
}

// Picking uses the model's bounding box (in its own frame), not its triangles: a laser on a model with hundreds of
// thousands of triangles would cost the frame rate every frame.
const BOX = 'localBox';
const inv = new Matrix4();
const local = new Ray();
const hit = new Vector3();

function localBox(holder: Object3D): Box3 | null {
  let box = holder.userData[BOX] as Box3 | undefined;
  if (box) return box;
  holder.updateWorldMatrix(true, true);
  inv.copy(holder.matrixWorld).invert();
  const m = new Matrix4();
  box = new Box3();
  holder.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    m.multiplyMatrices(inv, mesh.matrixWorld);
    box!.union(mesh.geometry.boundingBox!.clone().applyMatrix4(m));
  });
  if (box.isEmpty()) return null; // not loaded yet: try again next frame
  holder.userData[BOX] = box;
  return box;
}

// Distance along a world-space ray to the model's box, or null. The ray direction must be normalised.
export function pickDistance(holder: Object3D, origin: Vector3, dir: Vector3): number | null {
  const box = localBox(holder);
  if (!box) return null;
  holder.updateWorldMatrix(true, false);
  inv.copy(holder.matrixWorld).invert();
  local.set(origin, dir).applyMatrix4(inv); // scale in the holder matrix changes the length of the direction
  const p = local.intersectBox(box, hit);
  if (!p) return null;
  return p.applyMatrix4(holder.matrixWorld).distanceTo(origin);
}
