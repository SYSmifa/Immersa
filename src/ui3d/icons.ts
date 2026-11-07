// Small line icons drawn on a canvas (no font or image needed). Each is drawn in a -1..1 box scaled to `size` px.
export type IconName =
  | 'folder' | 'scan' | 'sliders' | 'user' | 'close' | 'back' | 'chevron' | 'rotate' | 'scale' | 'palette'
  | 'room' | 'room_iso' | 'room_plan' | 'room_scan' | 'room_house' | 'trash' | 'check' | 'cube' | 'menu' | 'plus' | 'left' | 'right' | 'search' | 'google';

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
    // a circular arrow: three quarters of a circle, the arrow head at its clockwise end
    const r = 0.72;
    const e = -0.3 * Math.PI;
    c.arc(0, 0, r, 0.15 * Math.PI, e + 2 * Math.PI);
    const px = r * Math.cos(e);
    const py = r * Math.sin(e);
    const tx = -Math.sin(e); // clockwise tangent on screen
    const ty = Math.cos(e);
    const nx = Math.cos(e);
    const ny = Math.sin(e);
    c.moveTo(px + tx * 0.34, py + ty * 0.34);
    c.lineTo(px + nx * 0.3, py + ny * 0.3);
    c.moveTo(px + tx * 0.34, py + ty * 0.34);
    c.lineTo(px - nx * 0.3, py - ny * 0.3);
  },
  scale: (c) => {
    poly(c, [-0.75, 0.75, 0.75, -0.75]);
    poly(c, [0.1, -0.75, 0.75, -0.75, 0.75, -0.1]);
    poly(c, [-0.1, 0.75, -0.75, 0.75, -0.75, 0.1]);
  },
  palette: (c, color) => {
    c.arc(0, 0, 0.92, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    for (const [x, y] of [[-0.35, -0.3], [0.3, -0.4], [0.5, 0.15], [-0.4, 0.3]]) {
      c.moveTo(x + 0.12, y);
      c.arc(x, y, 0.12, 0, Math.PI * 2);
    }
    c.fillStyle = color;
    c.fill();
    c.beginPath();
  },
  // The inside corner of a room: floor and two walls, as a wireframe.
  room: (c) => {
    poly(c, [-0.9, 0.35, 0, 0.85, 0.9, 0.35, 0, -0.15]);
    c.closePath();
    poly(c, [0, -0.15, 0, -0.95]);
    poly(c, [-0.9, 0.35, -0.9, -0.45, 0, -0.95, 0.9, -0.45, 0.9, 0.35]);
  },
  // A cube seen from a corner, see-through: the hexagon with the three front edges solid, the back ones lighter.
  room_iso: (c) => {
    poly(c, [0, -1, 0.87, -0.5, 0.87, 0.5, 0, 1, -0.87, 0.5, -0.87, -0.5]);
    c.closePath();
    poly(c, [-0.87, -0.5, 0, 0, 0.87, -0.5]);
    poly(c, [0, 0, 0, 1]);
    c.stroke();
    c.globalAlpha = 0.4;
    c.beginPath();
    poly(c, [0, -1, 0, 0]);
    poly(c, [-0.87, 0.5, 0, 0, 0.87, 0.5]);
  },
  // A floor plan seen from above: walls with a door opening and a partition.
  room_plan: (c) => {
    poly(c, [-0.25, 0.85, -0.85, 0.85, -0.85, -0.85, 0.85, -0.85, 0.85, 0.85, 0.35, 0.85]);
    poly(c, [0, -0.85, 0, -0.1]);
    poly(c, [-0.85, -0.1, -0.35, -0.1]);
  },
  // Scan corners around a small cube.
  room_scan: (c) => {
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) poly(c, [sx * 0.95, sy * 0.45, sx * 0.95, sy * 0.95, sx * 0.45, sy * 0.95]);
    poly(c, [0, -0.5, 0.43, -0.25, 0.43, 0.25, 0, 0.5, -0.43, 0.25, -0.43, -0.25]);
    c.closePath();
    poly(c, [-0.43, -0.25, 0, 0, 0.43, -0.25]);
    poly(c, [0, 0, 0, 0.5]);
  },
  room_house: (c) => {
    poly(c, [-0.85, 0.85, -0.85, -0.1, 0, -0.9, 0.85, -0.1, 0.85, 0.85]);
    c.closePath();
    poly(c, [-0.2, 0.85, -0.2, 0.25, 0.2, 0.25, 0.2, 0.85]);
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
  google: () => undefined, // drawn in colour by drawIcon
  search: (c) => {
    c.arc(-0.2, -0.2, 0.58, 0, Math.PI * 2);
    c.moveTo(0.22, 0.22);
    c.lineTo(0.85, 0.85);
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
  if (name === 'google') {
    // The "G" in its four colours: a ring open at the upper right, and the bar.
    const arc = (col: string, a0: number, a1: number) => {
      c.beginPath();
      c.strokeStyle = col;
      c.arc(0, 0, 0.62, (a0 * Math.PI) / 180, (a1 * Math.PI) / 180);
      c.stroke();
    };
    c.lineWidth = 0.34;
    c.lineCap = 'butt';
    arc('#EA4335', 200, 315);
    arc('#FBBC05', 125, 200);
    arc('#34A853', 55, 125);
    arc('#4285F4', 0, 55);
    c.beginPath();
    c.moveTo(0.04, 0);
    c.lineTo(0.8, 0);
    c.strokeStyle = '#4285F4';
    c.stroke();
    c.restore();
    return;
  }
  c.beginPath();
  c.strokeStyle = color;
  c.lineWidth = 0.2;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  DRAW[name](c, color);
  c.stroke();
  if (name === 'sliders') c.fill();
  c.restore();
}
