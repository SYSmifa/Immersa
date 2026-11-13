import { Group, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Plane, Raycaster, SphereGeometry, Vector3 } from 'three';
import type { Panel, Widget } from './panel';

interface Hit {
  panel: Panel;
  widget: Widget | null;
  fx: number; // where in the widget (0..1 from its top-left)
  fy: number;
}
interface Pointer {
  cursor: Mesh;
  hover: Hit | null;
  press: Hit | null;
  flash: { panel: Panel; rect: { x: number; y: number }; until: number } | null; // a key tapped by a finger: shown pressed for a moment
  lastFx: number;
  lastFy: number;
}

const visible = (o: Object3D | null) => {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
};

// Turns rays (hands, controllers, a mouse) into hover / press / click on panels.
// A click fires on release for the widget that was under the ray when the press
// started, so a drifting hand ray cannot hit the wrong button.
export class UiHost {
  readonly root = new Group(); // holds the cursors; add it to the scene
  readonly noCursor = new Set<string>(); // pointers that draw their own cursor (the hand's laser)
  private panels = new Set<Panel>();
  private pointers = new Map<string, Pointer>();
  private raycaster = new Raycaster();

  add(panel: Panel) {
    this.panels.add(panel);
  }

  private pointer(id: string): Pointer {
    let p = this.pointers.get(id);
    if (!p) {
      const cursor = new Mesh(
        new SphereGeometry(0.007, 12, 8),
        new MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
      );
      cursor.renderOrder = 1500;
      cursor.visible = false;
      this.root.add(cursor);
      p = { cursor, hover: null, press: null, flash: null, lastFx: -1, lastFy: -1 };
      this.pointers.set(id, p);
    }
    return p;
  }

  // Call every frame per pointer; direction must be normalised. null = pointer lost.
  // Returns the distance to the panel under the ray (null: none), so other things can be picked only in front of it.
  setRay(id: string, origin: Vector3 | null, direction?: Vector3): number | null {
    const p = this.pointer(id);
    p.hover = null;
    p.cursor.visible = false;
    if (!origin || !direction) return null;
    this.drag(p, origin, direction);
    const meshes: Mesh[] = [];
    for (const panel of this.panels) {
      if (!visible(panel.mesh)) continue;
      panel.mesh.updateWorldMatrix(true, false);
      meshes.push(panel.mesh);
    }
    this.raycaster.set(origin, direction);
    this.raycaster.far = 3;
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit || !hit.uv) return null;
    const panel = hit.object.userData.panel as Panel;
    const widget = panel.widgetAt(hit.uv.x, hit.uv.y);
    const r = widget?.rect;
    const fx = r ? (hit.uv.x * panel.pxW - r.x) / r.w : 0;
    const fy = r ? ((1 - hit.uv.y) * panel.pxH - r.y) / r.h : 0;
    p.hover = { panel, widget, fx, fy };
    p.cursor.position.copy(hit.point);
    p.cursor.visible = !this.noCursor.has(id);
    (p.cursor.material as MeshBasicMaterial).color.set(widget ? 0x66ffee : 0xffffff);
    return hit.distance;
  }

  // A colour wheel / slider keeps following the pinch while it is held, even when the ray leaves the widget (or the
  // panel): the ray is cut with the panel's plane and the point is clamped to the widget.
  private drag(p: Pointer, origin: Vector3, direction: Vector3) {
    const held = p.press?.widget;
    if (!p.press || !held?.onPoint) return;
    const panel = p.press.panel;
    const mesh = panel.mesh;
    mesh.updateWorldMatrix(true, false);
    const normal = new Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
    const at = this.raycaster.ray.set(origin, direction).intersectPlane(new Plane().setFromNormalAndCoplanarPoint(normal, mesh.getWorldPosition(new Vector3())), new Vector3());
    if (!at) return;
    const local = mesh.worldToLocal(at);
    const g = (mesh.geometry as PlaneGeometry).parameters;
    const r = held.rect;
    const fx = Math.min(1, Math.max(0, ((local.x / g.width + 0.5) * panel.pxW - r.x) / r.w));
    const fy = Math.min(1, Math.max(0, ((0.5 - local.y / g.height) * panel.pxH - r.y) / r.h));
    if (Math.abs(fx - p.lastFx) < 0.002 && Math.abs(fy - p.lastFy) < 0.002) return;
    p.lastFx = fx;
    p.lastFy = fy;
    // The widgets are rebuilt after every change: call the current copy of the one that was pressed.
    const now = panel.widgets.find((w) => w.kind === held.kind && w.rect.x === r.x && w.rect.y === r.y) ?? held;
    now.onPoint?.(fx, fy);
  }

  // True when the pointer is over a panel: the press belongs to the UI.
  press(id: string): boolean {
    const p = this.pointer(id);
    if (!p.hover) return false;
    p.press = p.hover.widget && !p.hover.widget.disabled ? p.hover : null;
    p.lastFx = p.hover.fx;
    p.lastFy = p.hover.fy;
    p.press?.widget?.onPoint?.(Math.min(1, Math.max(0, p.hover.fx)), Math.min(1, Math.max(0, p.hover.fy))); // a plain click picks too
    p.press?.widget?.onDown?.();
    return true;
  }

  release(id: string) {
    const p = this.pointer(id);
    const hit = p.press;
    p.press = null;
    hit?.widget?.onUp?.();
    hit?.widget?.onClick?.();
  }

  // A finger touched what the pointer is on: it acts at once (a key types as the finger lands) and looks pressed for a moment.
  tap(id: string): boolean {
    const p = this.pointer(id);
    const w = p.hover?.widget;
    if (!p.hover || !w || w.disabled || !w.onClick) return false;
    p.flash = { panel: p.hover.panel, rect: { x: w.rect.x, y: w.rect.y }, until: performance.now() + 130 };
    w.onClick();
    return true;
  }

  cancel(id: string) {
    const p = this.pointer(id);
    p.press?.widget?.onUp?.();
    p.press = null;
  }

  // Once per frame, after setRay calls: refresh highlights and redraw changed panels.
  update() {
    const hover = new Map<Panel, Widget | null>();
    const pressed = new Map<Panel, Widget | null>();
    for (const p of this.pointers.values()) {
      if (p.hover && (p.hover.widget || !hover.has(p.hover.panel))) hover.set(p.hover.panel, p.hover.widget);
      if (p.press) pressed.set(p.press.panel, p.press.widget);
      if (p.flash) {
        if (performance.now() > p.flash.until) p.flash = null;
        else {
          // the widgets may have been rebuilt by the tap: find the one in the same place
          const f = p.flash;
          const w = f.panel.widgets.find((x) => x.rect.x === f.rect.x && x.rect.y === f.rect.y);
          if (w) pressed.set(f.panel, w);
        }
      }
    }
    for (const panel of this.panels) {
      panel.setHover(hover.get(panel) ?? null);
      panel.setPressed(pressed.get(panel) ?? null);
      panel.draw();
    }
  }
}
