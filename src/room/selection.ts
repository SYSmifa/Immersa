import { Box3, BufferGeometry, DoubleSide, Material, Matrix4, Mesh, MeshBasicMaterial, Object3D, Ray, Raycaster, Vector3 } from 'three';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';

// Triangle-accurate picking stays cheap with a bounding volume hierarchy per geometry (built once, shared by clones).
Mesh.prototype.raycast = acceleratedRaycast;
(BufferGeometry.prototype as { computeBoundsTree?: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;
const picker = new Raycaster();
(picker as unknown as { firstHitOnly: boolean }).firstHitOnly = true;

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

// Picking: the model's bounding box (in its own frame) rejects most rays at once; only a ray that enters the box is
// tested against the triangles, through the BVH.
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
    const g = mesh.geometry as BufferGeometry & { boundsTree?: unknown; computeBoundsTree?: () => void };
    if (!g.boundsTree) g.computeBoundsTree?.();
    m.multiplyMatrices(inv, mesh.matrixWorld);
    box!.union(mesh.geometry.boundingBox!.clone().applyMatrix4(m));
  });
  if (box.isEmpty()) return null; // not loaded yet: try again next frame
  holder.userData[BOX] = box;
  return box;
}

// Distance along a world-space ray to the model's surface, or null. The ray direction must be normalised.
export function pickDistance(holder: Object3D, origin: Vector3, dir: Vector3, far: number): number | null {
  const box = localBox(holder);
  if (!box) return null;
  holder.updateWorldMatrix(true, false);
  inv.copy(holder.matrixWorld).invert();
  local.set(origin, dir).applyMatrix4(inv); // scale in the holder matrix changes the length of the direction
  if (!local.intersectBox(box, hit)) return null;
  picker.set(origin, dir);
  picker.far = far;
  const first = picker.intersectObject(holder, true)[0];
  return first ? first.distance : null;
}

// Where does a world-space ray first land on an upward-facing surface of any of `holders` (tops of machines, tables)?
// Sides are skipped, so a model dragged over another one is placed on its top. Null when there is none within `far`.
const allHits = new Raycaster(); // all hits, not just the first: a side may be in front of the top
const up = new Vector3();
export function surfaceUnder(holders: Object3D[], origin: Vector3, dir: Vector3, far: number): Vector3 | null {
  if (!holders.length) return null;
  allHits.set(origin, dir);
  allHits.far = far;
  for (const h of holders) h.updateWorldMatrix(true, true);
  for (const hit of allHits.intersectObjects(holders, true)) {
    if (!hit.face) continue;
    up.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (up.y > 0.5) return hit.point.clone();
  }
  return null;
}
