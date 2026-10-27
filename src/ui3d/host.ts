import { Group, Mesh, MeshBasicMaterial, Object3D, Raycaster, SphereGeometry, Vector3 } from 'three';
import type { Panel, Widget } from './panel';

interface Hit {
  panel: Panel;
  widget: Widget | null;
}
interface Pointer {
  cursor: Mesh;
  hover: Hit | null;
  press: Hit | null;
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
      cursor.renderOrder = 1001;
      cursor.visible = false;
      this.root.add(cursor);
      p = { cursor, hover: null, press: null };
      this.pointers.set(id, p);
    }
    return p;
  }

  // Call every frame per pointer; direction must be normalised. null = pointer lost.
  setRay(id: string, origin: Vector3 | null, direction?: Vector3) {
    const p = this.pointer(id);
    p.hover = null;
    p.cursor.visible = false;
    if (!origin || !direction) return;
    const meshes: Mesh[] = [];
    for (const panel of this.panels) {
      if (!visible(panel.mesh)) continue;
      panel.mesh.updateWorldMatrix(true, false);
      meshes.push(panel.mesh);
    }
    this.raycaster.set(origin, direction);
    this.raycaster.far = 3;
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit || !hit.uv) return;
    const panel = hit.object.userData.panel as Panel;
    const widget = panel.widgetAt(hit.uv.x, hit.uv.y);
    p.hover = { panel, widget };
    p.cursor.position.copy(hit.point);
    p.cursor.visible = true;
    (p.cursor.material as MeshBasicMaterial).color.set(widget ? 0x66ffee : 0xffffff);
  }

  // True when the pointer is over a panel: the press belongs to the UI.
  press(id: string): boolean {
    const p = this.pointer(id);
    if (!p.hover) return false;
    p.press = p.hover.widget && !p.hover.widget.disabled ? p.hover : null;
    return true;
  }

  release(id: string) {
    const p = this.pointer(id);
    const hit = p.press;
    p.press = null;
    hit?.widget?.onClick?.();
  }

  cancel(id: string) {
    this.pointer(id).press = null;
  }

  // Once per frame, after setRay calls: refresh highlights and redraw changed panels.
  update() {
    const hover = new Map<Panel, Widget | null>();
    const pressed = new Map<Panel, Widget | null>();
    for (const p of this.pointers.values()) {
      if (p.hover && (p.hover.widget || !hover.has(p.hover.panel))) hover.set(p.hover.panel, p.hover.widget);
      if (p.press) pressed.set(p.press.panel, p.press.widget);
    }
    for (const panel of this.panels) {
      panel.setHover(hover.get(panel) ?? null);
      panel.setPressed(pressed.get(panel) ?? null);
      panel.draw();
    }
  }
}
