import { BoxGeometry, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { Structure } from './types';

// Walls and floor slabs of a project as simple boxes, in their room's frame. Shared by the PC editor and the headset.
export const WALL_COLOR = '#e9ecf2';
export const FLOOR_COLOR = '#c7cdd9';
const box = new BoxGeometry(1, 1, 1);

// Puts a unit box where the structure is.
export function placeStructure(mesh: Mesh, s: Pick<Structure, 'kind' | 'a' | 'b' | 'y' | 'height' | 'thickness'>) {
  const dx = s.b[0] - s.a[0];
  const dz = s.b[1] - s.a[1];
  const mx = (s.a[0] + s.b[0]) / 2;
  const mz = (s.a[1] + s.b[1]) / 2;
  if (s.kind === 'wall') {
    mesh.scale.set(Math.max(0.01, Math.hypot(dx, dz)), s.height, s.thickness);
    mesh.position.set(mx, s.y + s.height / 2, mz);
    mesh.rotation.set(0, -Math.atan2(dz, dx), 0);
  } else {
    mesh.scale.set(Math.max(0.01, Math.abs(dx)), s.thickness, Math.max(0.01, Math.abs(dz)));
    mesh.position.set(mx, s.y + s.thickness / 2, mz);
    mesh.rotation.set(0, 0, 0);
  }
}

export function createStructureLayer(parent: Object3D) {
  const meshes = new Map<string, Mesh>();
  return {
    meshes,
    // Call after any change to the list.
    sync(list: Structure[]) {
      const ids = new Set(list.map((s) => s.id));
      for (const [id, m] of meshes) {
        if (!ids.has(id)) {
          parent.remove(m);
          (m.material as MeshStandardMaterial).dispose();
          meshes.delete(id);
        }
      }
      for (const s of list) {
        let m = meshes.get(s.id);
        if (!m) {
          m = new Mesh(box, new MeshStandardMaterial({ roughness: 0.9, metalness: 0 }));
          m.userData.structureId = s.id;
          parent.add(m);
          meshes.set(s.id, m);
        }
        (m.material as MeshStandardMaterial).color.set(s.color ?? (s.kind === 'wall' ? WALL_COLOR : FLOOR_COLOR));
        placeStructure(m, s);
      }
    },
  };
}
export type StructureLayer = ReturnType<typeof createStructureLayer>;
