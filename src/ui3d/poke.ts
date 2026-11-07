import { Vector3, type PlaneGeometry } from 'three';
import type { UiHost } from './host';
import type { Panel, Widget } from './panel';

// Typing with the fingers: the tip of each index finger is followed in front of a panel (the keyboard). Near it, the key under
// the finger lights up and a dot shows where the finger lands on it (the pointer is a ray from just in front of the panel
// through the fingertip, so the host does the highlighting); when the tip touches the surface the key is pressed. Once pressed,
// the finger has to come back before it can press again. The key under the finger "sticks": a small drift does not change it.
const HOVER = 0.06; // m in front of the surface where the finger starts to count
const TOUCH = 0.012; // m: pressed (the joint is the centre of the fingertip, a centimetre or so from its skin)
const REARM = 0.028; // m: back out far enough to press again
const STICK = 14; // px around the key under the finger that still count as that key

export function createPoke(host: UiHost, panel: Panel) {
  const states = new Map<string, { armed: boolean; seenFront: boolean; key: Widget | null }>();
  const normal = new Vector3();
  const local = new Vector3();

  function one(id: string, tip: Vector3 | null) {
    const rid = `poke:${id}`;
    let st = states.get(id);
    if (!st) states.set(id, (st = { armed: true, seenFront: false, key: null }));
    const leave = () => {
      host.setRay(rid, null);
      st!.armed = true;
      st!.seenFront = false;
      st!.key = null;
    };
    if (!tip || !panel.mesh.visible) return leave();
    const mesh = panel.mesh;
    mesh.updateWorldMatrix(true, false);
    local.copy(tip);
    mesh.worldToLocal(local);
    const g = (mesh.geometry as PlaneGeometry).parameters;
    const d = local.z; // in front of the keyboard (+) or behind it (-)
    if (d > HOVER || d < -HOVER || Math.abs(local.x) > g.width / 2 + 0.02 || Math.abs(local.y) > g.height / 2 + 0.02) return leave();
    // where the finger is on the keyboard, in canvas pixels; a key already under the finger keeps it while the tip stays near it
    let px = (local.x / g.width + 0.5) * panel.pxW;
    let py = (0.5 - local.y / g.height) * panel.pxH;
    const prev = st.key;
    if (prev) {
      const r = prev.rect;
      if (px > r.x - STICK && px < r.x + r.w + STICK && py > r.y - STICK && py < r.y + r.h + STICK) {
        px = Math.min(r.x + r.w - 1, Math.max(r.x + 1, px));
        py = Math.min(r.y + r.h - 1, Math.max(r.y + 1, py));
      }
    }
    local.x = (px / panel.pxW - 0.5) * g.width;
    local.y = (0.5 - py / panel.pxH) * g.height;
    const origin = mesh.localToWorld(new Vector3(local.x, local.y, 0.05));
    normal.set(0, 0, -1).transformDirection(mesh.matrixWorld);
    host.setRay(rid, origin, normal);
    st.key = panel.widgetAt(px / panel.pxW, 1 - py / panel.pxH);
    if (d > 0.02) st.seenFront = true;
    if (d <= TOUCH && st.armed && st.seenFront) {
      st.armed = false;
      host.tap(rid);
    } else if (d >= REARM) st.armed = true;
  }

  return {
    // Call every frame with the index fingertip of each tracked hand (null = lost).
    update(tips: { id: string; pos: Vector3 | null }[]) {
      for (const t of tips) one(t.id, t.pos);
      for (const id of states.keys()) if (!tips.some((t) => t.id === id)) one(id, null);
    },
  };
}
