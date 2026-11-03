import { Box3, BufferGeometry, Color, Texture, DoubleSide, Material, Matrix4, Mesh, MeshBasicMaterial, Object3D, Ray, Raycaster, Vector3 } from 'three';
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

// Size in the model's own axes, at scale 1 (null while it is loading).
export function modelSize(holder: Object3D): Vector3 | null {
  return localBox(holder)?.getSize(new Vector3()) ?? null;
}

// Top centre of the model in world space (for floating labels and buttons); null while it is loading.
export function worldTop(holder: Object3D): Vector3 | null {
  const box = localBox(holder);
  if (!box) return null;
  holder.updateWorldMatrix(true, false);
  return new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).applyMatrix4(holder.matrixWorld);
}

// Tint: the materials of the model get this colour (clones, cached per source material and colour, so models that share
// a file do not change each other). undefined puts the file's own materials back. Works together with the selection look.
const BASE = 'baseMaterial'; // the file's own material, captured once
const tints = new WeakMap<Material, Map<string, Material>>();
// Roughness / metalness: how shiny a material is. Metal only looks like metal when it has something to reflect, so the
// materials given a finish also get a soft room-like environment (made on first use by the function the stage provides).
export interface Finish {
  roughness?: number;
  metalness?: number;
}
let envSource: (() => Texture) | null = null;
let env: Texture | null = null;
export const setFinishEnvironment = (make: () => Texture) => (envSource = make);

type Shiny = Material & { color?: Color; roughness?: number; metalness?: number; envMap?: Texture | null };
function tinted(src: Material, hex: string | undefined, finish: Finish | undefined): Material {
  let byLook = tints.get(src);
  if (!byLook) tints.set(src, (byLook = new Map()));
  const key = `${hex ?? ''}|${finish?.roughness ?? ''}|${finish?.metalness ?? ''}`;
  let m = byLook.get(key);
  if (!m) {
    const t = src.clone() as Shiny;
    if (hex) t.color?.set(hex);
    if (finish && 'roughness' in t) {
      if (finish.roughness !== undefined) t.roughness = finish.roughness;
      if (finish.metalness !== undefined) t.metalness = finish.metalness;
      env ??= envSource?.() ?? null;
      if (env && !t.envMap) t.envMap = env;
    }
    byLook.set(key, (m = t));
  }
  return m;
}

// The distinct materials of a model, in a fixed order (the index is what the project stores): name and original colour.
export interface MaterialInfo {
  name: string;
  color: string; // '#rrggbb' as in the file
  roughness: number; // as in the file (0.5 when the material has none)
  metalness: number;
}
const LIST = 'materialList';
function baseOf(mesh: Mesh): Material | Material[] {
  return (mesh.userData[BASE] ??= mesh.userData[ORIGINAL] ?? mesh.material) as Material | Material[];
}
function materialsOf(holder: Object3D): Material[] {
  let list = holder.userData[LIST] as Material[] | undefined;
  if (!list) {
    list = [];
    holder.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const base = baseOf(mesh);
      for (const m of Array.isArray(base) ? base : [base]) if (!list!.includes(m)) list!.push(m);
    });
    if (list.length) holder.userData[LIST] = list; // not while the file is still loading
  }
  return list;
}
export function listMaterials(holder: Object3D): MaterialInfo[] {
  return materialsOf(holder).map((m, i) => ({
    name: m.name ? `${i + 1} · ${m.name}` : `Materiale ${i + 1}`, // the number keeps duplicated or generic names apart
    color: `#${(m as Shiny).color?.getHexString() ?? 'ffffff'}`,
    roughness: (m as Shiny).roughness ?? 0.5,
    metalness: (m as Shiny).metalness ?? 0,
  }));
}

// What a model asks for: `color` / `finish` for every material, `materialColors[i]` / `materialFinish[i]` override
// them for material i. Nothing set: the file's own look.
export interface Look {
  color?: string;
  materialColors?: Record<string, string>;
  finish?: Finish;
  materialFinish?: Record<string, Finish>;
}
export function paintModel(holder: Object3D, look: Look) {
  const list = materialsOf(holder);
  const paint = (m: Material) => {
    const i = String(list.indexOf(m));
    const hex = look.materialColors?.[i] ?? look.color;
    const fin = { ...look.finish, ...look.materialFinish?.[i] };
    return hex || fin.roughness !== undefined || fin.metalness !== undefined ? tinted(m, hex, fin) : m;
  };
  holder.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const base = baseOf(mesh);
    const next = Array.isArray(base) ? base.map(paint) : paint(base);
    if (mesh.userData[ORIGINAL]) mesh.userData[ORIGINAL] = next; // selected: the azure look stays, this comes back after
    else mesh.material = next;
  });
}
