import { BackSide, BufferGeometry, Float32BufferAttribute, Mesh, Object3D, ShaderMaterial } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Light-blue silhouette outline for the selected model ("inverted hull"): every mesh gets a copy of itself, pushed out along
// smoothed normals and drawn back faces only, so only a rim around the shape stays visible. The copy shares nothing but
// the transform; its normals are smoothed over merged vertices so hard edges (cubes, machine parts) do not open gaps.
export const SELECT_COLOR = 0x35b8ff;
const WIDTH = 0.006; // metres, in world space

const hullGeometries = new WeakMap<BufferGeometry, BufferGeometry>(); // per source geometry, shared by every selection

function hullGeometry(src: BufferGeometry): BufferGeometry {
  let g = hullGeometries.get(src);
  if (!g) {
    const pos = src.getAttribute('position');
    const bare = new BufferGeometry();
    bare.setAttribute('position', new Float32BufferAttribute(Array.from({ length: pos.count * 3 }, (_, i) => pos.getComponent((i / 3) | 0, i % 3)), 3));
    if (src.index) bare.setIndex(src.index.clone());
    g = mergeVertices(bare, 1e-4);
    g.computeVertexNormals();
    hullGeometries.set(src, g);
  }
  return g;
}

// Adds the outline under `holder`; returns false while the model has no geometry yet.
export function addOutline(holder: Object3D): boolean {
  holder.updateWorldMatrix(true, true);
  const meshes: Mesh[] = [];
  holder.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && !o.userData.selectionOutline && !(m as { isSkinnedMesh?: boolean }).isSkinnedMesh) meshes.push(m);
  });
  for (const mesh of meshes) {
    const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1;
    const material = new ShaderMaterial({
      side: BackSide,
      uniforms: {},
      vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * ${(WIDTH / scale).toFixed(6)}, 1.0); }`,
      fragmentShader: `void main() { gl_FragColor = vec4(${[SELECT_COLOR >> 16, (SELECT_COLOR >> 8) & 255, SELECT_COLOR & 255].map((c) => (c / 255).toFixed(3)).join(', ')}, 1.0); }`,
    });
    const hull = new Mesh(hullGeometry(mesh.geometry), material);
    hull.userData.selectionOutline = true;
    hull.raycast = () => undefined; // never picked
    mesh.add(hull);
  }
  return meshes.length > 0;
}

export function removeOutline(holder: Object3D) {
  const hulls: Mesh[] = [];
  holder.traverse((o) => {
    if (o.userData.selectionOutline) hulls.push(o as Mesh);
  });
  for (const h of hulls) {
    h.removeFromParent();
    (h.material as ShaderMaterial).dispose(); // the geometry is cached and shared
  }
}
