import { hsvToHex, hsvToRgb, type Hsv } from './color';
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
  kind?: 'button' | 'label' | 'row' | 'key' | 'field' | 'wheel' | 'slider' | 'bar';
  onClick?: () => void;
  active?: boolean; // selected tab / current item
  primary?: boolean;
  disabled?: boolean;
  align?: 'left' | 'center';
  size?: number; // font px
  color?: string;
  wrap?: boolean; // labels only
  swatch?: string; // a small colour square at the right end of a button / row
  value?: number; // bar: 0..1
  hsv?: Hsv; // wheel / slider: the colour shown (wheel: hue and saturation, slider: brightness)
  // Wheel / slider: the pointed place inside the widget, 0..1 from its top-left; fires on press and while the pinch is
  // held and the ray stays over the widget.
  onPoint?(fx: number, fy: number): void;
}

// Canvas pixels per logical pixel: the panels are drawn denser than their layout so the text stays sharp when the
// compositor shows them as layers (and is smoother in the scene too). Layout and pointing keep using logical pixels.
export const PANEL_DENSITY = 1.5;

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

// Hue / saturation disc, drawn once per size and brightness step and then reused.
const discs = new Map<string, HTMLCanvasElement>();
function disc(logical: number, v: number): HTMLCanvasElement {
  const size = Math.round(logical * PANEL_DENSITY);
  const key = `${size}:${Math.round(v * 20)}`;
  let cv = discs.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const r0 = size / 2;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const dx = i + 0.5 - r0;
        const dy = j + 0.5 - r0;
        const d = Math.hypot(dx, dy) / r0;
        if (d > 1) continue;
        const [r, g, b] = hsvToRgb((Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1, d, Math.round(v * 20) / 20);
        const k = (j * size + i) * 4;
        img.data.set([r * 255, g * 255, b * 255, 255], k);
      }
    }
    ctx.putImageData(img, 0, 0);
    discs.set(key, cv);
  }
  return cv;
}

function drawColorPicker(c: CanvasRenderingContext2D, w: Widget) {
  const { x, y, w: ww, h } = w.rect;
  const [hue, sat, val] = w.hsv ?? [0, 0, 1];
  if (w.kind === 'wheel') {
    const size = Math.round(Math.min(ww, h));
    const cx = x + ww / 2;
    const cy = y + h / 2;
    c.drawImage(disc(size, val), cx - size / 2, cy - size / 2, size, size);
    const a = hue * 2 * Math.PI;
    const mx = cx + Math.cos(a) * sat * (size / 2);
    const my = cy + Math.sin(a) * sat * (size / 2);
    c.lineWidth = 4;
    c.strokeStyle = '#ffffff';
    c.beginPath();
    c.arc(mx, my, 11, 0, 2 * Math.PI);
    c.stroke();
    c.strokeStyle = '#000000aa';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(mx, my, 14, 0, 2 * Math.PI);
    c.stroke();
    return;
  }
  const g = c.createLinearGradient(x, 0, x + ww, 0);
  g.addColorStop(0, w.kind === 'bar' ? '#2f3648' : '#000000');
  g.addColorStop(1, w.kind === 'bar' ? '#8fa6d8' : hsvToHex(hue, sat, 1));
  c.fillStyle = g;
  roundRect(c, x, y, ww, h, 12);
  c.fill();
  const mx = x + (w.kind === 'bar' ? (w.value ?? 0) : val) * ww;
  c.fillStyle = '#ffffff';
  roundRect(c, mx - 6, y - 4, 12, h + 8, 6);
  c.fill();
  c.strokeStyle = '#000000aa';
  c.lineWidth = 2;
  c.stroke();
}

// A flat panel in 3D showing widgets drawn on a canvas. Pointing is handled by UiHost.
export class Panel {
  readonly mesh: Mesh;
  readonly canvas: HTMLCanvasElement;
  stamp = 0; // counts redraws: the layer path uploads the canvas when it changes
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
    canvas.width = Math.round(this.pxW * PANEL_DENSITY);
    canvas.height = Math.round(this.pxH * PANEL_DENSITY);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.setTransform(PANEL_DENSITY, 0, 0, PANEL_DENSITY, 0, 0);
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
    this.stamp++;
  }

  private drawWidget(c: CanvasRenderingContext2D, w: Widget) {
    const { x, y, w: ww, h } = w.rect;
    const kind = w.kind ?? 'button';
    if (kind === 'wheel' || kind === 'slider' || kind === 'bar') return drawColorPicker(c, w);
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
    const maxW = ww - (left && kind !== 'label' ? 40 : 8) - (w.swatch ? 56 : 0);

    if (w.swatch) {
      c.fillStyle = w.swatch;
      roundRect(c, x + ww - 56, y + h / 2 - 17, 38, 34, 8);
      c.fill();
      c.strokeStyle = '#ffffff55';
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = w.disabled ? '#667086' : (w.color ?? '#ffffff');
    }
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
