// Run: npx tsx docs/test-plans/gen-parts-golden.mts
// Writes unity/Tests/Core.Tests/Fixtures/parts-golden.json: random glTF files loaded with the app's own loader (three's GLTFLoader),
// the object tree it makes, the paths and components src/room/parts.ts finds, and where applyParts puts the components. The C#
// port (unity/Assets/Scripts/Core/ModelParts.cs) rebuilds the tree from the glTF JSON alone and is tested against this file.
(globalThis as any).ProgressEvent = class { constructor(public type: string, init: object = {}) { Object.assign(this, init); } };
import { writeFileSync } from 'node:fs';
import { Box3, Euler, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyParts, nodeByPath, partFromMesh, pathOf, sceneRoot } from '../../src/room/parts.ts';
import type { PartEdit } from '../../src/room/types.ts';

let seed = 31337;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 1000) / 1000;
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

function randomGltf() {
  const N = 6 + Math.floor(rnd() * 9);
  const nodes: any[] = [];
  const meshes: any[] = [];
  const accessors: any[] = [];
  const floats: number[] = [];
  const parentOf: number[] = [];
  const sceneNodes: number[] = [];
  for (let i = 0; i < N; i++) {
    const node: any = { name: `n${i}` };
    const kind = rnd();
    const nprim = kind < 0.4 ? 0 : kind < 0.75 ? 1 : 2 + Math.floor(rnd() * 2);
    if (nprim) {
      const prims = [];
      for (let k = 0; k < nprim; k++) {
        const lo = [r(-1, 1), r(0, 1), r(-1, 1)];
        const hi = [lo[0] + r(0.1, 2), lo[1] + r(0.1, 2), lo[2] + r(0.1, 2)];
        const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
        // exactly the float32 values, so that min/max are the real extremes of the data
        const data = [...lo, ...hi, ...mid];
        const f32 = new Float32Array(data);
        const offset = floats.length * 4;
        floats.push(...f32);
        const mn = [0, 1, 2].map((a) => Math.min(f32[a], f32[3 + a], f32[6 + a]));
        const mx = [0, 1, 2].map((a) => Math.max(f32[a], f32[3 + a], f32[6 + a]));
        accessors.push({ bufferView: 0, byteOffset: offset, componentType: 5126, count: 3, type: 'VEC3', min: mn, max: mx });
        prims.push({ attributes: { POSITION: accessors.length - 1 } });
      }
      meshes.push({ name: `mesh${meshes.length}`, primitives: prims });
      node.mesh = meshes.length - 1;
    }
    const t = rnd();
    if (t < 0.5) {
      // identity: no fields
    } else {
      const p = new Vector3(r(-2, 2), r(-1, 2), r(-2, 2));
      const q = new Quaternion().setFromEuler(new Euler(r(-1, 1), r(-3, 3), r(-1, 1)));
      const s = rnd() < 0.5 ? new Vector3(1, 1, 1).multiplyScalar(r(0.5, 2)) : new Vector3(r(0.5, 2), r(0.5, 2), r(0.5, 2));
      if (t < 0.8) {
        node.translation = p.toArray();
        node.rotation = [q.x, q.y, q.z, q.w];
        if (rnd() < 0.7) node.scale = s.toArray();
      } else node.matrix = new Matrix4().compose(p, q, s).elements;
    }
    nodes.push(node);
    if (i > 0 && rnd() < 0.7) {
      const par = Math.floor(rnd() * i);
      (nodes[par].children ??= []).push(i);
      parentOf.push(par);
    } else {
      sceneNodes.push(i);
      parentOf.push(-1);
    }
  }
  if (sceneNodes.length === 0) sceneNodes.push(0);
  const buf = Buffer.from(new Float32Array(floats).buffer);
  return {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: sceneNodes }], nodes, meshes, accessors,
    bufferViews: [{ buffer: 0, byteLength: buf.length }],
    buffers: [{ byteLength: buf.length, uri: 'data:application/octet-stream;base64,' + buf.toString('base64') }],
  };
}

const trs = (o: Object3D) => ({ p: o.position.toArray(), q: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w], s: o.scale.toArray() });
const gltfIndexOf = (o: Object3D): number => (/^n\d+$/.test(o.userData.name ?? '') ? Number(o.userData.name.slice(1)) : -1);

function dump(holder: Object3D) {
  const root = sceneRoot(holder)!;
  const out: any[] = [];
  const walk = (o: Object3D) => {
    out.push({ path: o === root ? '' : pathOf(holder, o), isMesh: !!(o as any).isMesh, gltfNode: o === root ? -1 : gltfIndexOf(o), name: o.name, children: o.children.length, ...trs(o) });
    o.children.forEach(walk);
  };
  walk(root);
  return out;
}

function allObjects(holder: Object3D): Object3D[] {
  const root = sceneRoot(holder)!;
  const out: Object3D[] = [];
  root.traverse((o) => { if (o !== root) out.push(o); });
  return out;
}

const randomParts = (holder: Object3D) => {
  const objs = allObjects(holder);
  const parts: Record<string, PartEdit> = {};
  const n = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const path = pathOf(holder, pick(objs));
    if (!path) continue;
    const e: PartEdit = {};
    if (rnd() < 0.6) e.d = [r(-1, 1), r(-0.5, 0.5), r(-1, 1)];
    if (rnd() < 0.6) e.yaw = r(-3, 3);
    if (rnd() < 0.5) e.scale = pick([0.5, 1, 1.5, 2, 0.8]);
    parts[path] = e;
  }
  return parts;
};

const loader = new GLTFLoader();
const scenarios: any[] = [];
for (let n = 0; n < 25; n++) {
  const json = randomGltf();
  const gltf: any = await new Promise((res, rej) => loader.parse(JSON.stringify(json), '', res, rej));
  // what the app does with the loaded file (room/modelLayer.ts)
  const box = new Box3().setFromObject(gltf.scene);
  const c = box.getCenter(new Vector3());
  const wrapper = new Group();
  gltf.scene.position.set(-c.x, -box.min.y, -c.z);
  wrapper.add(gltf.scene);
  const holder = new Group();
  holder.add(wrapper.clone(true));
  holder.position.set(r(-5, 5), r(0, 1), r(-5, 5));
  holder.rotation.y = r(-3, 3);
  holder.scale.setScalar(r(0.5, 2));
  holder.updateMatrixWorld(true);

  const tree = dump(holder);
  const root = sceneRoot(holder)!;
  const objs = allObjects(holder);
  const picks = objs.filter((o) => (o as any).isMesh).map((m) => {
    const a = partFromMesh(holder, m, null);
    return { mesh: pathOf(holder, m), first: a, second: partFromMesh(holder, m, a) };
  });
  const parts1 = randomParts(holder);
  applyParts(holder, parts1);
  const after1 = dump(holder);
  const pivots1 = Object.keys(parts1).map((k) => ({ path: k, pivot: nodeByPath(holder, k)?.userData.pivot0 ? [nodeByPath(holder, k)!.userData.pivot0.x, nodeByPath(holder, k)!.userData.pivot0.y, nodeByPath(holder, k)!.userData.pivot0.z] : null }));
  const parts2 = randomParts(holder);
  applyParts(holder, parts2);
  const after2 = dump(holder);
  scenarios.push({
    gltf: json, centring: root.position.toArray(), tree, picks,
    parts1, after1, pivots1, parts2, after2,
  });
}
writeFileSync('unity/Tests/Core.Tests/Fixtures/parts-golden.json', JSON.stringify({ scenarios }));
const multi = scenarios.filter((s) => s.tree.some((t: any) => !t.isMesh && t.children > 0 && s.gltf.nodes.some((nn: any) => nn.mesh !== undefined && (s.gltf.meshes[nn.mesh].primitives.length > 1) && nn.children))).length;
console.log('scenarios', scenarios.length, 'with a multi-primitive node that also has children:', multi, 'size', JSON.stringify({ scenarios }).length);
