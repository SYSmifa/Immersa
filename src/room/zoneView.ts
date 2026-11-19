import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial, Shape, ShapeGeometry, Vector2, type Object3D } from 'three';
import type { ZoneState } from './zones';

// Draws the zone di rispetto: a flat area on the floor (amber; red when something is inside it or it cuts a wall) with its outline.
// A child of the room's frame, like the models. The free zones are also floors of the project (amber, drawn by the structures'
// layer); this layer adds the outline and turns them red.
const FILL = new MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.2, side: DoubleSide, depthWrite: false });
const FILL_BAD = new MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.32, side: DoubleSide, depthWrite: false });
const EDGE = new LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.95, depthWrite: false });
const EDGE_BAD = new LineBasicMaterial({ color: 0xf87171, transparent: true, opacity: 1, depthWrite: false });

const fillOf = (poly: [number, number][]) => {
  const g = new ShapeGeometry(new Shape(poly.map(([x, z]) => new Vector2(x, z))));
  g.rotateX(Math.PI / 2); // shape (x, y) -> (x, z), facing up
  return g;
};
const edgeOf = (poly: [number, number][]) => {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(poly.flatMap(([x, z]) => [x, 0, z]), 3));
  return g;
};

export function createZoneLayer(parent: Object3D) {
  const root = new Group();
  root.renderOrder = 3;
  parent.add(root);
  const items = new Map<string, { g: Group; key: string }>();
  const drop = (it: { g: Group }) => {
    for (const c of it.g.children) (c as Mesh).geometry.dispose();
    root.remove(it.g);
  };
  return {
    root,
    // `visible` false: nothing is drawn (the data stays with the models).
    sync(zones: ZoneState[], visible: boolean) {
      root.visible = visible;
      const seen = new Set<string>();
      for (const z of zones) {
        seen.add(z.id);
        const key = JSON.stringify(z.poly.map((p) => [Math.round(p[0] * 1000), Math.round(p[1] * 1000)]));
        let it = items.get(z.id);
        if (it && it.key !== key) {
          drop(it);
          it = undefined;
        }
        if (!it) {
          const g = new Group();
          const fill = new Mesh(fillOf(z.poly), FILL);
          const edge = new LineLoop(edgeOf(z.poly), EDGE);
          fill.renderOrder = edge.renderOrder = 3;
          fill.raycast = edge.raycast = () => undefined; // never picked: it is only drawn
          g.add(fill, edge);
          root.add(g);
          it = { g, key };
          items.set(z.id, it);
        }
        it.g.position.set(0, z.y0 + 0.015, 0);
        const bad = z.invaders.length > 0 || z.walls;
        (it.g.children[0] as Mesh).material = bad ? FILL_BAD : FILL;
        (it.g.children[1] as LineLoop).material = bad ? EDGE_BAD : EDGE;
      }
      for (const [id, it] of items)
        if (!seen.has(id)) {
          drop(it);
          items.delete(id);
        }
    },
  };
}
export type ZoneLayer = ReturnType<typeof createZoneLayer>;
