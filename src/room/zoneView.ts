import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LineLoop, LineBasicMaterial, Mesh, MeshBasicMaterial, PlaneGeometry, type Object3D } from 'three';
import type { ZoneState } from './zones';

// Draws the zone di rispetto: a flat area on the floor around the model (amber; red when something is inside it) with its outline.
// A child of the room's frame, like the models.
const FILL = new MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.2, side: DoubleSide, depthWrite: false });
const FILL_BAD = new MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.32, side: DoubleSide, depthWrite: false });
const EDGE = new LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.95, depthWrite: false });
const EDGE_BAD = new LineBasicMaterial({ color: 0xf87171, transparent: true, opacity: 1, depthWrite: false });
const QUAD = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const OUTLINE = (() => {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3));
  return g;
})();

export function createZoneLayer(parent: Object3D) {
  const root = new Group();
  root.renderOrder = 3;
  parent.add(root);
  const items = new Map<string, Group>();
  return {
    root,
    // `visible` false: nothing is drawn (the data stays with the models).
    sync(zones: ZoneState[], visible: boolean) {
      root.visible = visible;
      const seen = new Set<string>();
      for (const z of zones) {
        seen.add(z.id);
        let g = items.get(z.id);
        if (!g) {
          g = new Group();
          const fill = new Mesh(QUAD, FILL);
          const edge = new LineLoop(OUTLINE, EDGE);
          fill.raycast = edge.raycast = () => undefined; // never picked: it is only drawn
          fill.renderOrder = edge.renderOrder = 3;
          g.add(fill, edge);
          root.add(g);
          items.set(z.id, g);
        }
        const s = z.solid;
        g.position.set(s.c[0], s.y0 + 0.012, s.c[1]);
        g.rotation.y = Math.atan2(-s.u[1], s.u[0]);
        g.scale.set(s.hu * 2, 1, s.hv * 2);
        const bad = z.invaders.length > 0;
        (g.children[0] as Mesh).material = bad ? FILL_BAD : FILL;
        (g.children[1] as LineLoop).material = bad ? EDGE_BAD : EDGE;
      }
      for (const [id, g] of items)
        if (!seen.has(id)) {
          root.remove(g);
          items.delete(id);
        }
    },
  };
}
export type ZoneLayer = ReturnType<typeof createZoneLayer>;
