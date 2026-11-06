import { Box3, BufferGeometry, Color, Texture, FrontSide, Material, Matrix4, Mesh, Object3D, Ray, Raycaster, ShaderMaterial, Vector3 } from 'three';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';

// Triangle-accurate picking stays cheap with a bounding volume hierarchy per geometry (built once, shared by clones).
Mesh.prototype.raycast = acceleratedRaycast;
(BufferGeometry.prototype as { computeBoundsTree?: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree;
const picker = new Raycaster();
(picker as unknown as { firstHitOnly: boolean }).firstHitOnly = true;

// The selected model is drawn in light blue, semi-transparent and shaded by how much each surface faces you. Drawn naively
// (blending every layer of a closed object, both sides) a sofa made of many pieces looks like a hundred separate models and
// costs a lot of overdraw, so: a depth-only copy of each mesh first (a child sharing the geometry), then the blue pass only
// where it is the front-most surface, front faces only: one blended layer per pixel. The original materials come back when
// it is deselected and the helper copies are removed.
export const SELECT_COLOR = 0x35b8ff;
const selectedMaterial = new ShaderMaterial({
  uniforms: { color: { value: new Color(SELECT_COLOR) }, opacity: { value: 0.6 } },
  vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 color; uniform float opacity; varying vec3 vN;
    void main(){ float f = abs(normalize(vN).z); gl_FragColor = vec4(color * mix(0.55, 1.0, f), opacity);
    #include <colorspace_fragment>
    }`,
  transparent: true,
  depthWrite: false,
  side: FrontSide,
});
const depthOnly = new ShaderMaterial({
  vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }',
  colorWrite: false,
  depthWrite: true,
  side: FrontSide,
  polygonOffset: true, // a little farther, so the blue pass is always in front of it
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
const ORIGINAL = 'originalMaterial';
const HELPER = 'selectionHelper';
const isReal = (m: Mesh) => m.isMesh && !m.userData[HELPER];

// Returns false while the model has no geometry yet.
export function applySelectionLook(holder: Object3D): boolean {
  let any = false;
  const meshes: Mesh[] = [];
  holder.traverse((o) => {
    const m = o as Mesh;
    if (isReal(m)) meshes.push(m);
  });
  for (const m of meshes) {
    any = true;
    if (!m.userData[ORIGINAL]) {
      m.userData[ORIGINAL] = m.material;
      const helper = new Mesh(m.geometry, depthOnly);
      helper.userData[HELPER] = true;
      helper.raycast = () => undefined; // never picked
      helper.frustumCulled = m.frustumCulled;
      m.add(helper);
    }
    m.material = selectedMaterial;
  }
  return any;
}

export function clearSelectionLook(holder: Object3D) {
  const helpers: Object3D[] = [];
  holder.traverse((o) => {
    const m = o as Mesh;
    if (m.userData?.[HELPER]) helpers.push(o);
    else if (m.isMesh && m.userData[ORIGINAL]) {
      m.material = m.userData[ORIGINAL] as Material | Material[];
      delete m.userData[ORIGINAL];
    }
  });
  for (const h of helpers) h.parent?.remove(h);
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

type Shiny = Material & { color?: Color; roughness?: number; metalness?: number; envMap?: Texture | null; envMapIntensity?: number };
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
      if (env && !t.envMap) {
        t.envMap = env;
        // The environment also lights the diffuse part, so a plain roughness change on a non-metal must not flood it with
        // light: reflections fade in with the metalness (a metal has no diffuse colour of its own to brighten).
        t.envMapIntensity = 0.1 + 0.7 * (t.metalness ?? 0);
      }
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
      if (!isReal(mesh)) return;
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
    if (!isReal(mesh)) return;
    const base = baseOf(mesh);
    const next = Array.isArray(base) ? base.map(paint) : paint(base);
    if (mesh.userData[ORIGINAL]) mesh.userData[ORIGINAL] = next; // selected: the azure look stays, this comes back after
    else mesh.material = next;
  });
}

// A component's own colour and finish, on top of the model's (call after paintModel: it puts the materials back first).
export function paintPart(node: Object3D, part: { color?: string; finish?: Finish }) {
  if (!part.color && part.finish?.roughness === undefined && part.finish?.metalness === undefined) return;
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!isReal(mesh)) return;
    const base = baseOf(mesh);
    const next = Array.isArray(base) ? base.map((m) => tinted(m, part.color, part.finish)) : tinted(base, part.color, part.finish);
    if (mesh.userData[ORIGINAL]) mesh.userData[ORIGINAL] = next;
    else mesh.material = next;
  });
}

// Models exported from CAD often carry fully metallic materials. Without anything to reflect a metal is black, so the
// metallic ones get the same soft room-like environment as a material given a finish (call once the model is loaded).
export function lightMetals(root: Object3D) {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const s = m as Shiny;
      if (!((s.metalness ?? 0) > 0.3) || s.envMap) continue;
      env ??= envSource?.() ?? null;
      if (!env) return;
      s.envMap = env;
      s.envMapIntensity = 1;
      s.needsUpdate = true;
    }
  });
}

// The shared soft environment (made on first use), for materials that are given metalness.
export function finishEnv(): Texture | null {
  env ??= envSource?.() ?? null;
  return env;
}
