// Small line icons drawn on a canvas (no font or image needed). Each is drawn in a -1..1 box scaled to `size` px.
export type IconName =
  | 'folder' | 'scan' | 'sliders' | 'user' | 'close' | 'back' | 'chevron' | 'rotate' | 'scale' | 'palette'
  | 'trash' | 'check' | 'cube' | 'menu' | 'plus' | 'left' | 'right';

type Ctx = CanvasRenderingContext2D;

const poly = (c: Ctx, pts: number[]) => {
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
};

const DRAW: Record<IconName, (c: Ctx, color: string) => void> = {
  folder: (c) => {
    poly(c, [-1, -0.55, -0.4, -0.55, -0.12, -0.25, 1, -0.25, 1, 0.75, -1, 0.75]);
    c.closePath();
  },
  scan: (c) => {
    c.arc(0, 0, 0.62, 0, Math.PI * 2);
    c.moveTo(0.18, 0);
    c.arc(0, 0, 0.18, 0, Math.PI * 2);
    for (const [x, y, u, v] of [[0, -1, 0, 0.3], [0, 1, 0, -0.3], [-1, 0, 0.3, 0], [1, 0, -0.3, 0]]) {
      c.moveTo(x, y);
      c.lineTo(x + u, y + v);
    }
  },
  sliders: (c, color) => {
    for (const [y, k] of [[-0.6, -0.35], [0, 0.4], [0.6, -0.1]]) {
      c.moveTo(-1, y);
      c.lineTo(1, y);
      c.moveTo(k + 0.22, y);
      c.arc(k, y, 0.22, 0, Math.PI * 2);
    }
    c.fillStyle = color;
  },
  user: (c) => {
    c.arc(0, -0.4, 0.38, 0, Math.PI * 2);
    c.moveTo(-0.9, 0.95);
    c.bezierCurveTo(-0.9, 0.25, 0.9, 0.25, 0.9, 0.95);
  },
  close: (c) => {
    poly(c, [-0.65, -0.65, 0.65, 0.65]);
    poly(c, [0.65, -0.65, -0.65, 0.65]);
  },
  back: (c) => poly(c, [0.35, -0.85, -0.5, 0, 0.35, 0.85]),
  chevron: (c) => poly(c, [-0.35, -0.85, 0.5, 0, -0.35, 0.85]),
  left: (c) => poly(c, [0.35, -0.85, -0.5, 0, 0.35, 0.85]),
  right: (c) => poly(c, [-0.35, -0.85, 0.5, 0, -0.35, 0.85]),
  rotate: (c) => {
    c.arc(0, 0, 0.75, -0.4 * Math.PI, 1.35 * Math.PI);
    poly(c, [0.62, -0.95, 0.72, -0.5, 0.28, -0.52]);
  },
  scale: (c) => {
    poly(c, [-0.75, 0.75, 0.75, -0.75]);
    poly(c, [0.1, -0.75, 0.75, -0.75, 0.75, -0.1]);
    poly(c, [-0.1, 0.75, -0.75, 0.75, -0.75, 0.1]);
  },
  palette: (c, color) => {
    c.arc(0, 0, 0.92, 0, Math.PI * 2);
    for (const [x, y] of [[-0.35, -0.3], [0.3, -0.4], [0.5, 0.15], [-0.4, 0.3]]) {
      c.moveTo(x + 0.12, y);
      c.arc(x, y, 0.12, 0, Math.PI * 2);
    }
    c.fillStyle = color;
  },
  trash: (c) => {
    poly(c, [-0.85, -0.5, 0.85, -0.5]);
    poly(c, [-0.3, -0.5, -0.3, -0.85, 0.3, -0.85, 0.3, -0.5]);
    poly(c, [-0.6, -0.5, -0.5, 0.9, 0.5, 0.9, 0.6, -0.5]);
  },
  check: (c) => poly(c, [-0.8, 0.05, -0.25, 0.6, 0.85, -0.55]),
  cube: (c) => {
    poly(c, [0, -1, 0.85, -0.5, 0.85, 0.5, 0, 1, -0.85, 0.5, -0.85, -0.5]);
    c.closePath();
    poly(c, [-0.85, -0.5, 0, 0, 0.85, -0.5]);
    poly(c, [0, 0, 0, 1]);
  },
  menu: (c) => {
    for (const y of [-0.6, 0, 0.6]) poly(c, [-0.85, y, 0.85, y]);
  },
  plus: (c) => {
    poly(c, [-0.8, 0, 0.8, 0]);
    poly(c, [0, -0.8, 0, 0.8]);
  },
};

export function drawIcon(c: Ctx, name: IconName, cx: number, cy: number, size: number, color: string) {
  const r = size / 2;
  c.save();
  c.translate(cx, cy);
  c.scale(r, r);
  c.beginPath();
  c.strokeStyle = color;
  c.lineWidth = 0.2;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  DRAW[name](c, color);
  c.stroke();
  if (name === 'sliders' || name === 'palette') c.fill();
  c.restore();
}
