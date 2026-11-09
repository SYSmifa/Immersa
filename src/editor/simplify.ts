import { BufferAttribute, BufferGeometry, type InterleavedBufferAttribute, Mesh, Object3D, Scene, SkinnedMesh } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { createGltfLoader } from '../scene/gltf';

// Triangle budget for one model on the headset. Above it the editor offers to simplify when the project is saved.
export const HEAVY_TRIANGLES = 300000;
// How far a geometry may drift from the original in the first, "lossless" pass: a fraction of the part's size.
const LOSSLESS_ERROR = 0.001;

const MAX_TEXTURE = 2048;
const SMALL = 100; // geometries with so few triangles are left as they are
const tick = () => new Promise<void>((r) => setTimeout(r, 0)); // lets the loading card draw between the heavy steps

const trianglesOf = (g: BufferGeometry) => Math.floor((g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3);

async function readGlb(file: File): Promise<Object3D> {
  return (await createGltfLoader().parseAsync(await file.arrayBuffer(), '')).scene;
}

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

// Triangles drawn by a GLB: every mesh node counts, so a part used ten times counts ten times.
export async function countTriangles(file: File): Promise<number> {
  return meshes(await readGlb(file)).reduce((n, m) => n + trianglesOf(m.geometry), 0);
}

// Only plain static geometry is simplified: skinned or morphed meshes and multi-material groups keep their triangles.
const eligible = (m: Mesh) => !(m as SkinnedMesh).isSkinnedMesh && !m.geometry.morphAttributes.position && !m.geometry.groups.length && trianglesOf(m.geometry) > SMALL;

type Attr = BufferAttribute | InterleavedBufferAttribute;

// `size` components of every vertex as plain floats (the file may hold interleaved or normalised integers).
function floats(a: Attr, size: number): Float32Array {
  const out = new Float32Array(a.count * size);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = a.getComponent(i, k);
  return out;
}

// One geometry down to about `targetTris` triangles: edge collapses that keep the normals and the UVs close to the original
// (meshoptimizer), then the vertices no triangle uses any more are dropped, which is where most of the file size goes.
function simplifyGeometry(source: BufferGeometry, targetTris: number, maxError: number, coarseFallback: boolean): BufferGeometry {
  const g = source.index ? source : mergeVertices(source);
  const position = g.getAttribute('position') as Attr;
  const pos = floats(position, 3);
  const nor = g.getAttribute('normal') as Attr | undefined;
  const uv = g.getAttribute('uv') as Attr | undefined;
  const stride = (nor ? 3 : 0) + (uv ? 2 : 0);
  const attr = new Float32Array(position.count * stride);
  for (let i = 0; i < position.count; i++) {
    let o = i * stride;
    if (nor) for (let k = 0; k < 3; k++) attr[o++] = nor.getComponent(i, k);
    if (uv) for (let k = 0; k < 2; k++) attr[o++] = uv.getComponent(i, k);
  }
  const weights = [...(nor ? [0.5, 0.5, 0.5] : []), ...(uv ? [0.5, 0.5] : [])];
  const idx = Uint32Array.from(g.index!.array as ArrayLike<number>);
  const target = Math.max(8, targetTris) * 3;
  let [out] = stride ? MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attr, stride, weights, null, target, maxError) : MeshoptSimplifier.simplify(idx, pos, 3, target, maxError);
  // Topology can stop the careful pass early (many separate shells): finish with the coarse one, which ignores the attributes.
  if (coarseFallback && out.length > target * 1.3) out = MeshoptSimplifier.simplifySloppy(out, pos, 3, null, target, 1)[0];

  // Keep only the vertices still used, in the order they first appear.
  const remap = new Map<number, number>();
  const used: number[] = [];
  const index = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    let r = remap.get(out[i]);
    if (r === undefined) {
      r = used.length;
      remap.set(out[i], r);
      used.push(out[i]);
    }
    index[i] = r;
  }
  const result = new BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const src = a as Attr;
    const arr = new Float32Array(used.length * src.itemSize);
    for (let i = 0; i < used.length; i++) for (let k = 0; k < src.itemSize; k++) arr[i * src.itemSize + k] = src.getComponent(used[i], k);
    result.setAttribute(name, new BufferAttribute(arr, src.itemSize));
  }
  result.setIndex(new BufferAttribute(used.length > 65535 ? index : Uint16Array.from(index), 1));
  return result;
}

export interface Simplified {
  file: File;
  before: number;
  after: number;
}

// A GLB made lighter in two steps. First everything that can go without changing the shape (flat areas cut into many
// triangles, details far finer than a millimetre): the model keeps its look. If that is still above `budget` triangles in
// total, it goes on until it fits (the parts share the cut in proportion). Written back as a GLB with the same node tree,
// so that the components and the materials keep their places.
export async function simplifyGlb(file: File, budget: number): Promise<Simplified> {
  await MeshoptSimplifier.ready;
  const scene = await readGlb(file);
  const all = meshes(scene);
  const count = () => all.reduce((n, m) => n + trianglesOf(m.geometry), 0);
  const before = count();
  if (before <= budget) return { file, before, after: before };
  const swap = (done: Map<BufferGeometry, BufferGeometry>) => {
    for (const m of all) {
      const g = done.get(m.geometry);
      if (g) m.geometry = g;
    }
  };
  // Step 1: as far as it goes within the tolerance.
  const step1 = new Map<BufferGeometry, BufferGeometry>();
  for (const g of new Set(all.filter(eligible).map((m) => m.geometry))) {
    step1.set(g, simplifyGeometry(g, 8, LOSSLESS_ERROR, false));
    await tick();
  }
  swap(step1);
  // Step 2: still too many, so spread the cut that is missing over the parts that can take it.
  let after = count();
  if (after > budget) {
    const uses = new Map<BufferGeometry, number>();
    for (const m of all) uses.set(m.geometry, (uses.get(m.geometry) ?? 0) + 1);
    const canDo = new Set(all.filter(eligible).map((m) => m.geometry));
    let fixed = 0;
    let free = 0;
    for (const [g, n] of uses) (canDo.has(g) ? (free += trianglesOf(g) * n) : (fixed += trianglesOf(g) * n));
    const ratio = free ? Math.min(1, Math.max(0.02, (budget - fixed) / free)) : 1;
    const step2 = new Map<BufferGeometry, BufferGeometry>();
    for (const g of canDo) {
      step2.set(g, simplifyGeometry(g, Math.round(trianglesOf(g) * ratio), 1, true));
      await tick();
    }
    swap(step2);
    after = count();
  }
  const out = new Scene();
  for (const c of [...scene.children]) out.add(c); // the top nodes go straight into the scene: no extra level in the tree
  await tick();
  const buffer = (await new GLTFExporter().parseAsync(out, { binary: true, maxTextureSize: MAX_TEXTURE })) as ArrayBuffer;
  return { file: new File([buffer], file.name, { type: 'model/gltf-binary' }), before, after };
}

// Triangles of a GLB read from its JSON chunk alone (accessor counts x nodes that use each mesh): no geometry is decoded, so
// it is cheap, and only the first bytes of the file are fetched when the server honours a Range request.
interface GltfJson {
  accessors?: { count: number }[];
  meshes?: { primitives: { mode?: number; indices?: number; attributes: { POSITION?: number } }[] }[];
  nodes?: { mesh?: number }[];
}
export async function glbTrianglesAt(url: string): Promise<number> {
  const head = await fetch(url, { headers: { Range: 'bytes=0-19' } }).catch(() => fetch(url)); // a refused Range header (CORS): the whole file
  let json: ArrayBuffer;
  if (head.status === 206) {
    const h = new DataView(await head.arrayBuffer());
    const len = h.getUint32(12, true);
    const res = await fetch(url, { headers: { Range: `bytes=20-${19 + len}` } });
    json = await res.arrayBuffer();
  } else {
    const all = await head.arrayBuffer(); // no ranges: the whole file came
    const len = new DataView(all).getUint32(12, true);
    json = all.slice(20, 20 + len);
  }
  const g = JSON.parse(new TextDecoder().decode(json)) as GltfJson;
  const uses = new Map<number, number>();
  for (const n of g.nodes ?? []) if (n.mesh !== undefined) uses.set(n.mesh, (uses.get(n.mesh) ?? 0) + 1);
  let total = 0;
  (g.meshes ?? []).forEach((m, i) => {
    let tris = 0;
    for (const p of m.primitives) {
      const a = g.accessors?.[p.indices ?? p.attributes.POSITION ?? -1];
      if (!a) continue;
      const mode = p.mode ?? 4;
      tris += mode === 4 ? Math.floor(a.count / 3) : mode === 5 || mode === 6 ? Math.max(0, a.count - 2) : 0;
    }
    total += tris * (uses.get(i) ?? (g.nodes?.length ? 0 : 1));
  });
  return total;
}
