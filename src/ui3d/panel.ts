import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// One thing drawn on a panel. Coordinates are canvas pixels (origin top-left).
export interface Widget {
  rect: Rect;
  text: string;
  sub?: string; // smaller second line
  kind?: 'button' | 'label' | 'row' | 'key' | 'field';
  onClick?: () => void;
  active?: boolean; // selected tab / current item
  primary?: boolean;
  disabled?: boolean;
  align?: 'left' | 'center';
  size?: number; // font px
  color?: string;
  wrap?: boolean; // labels only
}

const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function fit(c: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (c.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function wrapLines(c: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && c.measureText(next).width > maxW) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

// A flat panel in 3D showing widgets drawn on a canvas. Pointing is handled by UiHost.
export class Panel {
  readonly mesh: Mesh;
  readonly pxW: number;
  readonly pxH: number;
  widgets: Widget[] = [];
  private hover: Widget | null = null;
  private pressed: Widget | null = null;
  private ctx: CanvasRenderingContext2D;
  private texture: CanvasTexture;
  private dirty = true;

  constructor(
    width: number, // metres
    height: number,
    pxPerMetre = 1200,
    private background = 'rgba(14,16,22,0.94)',
  ) {
    this.pxW = Math.round(width * pxPerMetre);
    this.pxH = Math.round(height * pxPerMetre);
    const canvas = document.createElement('canvas');
    canvas.width = this.pxW;
    canvas.height = this.pxH;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.mesh.renderOrder = 1000;
    this.mesh.userData.panel = this;
  }

  set(widgets: Widget[]) {
    this.widgets = widgets;
    this.hover = this.pressed = null;
    this.dirty = true;
  }

  setHover(w: Widget | null) {
    if (w !== this.hover) {
      this.hover = w;
      this.dirty = true;
    }
  }

  setPressed(w: Widget | null) {
    if (w !== this.pressed) {
      this.pressed = w;
      this.dirty = true;
    }
  }

  // (u, v) as in three's uv: origin bottom-left. Labels are not targets.
  widgetAt(u: number, v: number): Widget | null {
    const x = u * this.pxW;
    const y = (1 - v) * this.pxH;
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const w = this.widgets[i];
      if (w.kind === 'label') continue;
      const r = w.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return w;
    }
    return null;
  }

  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    const c = this.ctx;
    c.clearRect(0, 0, this.pxW, this.pxH);
    c.fillStyle = this.background;
    roundRect(c, 0, 0, this.pxW, this.pxH, 28);
    c.fill();
    for (const w of this.widgets) this.drawWidget(c, w);
    this.texture.needsUpdate = true;
  }

  private drawWidget(c: CanvasRenderingContext2D, w: Widget) {
    const { x, y, w: ww, h } = w.rect;
    const kind = w.kind ?? 'button';
    const size = w.size ?? 30;
    const hover = w === this.hover && !w.disabled;
    const down = w === this.pressed && !w.disabled;

    if (kind !== 'label') {
      let bg = '#2a3040';
      if (kind === 'field') bg = '#0a0c11';
      else if (w.disabled) bg = '#191d27';
      else if (down) bg = '#4a78ff';
      else if (w.active || w.primary) bg = hover ? '#4f7dff' : '#3466f0';
      else if (hover) bg = '#3a4560';
      c.fillStyle = bg;
      roundRect(c, x, y, ww, h, kind === 'key' ? 14 : 16);
      c.fill();
      if (kind === 'field') {
        c.strokeStyle = '#3a4560';
        c.lineWidth = 2;
        c.stroke();
      }
    }

    c.fillStyle = w.disabled ? '#667086' : (w.color ?? '#ffffff');
    c.textBaseline = 'middle';
    const left = (w.align ?? (kind === 'row' || kind === 'label' || kind === 'field' ? 'left' : 'center')) === 'left';
    c.textAlign = left ? 'left' : 'center';
    const tx = left ? x + (kind === 'label' ? 0 : 20) : x + ww / 2;
    const maxW = ww - (left && kind !== 'label' ? 40 : 8);

    c.font = `${size}px ${FONT}`;
    if (kind === 'label' && w.wrap) {
      const lines = wrapLines(c, w.text, maxW);
      const lh = size * 1.3;
      lines.forEach((line, i) => c.fillText(line, tx, y + lh / 2 + i * lh));
      return;
    }
    if (w.sub) {
      c.fillText(fit(c, w.text, maxW), tx, y + h * 0.36);
      c.font = `${Math.round(size * 0.68)}px ${FONT}`;
      c.fillStyle = w.disabled ? '#667086' : '#aab4cc';
      c.fillText(fit(c, w.sub, maxW), tx, y + h * 0.74);
    } else {
      c.fillText(fit(c, w.text, maxW), tx, y + h / 2 + 1);
    }
  }
}
