import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LoadingManager,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import occtWasm from 'occt-import-js/dist/occt-import-js.wasm?url';

// Any 3D file in, one GLB out: the PC converts on import, the headset only ever reads GLB (fast, one parser, stable node tree
// for the components). The original is not kept.
export const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'mtl', 'fbx', 'stl', 'ply', 'dae', '3mf', 'step', 'stp', 'iges', 'igs', 'brep', 'zip', 'bin', 'png', 'jpg', 'jpeg', 'webp', 'tga', 'bmp'];
export const MODEL_ACCEPT = MODEL_EXTENSIONS.map((e) => `.${e}`).join(',');

export type Unit = 'mm' | 'cm' | 'm' | 'in';
const UNIT_FACTOR: Record<Unit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254 };
const MAIN = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'dae', '3mf', 'step', 'stp', 'iges', 'igs', 'brep'];
const MAX_TEXTURE = 2048;

export interface Parsed {
  root: Object3D;
  name: string; // without extension
  format: string;
  triangles: number;
  size: Vector3; // in the file's own units
  guessUnit: Unit;
  guessZUp: boolean;
  fixedUnit: boolean; // the file knows its unit (STEP / IGES, converted to metres while reading), nothing to ask
}
export interface ImportOptions {
  unit: Unit;
  zUp: boolean;
}

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const base = (name: string) => name.replace(/^.*[\\/]/, '');
const stem = (name: string) => base(name).replace(/\.[^.]+$/, '');
const tick = () => new Promise<void>((r) => setTimeout(r, 0)); // lets the loading card draw between the heavy steps

// A zip is unpacked into files of its own; everything else is used as chosen.
async function expandAsync(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    if (ext(f.name) !== 'zip') {
      out.push(f);
      continue;
    }
    const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
    for (const [path, data] of Object.entries(entries)) {
      if (path.endsWith('/') || base(path).startsWith('.') || path.includes('__MACOSX')) continue;
      out.push(new File([data as BlobPart], base(path)));
    }
  }
  return out;
}

// Textures and other side files, found by name: a manager that points every request at the file the user gave us.
function sideFiles(files: File[]) {
  const urls = new Map<string, string>();
  for (const f of files) urls.set(base(f.name).toLowerCase(), URL.createObjectURL(f));
  let pending = 0;
  let resolveIdle: (() => void) | null = null;
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const name = decodeURIComponent(base(url.split('?')[0])).toLowerCase();
    return urls.get(name) ?? url;
  });
  const origStart = manager.itemStart.bind(manager);
  const origEnd = manager.itemEnd.bind(manager);
  manager.itemStart = (u: string) => {
    pending++;
    origStart(u);
  };
  manager.itemEnd = (u: string) => {
    pending--;
    origEnd(u);
    if (pending <= 0) resolveIdle?.();
  };
  return {
    manager,
    // Resolves when the textures asked for so far are in (or after a few seconds, so a missing file never blocks).
    idle: () =>
      new Promise<void>((resolve) => {
        if (pending <= 0) return resolve();
        resolveIdle = resolve;
        setTimeout(resolve, 8000);
      }),
    dispose: () => urls.forEach((u) => URL.revokeObjectURL(u)),
  };
}

const grey = () => new MeshStandardMaterial({ color: 0xbfc4cc, roughness: 0.6, metalness: 0.1, side: DoubleSide });

// STEP / IGES / BREP through OpenCascade (WebAssembly, loaded only when needed). The output is in metres whatever the unit
// of the file.
let occtReady: Promise<Awaited<ReturnType<typeof import('occt-import-js').default>>> | null = null;
async function readCad(file: File, kind: 'step' | 'iges' | 'brep'): Promise<Object3D> {
  occtReady ??= import('occt-import-js').then((m) => m.default({ locateFile: () => occtWasm }));
  const occt = await occtReady;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await tick();
  const params = { linearUnit: 'meter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 };
  const result = kind === 'step' ? occt.ReadStepFile(bytes, params) : kind === 'iges' ? occt.ReadIgesFile(bytes, params) : occt.ReadBrepFile(bytes, params);
  if (!result.success) throw new Error('Il file CAD non si legge (o è vuoto)');
  const make = (node: (typeof result)['root']): Object3D => {
    const g = new Group();
    g.name = node.name || '';
    for (const i of node.meshes) {
      const m = result.meshes[i];
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(m.attributes.position.array, 3));
      if (m.attributes.normal) geo.setAttribute('normal', new Float32BufferAttribute(m.attributes.normal.array, 3));
      geo.setIndex(m.index.array);
      if (!m.attributes.normal) geo.computeVertexNormals();
      const mat = new MeshStandardMaterial({ roughness: 0.55, metalness: 0.1, side: DoubleSide });
      // A colour of pure black is what the reader gives to parts that have none: grey instead of a black shape.
      if (m.color && m.color[0] + m.color[1] + m.color[2] > 0.03) mat.color.setRGB(m.color[0], m.color[1], m.color[2], SRGBColorSpace);
      else mat.color.set(0xbfc4cc);
      const mesh = new Mesh(geo, mat);
      mesh.name = m.name || node.name || '';
      g.add(mesh);
    }
    for (const c of node.children) g.add(make(c));
    return g;
  };
  return make(result.root);
}

async function readFile(files: File[], main: File): Promise<Object3D> {
  const kind = ext(main.name);
  const side = sideFiles(files);
  try {
    if (kind === 'step' || kind === 'stp') return await readCad(main, 'step');
    if (kind === 'iges' || kind === 'igs') return await readCad(main, 'iges');
    if (kind === 'brep') return await readCad(main, 'brep');
    if (kind === 'stl') {
      const geo = new STLLoader().parse(await main.arrayBuffer());
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      return new Mesh(geo, grey());
    }
    if (kind === 'ply') {
      const geo = new PLYLoader().parse(await main.arrayBuffer());
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      const mat = grey();
      if (geo.getAttribute('color')) mat.vertexColors = true;
      return new Mesh(geo, mat);
    }
    if (kind === 'obj') {
      const loader = new OBJLoader(side.manager);
      const mtl = files.find((f) => ext(f.name) === 'mtl');
      if (mtl) {
        const mats = new MTLLoader(side.manager).parse(await mtl.text(), '');
        mats.preload();
        loader.setMaterials(mats);
      }
      const obj = loader.parse(await main.text());
      await side.idle();
      return obj;
    }
    if (kind === 'fbx') {
      const obj = new FBXLoader(side.manager).parse(await main.arrayBuffer(), '');
      await side.idle();
      return obj;
    }
    if (kind === 'dae') {
      const dae = new ColladaLoader(side.manager).parse(await main.text(), '');
      if (!dae) throw new Error('Il file DAE non si legge');
      await side.idle();
      return dae.scene;
    }
    if (kind === '3mf') return new ThreeMFLoader(side.manager).parse(await main.arrayBuffer());
    if (kind === 'gltf' || kind === 'glb') {
      const loader = new GLTFLoader(side.manager);
      const data = kind === 'glb' ? await main.arrayBuffer() : await main.text();
      const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => loader.parse(data, '', resolve, reject));
      await side.idle();
      return gltf.scene;
    }
    throw new Error(`Formato non gestito: .${kind}`);
  } finally {
    // The textures are read by now (idle); the addresses can go.
    setTimeout(side.dispose, 15000);
  }
}

// Same look in a different material class: the exporter writes standard (PBR) materials best.
function toStandard(m: Material): MeshStandardMaterial {
  const s = m as MeshStandardMaterial & { shininess?: number; emissive?: Color };
  if ((m as MeshStandardMaterial).isMeshStandardMaterial) return s;
  const o = m as Material & { color?: Color; map?: MeshStandardMaterial['map']; normalMap?: MeshStandardMaterial['normalMap']; emissiveMap?: MeshStandardMaterial['emissiveMap']; shininess?: number };
  const out = new MeshStandardMaterial({
    name: m.name,
    color: o.color ?? new Color(0xbfc4cc),
    map: o.map ?? null,
    normalMap: o.normalMap ?? null,
    emissive: s.emissive ?? new Color(0x000000),
    emissiveMap: o.emissiveMap ?? null,
    roughness: o.shininess !== undefined ? Math.min(1, Math.max(0.15, 1 - o.shininess / 150)) : 0.7,
    metalness: 0,
    side: m.side,
    vertexColors: m.vertexColors,
  });
  // Some exporters write a transparency of 100 % for solid things: a model must not vanish.
  out.opacity = m.opacity < 0.05 ? 1 : m.opacity;
  out.transparent = out.opacity < 1;
  return out;
}

function tidy(root: Object3D): number {
  const cache = new Map<Material, MeshStandardMaterial>();
  const drop: Object3D[] = [];
  let triangles = 0;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      const conv = (m: Material) => cache.get(m) ?? cache.set(m, toStandard(m)).get(m)!;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
      const g = mesh.geometry as BufferGeometry;
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      triangles += (g.index ? g.index.count : (g.getAttribute('position') as BufferAttribute).count) / 3;
    } else if (o !== root && ((o as Object3D & { isLine?: boolean }).isLine || (o as Object3D & { isPoints?: boolean }).isPoints || (o as Object3D & { isLight?: boolean }).isLight || (o as Object3D & { isCamera?: boolean }).isCamera)) {
      drop.push(o);
    }
  });
  for (const o of drop) o.parent?.remove(o);
  return Math.round(triangles);
}

// What the file's unit probably is, from the size of the model: a person-sized thing is 2 in metres, 200 in centimetres, 2000 in millimetres.
function guessUnit(size: Vector3): Unit {
  const longest = Math.max(size.x, size.y, size.z);
  return longest < 12 ? 'm' : longest < 900 ? 'cm' : 'mm';
}

export async function parseModel(chosen: File[]): Promise<Parsed> {
  const files = await expandAsync(chosen);
  const main = files.find((f) => MAIN.includes(ext(f.name)));
  if (!main) throw new Error('Nel gruppo di file non c\'è un modello 3D che conosco (glb, gltf, obj, fbx, stl, ply, dae, 3mf, step, iges, brep).');
  const root = await readFile(files, main);
  await tick();
  const triangles = tidy(root);
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error('Il modello è vuoto: non contiene superfici.');
  const size = box.getSize(new Vector3());
  const kind = ext(main.name);
  const cad = ['step', 'stp', 'iges', 'igs', 'brep'].includes(kind);
  const cadWithUnit = cad && kind !== 'brep'; // a BREP file has no unit: ask (millimetres is the usual)
  return {
    root,
    name: stem(main.name),
    format: kind.toUpperCase(),
    triangles,
    size,
    guessUnit: cadWithUnit || kind === 'gltf' || kind === 'glb' ? 'm' : kind === 'stl' || kind === '3mf' || kind === 'brep' ? 'mm' : guessUnit(size), // meshes from CAD tools are in millimetres
    guessZUp: cad || kind === 'stl' || kind === '3mf',
    fixedUnit: cadWithUnit || kind === 'gltf' || kind === 'glb',
  };
}

// Width x height x depth in metres for the choices made (what the dialog shows).
export function sizeFor(p: Parsed, o: ImportOptions): [number, number, number] {
  const k = p.fixedUnit ? 1 : UNIT_FACTOR[o.unit];
  return o.zUp ? [p.size.x * k, p.size.z * k, p.size.y * k] : [p.size.x * k, p.size.y * k, p.size.z * k];
}

// Scale to metres, Z up -> Y up, then one binary GLB. The textures are kept to 2048 px.
export async function exportGlb(p: Parsed, o: ImportOptions): Promise<File> {
  const k = p.fixedUnit ? 1 : UNIT_FACTOR[o.unit];
  const m = new Matrix4().makeScale(k, k, k);
  if (o.zUp) m.multiply(new Matrix4().makeRotationX(-Math.PI / 2));
  p.root.updateMatrix();
  m.multiply(p.root.matrix);
  const scene = new Scene();
  // The top nodes go straight into the scene (no extra wrapper): the components keep their place in the tree.
  const top = p.root.children.length ? [...p.root.children] : [p.root];
  for (const c of top) {
    c.applyMatrix4(m);
    scene.add(c);
  }
  await tick();
  const buffer = (await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize: MAX_TEXTURE })) as ArrayBuffer;
  return new File([buffer], `${p.name}.glb`, { type: 'model/gltf-binary' });
}

export const isSimpleGlb = (files: File[]) => files.length === 1 && ext(files[0].name) === 'glb';
