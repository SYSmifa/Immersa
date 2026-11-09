import { BufferAttribute, BufferGeometry, type InterleavedBufferAttribute, Mesh, Object3D, Scene, SkinnedMesh } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { Job } from './simplifyWorker';
import { createGltfLoader } from '../scene/gltf';

// Triangle budget for one model on the headset. Above it the editor offers to simplify when the project is saved.
export const HEAVY_TRIANGLES = 300000;
// How far a geometry may drift from the original in the first, "lossless" pass: a fraction of the part's size.
const LOSSLESS_ERROR = 0.001;
export const MAX_FILE_BYTES = 45 * 1024 * 1024; // under the cloud's 50 MB per file

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


// Workers that run the simplifier, one job each at a time; a few at most. A part's data is only prepared once a worker is free
// for it (every job holds its own copy of the mesh: preparing all the parts of a big model at once ran the page out of memory).
const MAX_WORKERS = 4;
const idle: Worker[] = [];
const all: Set<Worker> = new Set();
const waiting: (() => void)[] = [];
async function takeWorker(): Promise<Worker> {
  for (;;) {
    const w = idle.pop();
    if (w) return w;
    if (all.size < Math.max(1, Math.min(MAX_WORKERS, Math.floor((navigator.hardwareConcurrency ?? 4) / 2)))) { // half the cores: the PC stays usable meanwhile
      const nw = new Worker(new URL('./simplifyWorker.ts', import.meta.url), { type: 'module' });
      all.add(nw);
      return nw;
    }
    await new Promise<void>((r) => waiting.push(r));
  }
}
function giveBack(w: Worker) {
  w.onmessage = w.onerror = null;
  idle.push(w);
  waiting.shift()?.();
}
// All workers go away at the end of a simplification: their memory is not given back otherwise.
function endWorkers() {
  for (const w of all) w.terminate();
  all.clear();
  idle.length = 0;
  for (const r of waiting.splice(0)) r();
}
let jobId = 0;
function runOn(w: Worker, job: Omit<Job, 'id'>): Promise<Uint32Array> {
  const id = ++jobId;
  return new Promise<Uint32Array>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<{ id: number; out?: Uint32Array; error?: string }>) => (e.data.out ? resolve(e.data.out) : reject(new Error(e.data.error ?? 'worker')));
    w.onerror = (e) => reject(new Error(e.message || 'worker'));
    w.postMessage({ ...job, id }, [job.idx.buffer, job.pos.buffer, job.attr.buffer]);
  });
}

type Attr = BufferAttribute | InterleavedBufferAttribute;
const plain = (a: Attr): a is BufferAttribute => !(a as InterleavedBufferAttribute).isInterleavedBufferAttribute;

// `size` components of every vertex as plain floats (the file may hold interleaved or normalised integers). A plain float
// array is only copied.
function floats(a: Attr, size: number): Float32Array {
  if (plain(a) && a.array instanceof Float32Array && a.itemSize === size) return a.array.slice();
  const out = new Float32Array(a.count * size);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = a.getComponent(i, k);
  return out;
}

// A geometry without an index (STL, OBJ, FBX come like that): equal vertices (all attributes bit for bit) are welded into one
// so that the simplifier sees which triangles share an edge. A hash table over the raw bits, much faster than going through
// strings.
function weld(g: BufferGeometry): BufferGeometry {
  const names = Object.keys(g.attributes);
  const attrs = names.map((n) => g.getAttribute(n) as Attr);
  const n = attrs[0].count;
  const width = attrs.reduce((w, a) => w + a.itemSize, 0);
  const bits = new Uint32Array(n * width);
  const f = new Float32Array(bits.buffer);
  for (let i = 0; i < n; i++) {
    let o = i * width;
    for (const a of attrs) for (let k = 0; k < a.itemSize; k++) f[o++] = a.getComponent(i, k);
  }
  let size = 1;
  while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const remap = new Uint32Array(n);
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    let h = 2166136261;
    const o = i * width;
    for (let k = 0; k < width; k++) h = Math.imul(h ^ bits[o + k], 16777619);
    let slot = (h ^ (h >>> 15)) & (size - 1);
    for (;;) {
      const j = table[slot];
      if (j < 0) {
        table[slot] = i;
        remap[i] = keep.length;
        keep.push(i);
        break;
      }
      let same = true;
      for (let k = 0; k < width; k++) if (bits[j * width + k] !== bits[o + k]) { same = false; break; }
      if (same) {
        remap[i] = remap[j];
        break;
      }
      slot = (slot + 1) & (size - 1);
    }
  }
  const out = new BufferGeometry();
  names.forEach((name, ai) => {
    const a = attrs[ai];
    const arr = new Float32Array(keep.length * a.itemSize);
    for (let i = 0; i < keep.length; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(keep[i], k);
    out.setAttribute(name, new BufferAttribute(arr, a.itemSize));
  });
  out.setIndex(new BufferAttribute(remap, 1));
  return out;
}

// One geometry down to about `targetTris` triangles: edge collapses that keep the normals and the UVs close to the original
// (meshoptimizer, in a worker), then the vertices no triangle uses any more are dropped, which is where most of the file
// size goes.
async function simplifyGeometry(source: BufferGeometry, targetTris: number, maxError: number, coarseFallback: boolean, stop: { stopped: boolean }): Promise<BufferGeometry> {
  const w = await takeWorker();
  let out: Uint32Array;
  let g: BufferGeometry;
  let position: Attr;
  try {
    if (stop.stopped) throw new Error('interrotto');
    ({ out, g, position } = await simplifyOn(w, source, targetTris, maxError, coarseFallback));
  } finally {
    giveBack(w);
  }
  return rebuild(g, position, out);
}

async function simplifyOn(w: Worker, source: BufferGeometry, targetTris: number, maxError: number, coarseFallback: boolean) {
  const g = source.index ? source : weld(source);
  const position = g.getAttribute('position') as Attr;
  const nor = g.getAttribute('normal') as Attr | undefined;
  const uv = g.getAttribute('uv') as Attr | undefined;
  const stride = (nor ? 3 : 0) + (uv ? 2 : 0);
  const attr = new Float32Array(position.count * stride);
  for (let i = 0; i < position.count; i++) {
    let o = i * stride;
    if (nor) for (let k = 0; k < 3; k++) attr[o++] = nor.getComponent(i, k);
    if (uv) for (let k = 0; k < 2; k++) attr[o++] = uv.getComponent(i, k);
  }
  const out = await runOn(w, {
    idx: Uint32Array.from(g.index!.array as ArrayLike<number>),
    pos: floats(position, 3),
    attr,
    stride,
    weights: [...(nor ? [0.5, 0.5, 0.5] : []), ...(uv ? [0.5, 0.5] : [])],
    target: Math.max(8, targetTris) * 3,
    error: maxError,
    fallback: coarseFallback,
  });
  return { out, g, position };
}

function rebuild(g: BufferGeometry, position: Attr, out: Uint32Array): BufferGeometry {
  // Keep only the vertices still used, in the order they first appear.
  const remap = new Int32Array(position.count).fill(-1);
  const used: number[] = [];
  const index = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    let r = remap[out[i]];
    if (r < 0) {
      r = used.length;
      remap[out[i]] = r;
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
export async function simplifyGlb(file: File, budget: number, onStep: (text: string) => void = () => undefined, maxBytes = MAX_FILE_BYTES): Promise<Simplified> {
  try {
    return await simplifyAll(file, budget, onStep, maxBytes);
  } finally {
    endWorkers();
  }
}

async function simplifyAll(file: File, budget: number, onStep: (text: string) => void, maxBytes: number): Promise<Simplified> {
  const stop = { stopped: false };
  onStep('Leggo il modello');
  await tick();
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
  // Every part (geometry) goes to a worker; they run side by side. `what` says what the parts are doing, with how many are done.
  const run = async (geos: BufferGeometry[], what: string, target: (g: BufferGeometry) => number, error: number, fallback: boolean) => {
    const done = new Map<BufferGeometry, BufferGeometry>();
    let n = 0;
    onStep(`${what} (0 di ${geos.length})`);
    try {
      await Promise.all(
        geos.map(async (g) => {
          done.set(g, await simplifyGeometry(g, target(g), error, fallback, stop));
          onStep(`${what} (${++n} di ${geos.length})`);
        }),
      );
    } catch (e) {
      stop.stopped = true; // the parts still waiting do not start
      throw e;
    }
    swap(done);
  };
  // Step 1: as far as it goes within the tolerance.
  await run([...new Set(all.filter(eligible).map((m) => m.geometry))], 'Tolgo i triangoli inutili', () => 8, LOSSLESS_ERROR, false);
  // Step 2: still too many, so spread the cut that is missing over the parts that can take it.
  const squeeze = async (goal: number, what: string) => {
    const uses = new Map<BufferGeometry, number>();
    for (const m of all) uses.set(m.geometry, (uses.get(m.geometry) ?? 0) + 1);
    const canDo = new Set(all.filter(eligible).map((m) => m.geometry));
    let fixed = 0;
    let free = 0;
    for (const [g, n] of uses) (canDo.has(g) ? (free += trianglesOf(g) * n) : (fixed += trianglesOf(g) * n));
    const ratio = free ? Math.min(1, Math.max(0.02, (goal - fixed) / free)) : 1;
    await run([...canDo], what, (g) => Math.round(trianglesOf(g) * ratio), 1, true);
  };
  if (count() > budget) await squeeze(budget, 'Semplifico ancora per il visore');
  // The cloud takes files up to a limit (50 MB by default): if the file is still bigger, go on until it fits.
  const top = [...scene.children];
  const write = async () => {
    onStep('Scrivo il file');
    await tick();
    const out = new Scene();
    for (const c of top) out.add(c); // the top nodes go straight into the scene: no extra level in the tree
    return (await new GLTFExporter().parseAsync(out, { binary: true, maxTextureSize: MAX_TEXTURE })) as ArrayBuffer;
  };
  let buffer = await write();
  let goal = budget;
  for (let round = 1; buffer.byteLength > maxBytes && round <= 3; round++) {
    goal = Math.round(Math.min(goal, count()) * 0.6);
    await squeeze(goal, `Il file è ancora grande: semplifico di più (${round})`);
    buffer = await write();
  }
  return { file: new File([buffer], file.name, { type: 'model/gltf-binary' }), before, after: count() };
}

// Triangles of a GLB read from its JSON chunk alone (accessor counts x nodes that use each mesh): no geometry is decoded, so
// it is cheap, and only the first bytes of the file are fetched when the server honours a Range request.
interface GltfJson {
  accessors?: { count: number }[];
  images?: { bufferView?: number }[];
  bufferViews?: { byteLength: number }[];
  meshes?: { primitives: { mode?: number; indices?: number; attributes: { POSITION?: number } }[] }[];
  nodes?: { mesh?: number }[];
}
function trianglesOfJson(g: GltfJson): number {
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
const parseJson = (buf: ArrayBuffer) => JSON.parse(new TextDecoder().decode(buf)) as GltfJson;

// The same for a file we hold: only its first bytes are read, so a 400 MB model costs nothing (parsing it whole can run out of memory).
export async function glbTrianglesOfFile(file: Blob): Promise<number> {
  const len = new DataView(await file.slice(0, 20).arrayBuffer()).getUint32(12, true);
  return trianglesOfJson(parseJson(await file.slice(20, 20 + len).arrayBuffer()));
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
  return trianglesOfJson(parseJson(json));
}

// A short description of a GLB for messages: triangles, meshes and how much of the file is images.
export async function describeGlb(file: Blob): Promise<string> {
  const len = new DataView(await file.slice(0, 20).arrayBuffer()).getUint32(12, true);
  const g = parseJson(await file.slice(20, 20 + len).arrayBuffer());
  const imageBytes = (g.images ?? []).reduce((n, i) => n + (i.bufferView !== undefined ? (g.bufferViews?.[i.bufferView]?.byteLength ?? 0) : 0), 0);
  const mb = (n: number) => (n / 1048576).toFixed(0);
  return `${trianglesOfJson(g).toLocaleString('it-IT')} triangoli in ${g.meshes?.length ?? 0} mesh, ${g.images?.length ?? 0} immagini (${mb(imageBytes)} MB), il resto ${mb(file.size - imageBytes)} MB`;
}
