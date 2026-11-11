import { Box3, CanvasTexture, Group, LinearFilter, LineBasicMaterial, Matrix4, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, type Object3D, type Scene } from 'three';
import { floorCentre } from '../room/floor';
import { drawBoxes, drawPlanes } from '../room/draw';
import { placeAround, type Placement } from '../room/layout';
import { createModelLayer, type ModelLayer } from '../room/modelLayer';
import type { Room, RoomModel } from '../room/types';

// The other rooms of the open project, drawn around the one being edited at the places their links give (room/layout.ts
// `placeAround`): outlines of their scans and their models, read-only. Cyan: the link is sure (seen by two sessions, or by hand);
// amber: only a guess; grey: no link at all, put aside. The room being edited stays where it is (its frame is the editor's world),
// so nothing else in the editor has to know about them: they are not in the lists that picking and snapping look at.
const TINT = { manual: 0x2dd4bf, confirmed: 0x2dd4bf, tentative: 0xfbbf24, unknown: 0x8a93a3 } as const;
const WORDS: Record<Placement['state'], string> = { manual: 'collegata a mano', confirmed: 'collegata', tentative: 'collegamento da confermare', unknown: 'posizione sconosciuta' };
const lineMats = new Map<number, LineBasicMaterial>();
const lineMat = (hex: number) => {
  let m = lineMats.get(hex);
  if (!m) lineMats.set(hex, (m = new LineBasicMaterial({ color: hex, transparent: true, opacity: 0.9 })));
  return m;
};

function labelSprite(name: string, state: Placement['state']): Sprite {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 220;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(14,16,22,0.82)';
  g.beginPath();
  g.roundRect(8, 8, 624, 204, 40);
  g.fill();
  const hex = `#${TINT[state].toString(16).padStart(6, '0')}`;
  g.fillStyle = '#ffffff';
  g.font = '700 76px Sen, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name.length > 18 ? `${name.slice(0, 17)}…` : name, 320, 78);
  g.fillStyle = hex;
  g.font = '500 46px Sen, system-ui, sans-serif';
  g.fillText(WORDS[state], 320, 154);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(2.3, 0.79, 1);
  s.renderOrder = 1000;
  return s;
}

interface Entry {
  planes: Room['scan']['planes'];
  state: Placement['state'];
  root: Group;
  outline: Group;
  layer: ModelLayer;
}

export function createOtherRooms(scene: Scene, onError: (text: string, model: RoomModel) => void) {
  const top = new Group();
  scene.add(top);
  const entries = new Map<string, Entry>();

  function remove(id: string) {
    const e = entries.get(id);
    if (!e) return;
    e.layer.sync([]);
    top.remove(e.root);
    entries.delete(id);
  }

  function build(room: Room, state: Placement['state']): Entry {
    const root = new Group();
    root.matrixAutoUpdate = false;
    const outline = new Group();
    drawPlanes(room.scan.planes, outline, false, room.scan.boxes ?? [], true);
    drawBoxes(room.scan.boxes ?? [], outline, false);
    const mat = lineMat(TINT[state]);
    outline.traverse((o: Object3D) => {
      if ((o as { isLine?: boolean }).isLine) (o as unknown as { material: LineBasicMaterial }).material = mat;
    });
    root.add(outline);
    const c = floorCentre(room.scan.planes);
    const label = labelSprite(room.name, state);
    label.position.set(c[0], c[1] + 2.5, c[2]);
    root.add(label);
    top.add(root);
    return { planes: room.scan.planes, state, root, outline, layer: createModelLayer(root, onError) };
  }

  return {
    // `current`: the room being edited (null: none). Returns how sure each other room's place is.
    sync(current: Room | null, members: Room[], models: RoomModel[], hidden: Set<string>): Map<string, Placement['state']> {
      const states = new Map<string, Placement['state']>();
      const around = current ? placeAround(current, members) : new Map<string, Placement>();
      for (const id of [...entries.keys()]) if (!around.has(id)) remove(id);
      for (const [id, place] of around) {
        const room = members.find((r) => r.id === id);
        if (!room) continue;
        states.set(id, place.state);
        let e = entries.get(id);
        if (e && (e.planes !== room.scan.planes || e.state !== place.state)) {
          remove(id);
          e = undefined;
        }
        e ??= build(room, place.state);
        entries.set(id, e);
        e.root.matrix.copy(new Matrix4().makeRotationY(-place.pose.yaw).setPosition(place.pose.tx, place.pose.ty, place.pose.tz));
        e.root.matrixWorldNeedsUpdate = true;
        e.root.visible = !hidden.has(id);
        e.layer.sync(hidden.has(id) ? [] : models.filter((m) => m.roomId === id)); // a hidden room does not load its models
      }
      return states;
    },
    // The box around the visible ones (world), to frame the whole place.
    bounds(): Box3 {
      const box = new Box3();
      top.updateMatrixWorld(true);
      for (const e of entries.values()) if (e.root.visible) box.union(new Box3().setFromObject(e.outline));
      return box;
    },
    count: () => entries.size,
    position: (id: string) => entries.get(id)?.root.getWorldPosition(new Vector3()) ?? null,
  };
}
