import {
  Box3,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  TorusKnotGeometry,
  Vector3,
} from 'three';
import { createGltfLoader } from './gltf';

const MODEL_URL = '/models/test.glb';

export interface TestModel {
  root: Object3D;
  source: string;
  triangles: number;
}

export function countTriangles(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const g = (o as Mesh).geometry as BufferGeometry | undefined;
    if (g) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(n);
}

// Procedural stand-in so the budget can be tested without any asset (?tris=300000).
function proceduralModel(tris: number): Object3D {
  const radial = 64;
  const tubular = Math.max(8, Math.round(tris / (2 * radial)));
  const geo = new TorusKnotGeometry(0.5, 0.18, tubular, radial);
  return new Mesh(geo, new MeshStandardMaterial({ color: 0x4aa3ff, roughness: 0.5, metalness: 0.2 }));
}

async function loadGlb(): Promise<Object3D> {
  return (await createGltfLoader().loadAsync(MODEL_URL)).scene;
}

// Scales the model to `size` metres (largest side), centres it on x/z and puts its base on y=0.
function normalise(obj: Object3D, size: number): Group {
  const box = new Box3().setFromObject(obj);
  const dim = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  const k = size / Math.max(dim.x, dim.y, dim.z);
  const inner = new Group();
  inner.add(obj);
  obj.position.set(-centre.x, -box.min.y, -centre.z);
  inner.scale.setScalar(k);
  const root = new Group();
  root.add(inner);
  return root;
}

// Loads public/models/test.glb, or falls back to a procedural mesh.
// Query params: ?tris=<n> (fallback density), ?size=<metres> (default 1.5).
export async function loadTestModel(): Promise<TestModel> {
  const q = new URLSearchParams(location.search);
  const size = Number(q.get('size') ?? 1.5);
  const tris = Number(q.get('tris') ?? 300_000);

  let obj: Object3D;
  let source: string;
  try {
    obj = await loadGlb();
    source = 'test.glb';
  } catch {
    obj = proceduralModel(tris);
    source = 'procedural';
  }
  const root = normalise(obj, size);
  root.position.set(0, 0, -2);
  return { root, source, triangles: countTriangles(root) };
}
