import { BoxGeometry, CanvasTexture, ExtrudeGeometry, Mesh, MeshStandardMaterial, RepeatWrapping, Shape, SRGBColorSpace, Vector2, type Object3D } from 'three';
import { textureById, textureMaps } from './textures';
import type { Structure } from './types';

// Walls and floor slabs of a project as simple boxes, in their room's frame. Shared by the PC editor and the headset.
export const WALL_COLOR = '#e9ecf2';
export const FLOOR_COLOR = '#c7cdd9';
const box = new BoxGeometry(1, 1, 1);

// The outline of a floor: its own corners, or the rectangle a-b of the first floors.
export function floorPoints(s: Pick<Structure, 'a' | 'b' | 'pts'>): [number, number][] {
  if (s.pts && s.pts.length >= 3) return s.pts;
  return [[s.a[0], s.a[1]], [s.b[0], s.a[1]], [s.b[0], s.b[1]], [s.a[0], s.b[1]]];
}
// The points of a structure other things snap to: the ends of a wall's line, the corners of a floor.
export const structPoints = (s: Structure): [number, number][] => (s.kind === 'wall' ? [s.a, s.b] : floorPoints(s));
export function polygonArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}
// "Lunga 2.50 m" / "3.00 × 2.00 m · 6.00 m²", for the details of a wall or a floor.
export function structMeasure(s: Structure): string {
  if (s.kind === 'wall') return `Lunga ${Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]).toFixed(2)} m`;
  const p = floorPoints(s);
  const xs = p.map((q) => q[0]);
  const zs = p.map((q) => q[1]);
  return `${(Math.max(...xs) - Math.min(...xs)).toFixed(2)} × ${(Math.max(...zs) - Math.min(...zs)).toFixed(2)} m · ${polygonArea(p).toFixed(2)} m²`;
}

// A floor slab as a mesh of real size in the room's frame: UVs count metres (divided by the texture's size) and follow the
// room, so the textures of neighbouring floors line up.
function floorSlab(pts: [number, number][], thickness: number, tile: number) {
  const g = new ExtrudeGeometry(new Shape(pts.map(([x, z]) => new Vector2(x, z))), { depth: thickness, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape (x, y) -> (x, z); the extrusion goes down: lift it so the top is at `thickness`
  g.translate(0, thickness, 0);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
  return g;
}

// Puts a unit box where the wall is (floors: the rectangle a-b, used for the preview while drawing).
export function placeStructure(mesh: Mesh, s: Pick<Structure, 'kind' | 'a' | 'b' | 'y' | 'height' | 'thickness' | 'align'>) {
  const dx = s.b[0] - s.a[0];
  const dz = s.b[1] - s.a[1];
  const mx = (s.a[0] + s.b[0]) / 2;
  const mz = (s.a[1] + s.b[1]) / 2;
  if (s.kind === 'wall') {
    const len = Math.max(0.01, Math.hypot(dx, dz));
    // The wall stands on one side of the line: 'left' = to the left when looking from a to b (seen from above, x right, z down).
    const off = s.align === 'left' ? s.thickness / 2 : s.align === 'right' ? -s.thickness / 2 : 0;
    mesh.scale.set(len, s.height, s.thickness);
    mesh.position.set(mx + (dz / len) * off, s.y + s.height / 2, mz - (dx / len) * off);
    mesh.rotation.set(0, -Math.atan2(dz, dx), 0);
  } else {
    mesh.scale.set(Math.max(0.01, Math.abs(dx)), s.thickness, Math.max(0.01, Math.abs(dz)));
    mesh.position.set(mx, s.y + s.thickness / 2, mz);
    mesh.rotation.set(0, 0, 0);
  }
}

// Textures are built once per catalogue entry (colour, normal, ambient occlusion, roughness); every wall and floor using
// one shares them.
interface PbrSet {
  map: CanvasTexture;
  normalMap: CanvasTexture;
  aoMap: CanvasTexture;
  roughnessMap: CanvasTexture;
}
const sets = new Map<string, PbrSet>();
function textureFor(id: string): PbrSet | null {
  let set = sets.get(id);
  if (!set) {
    const maps = textureMaps(id);
    if (!maps) return null;
    const make = (c: HTMLCanvasElement, srgb: boolean) => {
      const t = new CanvasTexture(c);
      t.wrapS = t.wrapT = RepeatWrapping;
      if (srgb) t.colorSpace = SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    };
    set = { map: make(maps.color, true), normalMap: make(maps.normal, false), aoMap: make(maps.ao, false), roughnessMap: make(maps.rough, false) };
    sets.set(id, set);
  }
  return set;
}

// A box of real size whose UVs count metres (divided by the texture's size), so a texture keeps its scale on every face
// and does not stretch when a wall gets longer.
function texturedBox(w: number, h: number, d: number, tile: number) {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const spans: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++)
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * spans[f][0]) / tile, (uv.getY(k) * spans[f][1]) / tile);
    }
  return g;
}

export function createStructureLayer(parent: Object3D) {
  const meshes = new Map<string, Mesh>();
  let hl: string | null = null; // the selected one (headset): a soft azure glow
  const glow = (id: string, m: Mesh) => {
    const mat = m.material as MeshStandardMaterial;
    mat.emissive.set(id === hl ? 0x1d7fd0 : 0x000000);
    mat.emissiveIntensity = id === hl ? 0.7 : 0;
  };
  return {
    meshes,
    highlight(id: string | null) {
      hl = id;
      for (const [k, m] of meshes) glow(k, m);
    },
    // Call after any change to the list.
    sync(list: Structure[]) {
      const ids = new Set(list.map((s) => s.id));
      for (const [id, m] of meshes) {
        if (!ids.has(id)) {
          parent.remove(m);
          m.geometry.dispose();
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
        glow(s.id, m);
        const mat = m.material as MeshStandardMaterial;
        const def = textureById(s.texture);
        const tex = def ? textureFor(def.id) : null;
        // The tint multiplies the texture; with no explicit colour a textured surface shows the texture as it is.
        mat.color.set(s.color ?? (tex ? '#ffffff' : s.kind === 'wall' ? WALL_COLOR : FLOOR_COLOR));
        if (mat.map !== (tex?.map ?? null)) {
          mat.map = tex?.map ?? null;
          mat.normalMap = tex?.normalMap ?? null;
          mat.aoMap = tex?.aoMap ?? null;
          mat.roughnessMap = tex?.roughnessMap ?? null;
          mat.roughness = tex ? 1 : 0.9; // with a roughness map the map is the value
          mat.needsUpdate = true;
        }
        if (s.kind === 'floor') {
          // Always a polygon slab at the room's origin (the outline is in room coordinates).
          const pts = floorPoints(s);
          const key = `f|${JSON.stringify(pts)}|${s.thickness}|${def?.id ?? ''}`;
          if (m.userData.key !== key) {
            if (m.geometry !== box) m.geometry.dispose();
            m.geometry = floorSlab(pts, s.thickness, def?.size ?? 1);
            m.userData.key = key;
          }
          m.position.set(0, s.y, 0);
          m.rotation.set(0, 0, 0);
          m.scale.set(1, 1, 1);
          continue;
        }
        placeStructure(m, s);
        if (tex && def) {
          // Real-size geometry for the texture to cover; the unit box is only for flat colours.
          const w = m.scale.x;
          const h = m.scale.y;
          const d = m.scale.z;
          const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${def.id}`;
          if (m.userData.key !== key) {
            if (m.geometry !== box) m.geometry.dispose();
            m.geometry = texturedBox(w, h, d, def.size);
            m.userData.key = key;
          }
          m.scale.set(1, 1, 1);
        } else if (m.geometry !== box) {
          m.geometry.dispose();
          m.geometry = box;
          m.userData.key = '';
        }
      }
    },
  };
}
export type StructureLayer = ReturnType<typeof createStructureLayer>;
