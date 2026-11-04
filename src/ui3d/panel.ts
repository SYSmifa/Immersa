import '@fontsource/sen/latin-500.css';
import '@fontsource/sen/latin-700.css';
import { hsvToHex, hsvToRgb, type Hsv } from './color';
import logoUrl from '../assets/logo-immersa.png';
import { drawLoader } from './loader';
import { drawIcon, type IconName } from './icons';
import { theme } from './theme';
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// One thing drawn on a panel. Coordinates are logical pixels (origin top-left).
export interface Widget {
  rect: Rect;
  text: string;
  sub?: string; // smaller second line
  // button / row / key / field: the basic controls. surface: a white card behind other widgets. card: a tappable card
  // (project, setting). chip: a small pill label. nav: a bottom-bar tab. iconbtn: a round icon button. pill: a
  // call-to-action pill. wheel / slider / bar: pickers.
  kind?: 'button' | 'label' | 'row' | 'key' | 'field' | 'surface' | 'card' | 'chip' | 'nav' | 'iconbtn' | 'pill' | 'loader' | 'splash' | 'wheel' | 'slider' | 'bar';
  onClick?: () => void;
  active?: boolean; // selected tab / current item
  primary?: boolean; // gradient fill
  glass?: boolean; // translucent white (on the gradient)
  disabled?: boolean;
  align?: 'left' | 'center';
  size?: number; // font px
  bold?: boolean;
  color?: string;
  fill?: string; // chip / iconbtn fill
  wrap?: boolean; // labels only
  icon?: IconName;
  since?: number; // splash: when it appeared (performance.now), for the fade-in
  badge?: string; // card: a pill at the right end
  badgeOn?: boolean; // card: the badge is highlighted
  reserve?: number; // card: px kept free at the right end for another widget drawn over it
  tone?: number; // card without an icon: which gradient the tile takes
  swatch?: string; // a small colour dot at the right end of a button / row / card
  value?: number; // bar / loader: 0..1 (a loader without a value shows no progress bar)
  hsv?: Hsv; // wheel / slider: the colour shown (wheel: hue and saturation, slider: brightness)
  // Wheel / slider: the pointed place inside the widget, 0..1 from its top-left; fires on press and while the pinch is
  // held and the ray stays over the widget.
  onPoint?(fx: number, fy: number): void;
}

// Canvas pixels per logical pixel: the panels are drawn denser than their layout so the text stays sharp when the
// compositor shows them as layers (and is smoother in the scene too). Layout and pointing keep using logical pixels.
export const PANEL_DENSITY = 1.5;

// Sen (bundled with the app, so it also works offline); the system fonts cover the symbols it does not have.
const FONT = 'Sen, system-ui, "Segoe UI", Roboto, sans-serif';

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

const font = (size: number, bold = false) => `${bold ? 700 : 500} ${size}px ${FONT}`;

function shadow(c: CanvasRenderingContext2D, blur: number, dy: number, color: string) {
  // Shadow sizes are in canvas pixels (the transform does not scale them).
  c.shadowColor = color;
  c.shadowBlur = blur * PANEL_DENSITY;
  c.shadowOffsetY = dy * PANEL_DENSITY;
}
const noShadow = (c: CanvasRenderingContext2D) => {
  c.shadowColor = 'transparent';
  c.shadowBlur = 0;
  c.shadowOffsetY = 0;
};
function gradient(c: CanvasRenderingContext2D, x: number, y: number, w: number, pair: [string, string]) {
  const g = c.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, pair[0]);
  g.addColorStop(1, pair[1]);
  return g;
}
const hashOf = (text: string) => [...text].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);

// Round knob of a slider.
function knob(c: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  shadow(c, 8, 3, 'rgba(30,10,90,0.35)');
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
  noShadow(c);
  c.strokeStyle = theme().accentText;
  c.lineWidth = 3;
  c.stroke();
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
    shadow(c, 8, 3, 'rgba(0,0,0,0.4)');
    c.lineWidth = 5;
    c.strokeStyle = '#ffffff';
    c.beginPath();
    c.arc(mx, my, 12, 0, 2 * Math.PI);
    c.stroke();
    noShadow(c);
    return;
  }
  const T = theme();
  const cy = y + h / 2;
  const pos = Math.min(1, Math.max(0, w.kind === 'bar' ? (w.value ?? 0) : val));
  const mx = x + h / 2 + pos * (ww - h);
  if (w.kind === 'bar') {
    c.fillStyle = T.accentSoft;
    roundRect(c, x, cy - 8, ww, 16, 8);
    c.fill();
    c.fillStyle = gradient(c, x, 0, ww, T.accent);
    roundRect(c, x, cy - 8, Math.max(16, mx - x), 16, 8);
    c.fill();
  } else {
    const g = c.createLinearGradient(x, 0, x + ww, 0);
    g.addColorStop(0, '#000000');
    g.addColorStop(1, hsvToHex(hue, sat, 1));
    c.fillStyle = g;
    roundRect(c, x, cy - 10, ww, 20, 10);
    c.fill();
  }
  knob(c, mx, cy, h / 2 - 2);
}

const allPanels = new Set<Panel>();
const logoImg = new Image();
if (typeof document !== 'undefined') logoImg.src = logoUrl;
// The canvas draws with whatever font it has at that moment: once Sen has loaded, every panel is drawn again.
if (typeof document !== 'undefined' && document.fonts) {
  void Promise.all([document.fonts.load('500 24px Sen'), document.fonts.load('700 24px Sen')]).then(() => allPanels.forEach((p) => p.invalidate()));
}

// A flat panel in 3D showing widgets drawn on a canvas. Pointing is handled by UiHost.
export class Panel {
  readonly mesh: Mesh;
  readonly canvas: HTMLCanvasElement;
  animated = false; // redrawn every frame (a loader on it)
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
    // 'gradient' (default): the theme's gradient with soft light spots; 'surface': a white card, for small panels;
    // 'ink': a dark card (loading); 'clear': nothing behind the widgets.
    private style: 'gradient' | 'surface' | 'ink' | 'clear' = 'gradient',
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
    this.texture.anisotropy = 4;
    this.mesh = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.mesh.renderOrder = 1000;
    this.mesh.userData.panel = this;
    allPanels.add(this);
  }

  // Draw again at the next frame (a theme or font changed).
  invalidate() {
    this.dirty = true;
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

  // (u, v) as in three's uv: origin bottom-left. Labels, chips and plain surfaces are not targets.
  widgetAt(u: number, v: number): Widget | null {
    const x = u * this.pxW;
    const y = (1 - v) * this.pxH;
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const w = this.widgets[i];
      if (w.kind === 'label' || w.kind === 'chip' || (w.kind === 'surface' && !w.onClick)) continue;
      const r = w.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return w;
    }
    return null;
  }

  draw() {
    if (this.animated) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    const c = this.ctx;
    const T = theme();
    c.clearRect(0, 0, this.pxW, this.pxH);
    noShadow(c);
    if (this.style === 'clear') {
      /* only the widgets */
    } else if (this.style === 'ink') {
      shadow(c, 24, 8, 'rgba(0,0,0,0.5)');
      c.fillStyle = 'rgba(11,13,18,0.94)';
      roundRect(c, 8, 6, this.pxW - 16, this.pxH - 20, 40);
      c.fill();
      noShadow(c);
      c.strokeStyle = 'rgba(45,212,191,0.35)';
      c.lineWidth = 2.5;
      roundRect(c, 9.25, 7.25, this.pxW - 18.5, this.pxH - 22.5, 39);
      c.stroke();
    } else if (this.style === 'surface') {
      shadow(c, 14, 5, T.shadow);
      c.fillStyle = T.surface;
      roundRect(c, 6, 4, this.pxW - 12, this.pxH - 14, Math.min(34, this.pxH / 2));
      c.fill();
      noShadow(c);
    } else {
      const g = c.createLinearGradient(0, 0, this.pxW * 0.35, this.pxH);
      for (const [at, col] of T.bgStops) g.addColorStop(at, col);
      c.save();
      roundRect(c, 0, 0, this.pxW, this.pxH, T.panelRadius);
      c.clip();
      c.fillStyle = g;
      c.fillRect(0, 0, this.pxW, this.pxH);
      for (const [fx, fy, r, col] of T.blobs) {
        const b = c.createRadialGradient(fx * this.pxW, fy * this.pxH, 0, fx * this.pxW, fy * this.pxH, r);
        b.addColorStop(0, col);
        b.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = b;
        c.fillRect(0, 0, this.pxW, this.pxH);
      }
      c.restore();
      c.strokeStyle = T.border;
      c.lineWidth = 2.5;
      roundRect(c, 1.25, 1.25, this.pxW - 2.5, this.pxH - 2.5, T.panelRadius);
      c.stroke();
    }
    for (const w of this.widgets) this.drawWidget(c, w);
    noShadow(c);
    this.texture.needsUpdate = true;
    this.stamp++;
  }

  private drawWidget(c: CanvasRenderingContext2D, w: Widget) {
    const { x, y, w: ww, h } = w.rect;
    const kind = w.kind ?? 'button';
    if (kind === 'wheel' || kind === 'slider' || kind === 'bar') return drawColorPicker(c, w);
    const T = theme();
    const hover = w === this.hover && !w.disabled;
    const down = w === this.pressed && !w.disabled;
    const size = w.size ?? 28;
    c.textBaseline = 'middle';

    if (kind === 'label') {
      c.fillStyle = w.color ?? T.text;
      c.font = font(size, w.bold);
      c.textAlign = w.align === 'center' ? 'center' : 'left';
      const tx = w.align === 'center' ? x + ww / 2 : x;
      if (w.wrap) {
        const lh = size * 1.3;
        wrapLines(c, w.text, ww).forEach((line, i) => c.fillText(line, tx, y + lh / 2 + i * lh));
      } else c.fillText(fit(c, w.text, ww), tx, y + h / 2 + 1);
      return;
    }
    if (kind === 'splash') {
      // The start-up screen: the wireframe cube drawing itself with the Immersa logo in front of it, nothing else.
      const t = (performance.now() - (w.since ?? 0)) / 1000;
      const fade = (w.value ?? 1) * Math.min(1, t / 0.8);
      drawLoader(c, x + ww / 2, y + h / 2, Math.min(h * 1.25, ww * 0.8), t, PANEL_DENSITY, fade);
      if (logoImg.complete && logoImg.naturalWidth) {
        const lw = ww * 0.86;
        const lh = (lw * logoImg.naturalHeight) / logoImg.naturalWidth;
        c.globalAlpha = fade;
        shadow(c, 16, 3, 'rgba(0,0,0,0.75)'); // keeps the white logo readable over a bright room
        c.drawImage(logoImg, x + (ww - lw) / 2, y + (h - lh) / 2, lw, lh);
        noShadow(c);
        c.globalAlpha = 1;
      }
      return;
    }
    if (kind === 'loader') {
      const t = performance.now() / 1000;
      const logo = Math.min(ww, h * 0.62);
      drawLoader(c, x + ww / 2, y + logo * 0.5, logo, t, PANEL_DENSITY);
      c.textAlign = 'center';
      c.fillStyle = '#ffffff';
      c.font = font(size + 4, true);
      c.fillText(fit(c, w.text, ww), x + ww / 2, y + logo + 22);
      if (w.sub) {
        c.fillStyle = 'rgba(255,255,255,0.66)';
        c.font = font(Math.round(size * 0.72));
        c.fillText(fit(c, w.sub, ww), x + ww / 2, y + logo + 22 + size * 1.25);
      }
      if (w.value !== undefined) {
        const bw = Math.min(ww * 0.7, 360);
        const by = y + h - 18;
        c.fillStyle = 'rgba(255,255,255,0.16)';
        roundRect(c, x + (ww - bw) / 2, by - 4, bw, 8, 4);
        c.fill();
        c.fillStyle = gradient(c, x + (ww - bw) / 2, 0, bw, ['#14b8a6', '#5eead4']);
        roundRect(c, x + (ww - bw) / 2, by - 4, Math.max(8, bw * Math.min(1, w.value)), 8, 4);
        c.fill();
      }
      return;
    }
    if (kind === 'surface') {
      shadow(c, 26, 10, T.shadow);
      c.fillStyle = hover ? T.surfaceHover : T.surface;
      roundRect(c, x, y, ww, h, 30);
      c.fill();
      noShadow(c);
      return;
    }
    if (kind === 'chip') {
      c.fillStyle = w.fill ?? T.glass;
      roundRect(c, x, y, ww, h, h / 2);
      c.fill();
      c.fillStyle = w.color ?? '#ffffff';
      c.font = font(size, true);
      c.textAlign = 'center';
      c.fillText(fit(c, w.text, ww - 16), x + ww / 2, y + h / 2 + 1);
      return;
    }
    if (kind === 'nav') {
      if (w.active) {
        c.fillStyle = T.accentSoft;
        roundRect(c, x + 8, y + 6, ww - 16, h - 12, 26);
        c.fill();
      } else if (hover) {
        c.fillStyle = 'rgba(20,184,166,0.12)';
        roundRect(c, x + 8, y + 6, ww - 16, h - 12, 26);
        c.fill();
      }
      const col = w.active ? T.accentText : T.dim;
      if (w.icon) drawIcon(c, w.icon, x + ww / 2, y + h * 0.36, 30, col);
      c.fillStyle = col;
      c.font = font(17, true);
      c.textAlign = 'center';
      c.fillText(w.text, x + ww / 2, y + h * 0.77);
      return;
    }
    if (kind === 'iconbtn') {
      const d = Math.min(ww, h);
      const cx = x + ww / 2;
      const cy = y + h / 2;
      if (w.primary) {
        shadow(c, 12, 4, T.accentGlow);
        c.fillStyle = gradient(c, x, y, ww, hover ? T.accentHover : T.accent);
      } else c.fillStyle = down ? 'rgba(255,255,255,0.5)' : hover ? T.glassHover : (w.fill ?? T.glass);
      c.beginPath();
      c.arc(cx, cy, d / 2, 0, Math.PI * 2);
      c.fill();
      noShadow(c);
      if (w.icon) drawIcon(c, w.icon, cx, cy, d * 0.46, w.color ?? '#ffffff');
      else {
        c.fillStyle = w.color ?? '#ffffff';
        c.font = font(size, true);
        c.textAlign = 'center';
        c.fillText(w.text, cx, cy + 1);
      }
      return;
    }
    if (kind === 'card') return this.drawCard(c, w, hover, down);

    // button / row / key / field / pill
    const r = kind === 'key' ? 16 : kind === 'row' ? 22 : h / 2;
    const accent = w.active || w.primary;
    let fill: string | CanvasGradient = T.surface;
    if (kind === 'field') fill = '#ffffff';
    else if (w.disabled) fill = 'rgba(255,255,255,0.5)';
    else if (accent) fill = gradient(c, x, y, ww, hover ? T.accentHover : T.accent);
    else if (w.glass) fill = hover ? T.glassHover : T.glass;
    else if (down) fill = T.surfaceDown;
    else if (hover) fill = T.surfaceHover;
    const lifted = !w.disabled && !w.glass && kind !== 'field';
    if (lifted) shadow(c, accent ? 16 : 12, accent ? 6 : 4, accent ? T.accentGlow : 'rgba(10,20,60,0.20)');
    c.fillStyle = fill;
    roundRect(c, x, y, ww, h, r);
    c.fill();
    noShadow(c);
    if (kind === 'field') {
      c.strokeStyle = T.accentText;
      c.lineWidth = 2.5;
      c.stroke();
    }
    const textColor = w.disabled ? T.textDisabled : accent || w.glass ? '#ffffff' : (w.color ?? T.text);
    c.fillStyle = textColor;
    const left = (w.align ?? (kind === 'row' || kind === 'field' ? 'left' : 'center')) === 'left';
    c.textAlign = left ? 'left' : 'center';
    const pad = kind === 'row' || kind === 'field' ? 22 : 12;
    const swatchW = w.swatch ? 56 : 0;
    const maxW = ww - 2 * pad - swatchW;
    c.font = font(size, kind === 'pill' || (accent && kind !== 'key'));
    let tx = left ? x + pad : x + ww / 2;
    if (w.icon) {
      const iconW = size * 1.1;
      const textW = Math.min(maxW - iconW - 10, c.measureText(w.text).width);
      const startX = left ? x + pad : x + ww / 2 - (iconW + 10 + textW) / 2;
      drawIcon(c, w.icon, startX + iconW / 2, y + h / 2, size * 1.05, textColor);
      tx = startX + iconW + 10;
      c.textAlign = 'left';
    }
    if (w.swatch) {
      c.fillStyle = w.swatch;
      c.beginPath();
      c.arc(x + ww - 34, y + h / 2, 15, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(15,26,51,0.25)';
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = textColor;
    }
    if (w.sub) {
      c.fillText(fit(c, w.text, maxW), tx, y + h * 0.36);
      c.font = font(Math.round(size * 0.68));
      c.fillStyle = w.disabled ? T.textDisabled : accent ? 'rgba(255,255,255,0.85)' : T.sub;
      c.fillText(fit(c, w.sub, maxW), tx, y + h * 0.72);
    } else {
      c.fillText(fit(c, w.text, w.icon ? ww - (tx - x) - pad : maxW), tx, y + h / 2 + 1);
    }
  }

  // A tappable card: a gradient tile (or an icon bubble), a title with a small line under it, and a badge, colour dot or
  // chevron at the right end.
  private drawCard(c: CanvasRenderingContext2D, w: Widget, hover: boolean, down: boolean) {
    const { x, y, w: ww, h } = w.rect;
    const T = theme();
    const on = w.active;
    // Under the laser a card is clearly different: tinted, with an outline and a glow.
    shadow(c, hover ? 30 : 24, hover ? 12 : 9, hover ? T.accentGlow : T.shadow);
    c.fillStyle = on ? gradient(c, x, y, ww, hover ? T.accentHover : T.accent) : w.disabled ? 'rgba(255,255,255,0.6)' : down ? T.surfaceDown : hover ? T.surfaceHover : T.surface;
    roundRect(c, x, y, ww, h, 28);
    c.fill();
    noShadow(c);
    if (hover) {
      c.strokeStyle = on ? '#ffffff' : T.accentText;
      c.lineWidth = 4;
      roundRect(c, x + 2, y + 2, ww - 4, h - 4, 26);
      c.stroke();
    }
    const ink = on ? '#ffffff' : T.text;
    // left visual
    const tile = Math.min(h - 24, 64);
    const lx = x + 18;
    const cy = y + h / 2;
    if (w.icon) {
      c.fillStyle = on ? 'rgba(255,255,255,0.25)' : T.accentSoft;
      c.beginPath();
      c.arc(lx + tile / 2, cy, tile / 2, 0, Math.PI * 2);
      c.fill();
      drawIcon(c, w.icon, lx + tile / 2, cy, tile * 0.5, on ? '#ffffff' : T.accentText);
    } else {
      const tone = T.tones[(w.tone ?? hashOf(w.text)) % T.tones.length];
      c.fillStyle = on ? 'rgba(255,255,255,0.28)' : gradient(c, lx, cy - tile / 2, tile, tone);
      roundRect(c, lx, cy - tile / 2, tile, tile, 20);
      c.fill();
      c.fillStyle = '#ffffff';
      c.font = font(Math.round(tile * 0.5), true);
      c.textAlign = 'center';
      c.fillText((w.text.trim()[0] ?? '?').toUpperCase(), lx + tile / 2, cy + 2);
    }
    // right end
    let right = x + ww - 22;
    if (w.badge) {
      c.font = font(18, true);
      const bw = c.measureText(w.badge).width + 30;
      right -= bw;
      c.fillStyle = w.badgeOn ? (on ? 'rgba(255,255,255,0.3)' : gradient(c, right, y, bw, T.accent)) : '#e6ebf5';
      roundRect(c, right, cy - 17, bw, 34, 17);
      c.fill();
      c.fillStyle = w.badgeOn ? '#ffffff' : T.dim;
      c.textAlign = 'center';
      c.fillText(w.badge, right + bw / 2, cy + 1);
      right -= 10;
    } else {
      if (!w.disabled && w.onClick && !w.reserve) drawIcon(c, 'chevron', right - 8, cy, 22, on ? '#ffffff' : T.faint);
      right -= 34 + (w.reserve ?? 0);
      if (w.swatch) {
        c.fillStyle = w.swatch;
        c.beginPath();
        c.arc(right - 12, cy, 15, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(15,26,51,0.25)';
        c.lineWidth = 2;
        c.stroke();
        right -= 38;
      }
    }
    // text
    const tx = lx + tile + 16;
    const maxW = right - tx - 6;
    c.textAlign = 'left';
    c.fillStyle = w.disabled ? T.textDisabled : ink;
    c.font = font(w.size ?? 26, true);
    c.fillText(fit(c, w.text, maxW), tx, w.sub ? y + h * 0.36 : cy + 1);
    if (w.sub) {
      c.fillStyle = on ? 'rgba(255,255,255,0.85)' : T.sub;
      c.font = font(19);
      c.fillText(fit(c, w.sub, maxW), tx, y + h * 0.7);
    }
  }
}
