// The loading logo: a wireframe cube (a room) that draws itself edge by edge while it turns, with a scan line sweeping
// over it. Drawn on a canvas for the given time, so any panel can show it.
const VERTS: [number, number, number][] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0], // back face
  [4, 5], [5, 6], [6, 7], [7, 4], // front face
  [0, 4], [1, 5], [2, 6], [3, 7], // sides
];
// The order the edges are drawn in: floor first, then the corners going up, then the roof.
const ORDER = [3, 2, 1, 0, 11, 10, 9, 8, 6, 5, 4, 7];

const CYCLE = 3.6; // s
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => x * x * (3 - 2 * x);

export const LOADER_COLORS = { a: '#14b8a6', b: '#5eead4' };

export function drawLoader(c: CanvasRenderingContext2D, cx: number, cy: number, size: number, seconds: number, density: number) {
  const u = (seconds % CYCLE) / CYCLE;
  const turn = seconds * 0.85;
  const tilt = 0.5;
  const s = size * 0.27;
  const sinA = Math.sin(turn);
  const cosA = Math.cos(turn);
  const sinT = Math.sin(tilt);
  const cosT = Math.cos(tilt);
  const pts = VERTS.map(([x, y, z]) => {
    const x1 = x * cosA + z * sinA;
    const z1 = -x * sinA + z * cosA;
    const y1 = y * cosT - z1 * sinT;
    const z2 = y * sinT + z1 * cosT;
    return { x: cx + x1 * s, y: cy + y1 * s, z: z2 };
  });

  // soft glow behind the cube
  const glow = c.createRadialGradient(cx, cy, 0, cx, cy, size * 0.62);
  glow.addColorStop(0, 'rgba(45,212,191,0.20)');
  glow.addColorStop(1, 'rgba(45,212,191,0)');
  c.fillStyle = glow;
  c.fillRect(cx - size, cy - size, 2 * size, 2 * size);

  // progress of the drawing (0..1 while it draws, then it holds and fades)
  const drawing = clamp01(u / 0.55);
  const fade = u < 0.86 ? 1 : 1 - ease((u - 0.86) / 0.14);
  const pulse = u > 0.55 && u < 0.86 ? 0.75 + 0.25 * Math.sin((u - 0.55) * 40) : 1;
  // scan line height (-1 bottom .. 1 top), moving once the cube is drawn
  const scan = u > 0.3 && u < 0.86 ? -1 + 2 * ease((u - 0.3) / 0.56) : null;

  c.lineCap = 'round';
  c.lineJoin = 'round';
  ORDER.forEach((ei, k) => {
    const [i, j] = EDGES[ei];
    const t = ease(clamp01((drawing * (ORDER.length + 3) - k) / 3));
    if (t <= 0) return;
    const a = pts[i];
    const b = pts[j];
    const back = (a.z + b.z) / 2 < 0;
    const lit = scan !== null ? Math.max(0, 1 - Math.abs((VERTS[i][1] + VERTS[j][1]) / 2 - scan) * 1.2) : 0;
    const g = c.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, LOADER_COLORS.a);
    g.addColorStop(1, LOADER_COLORS.b);
    c.strokeStyle = g;
    c.globalAlpha = fade * pulse * (back ? 0.42 : 1);
    c.lineWidth = (back ? 2.2 : 3.6) + lit * 1.6;
    c.shadowColor = 'rgba(45,212,191,0.9)';
    c.shadowBlur = (back ? 4 : 10 + lit * 10) * density;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    c.stroke();
  });
  c.shadowColor = 'transparent';
  c.shadowBlur = 0;

  // corner dots
  if (drawing > 0.9) {
    c.fillStyle = '#ffffff';
    for (const p of pts) {
      c.globalAlpha = fade * (p.z < 0 ? 0.35 : 0.95);
      c.beginPath();
      c.arc(p.x, p.y, p.z < 0 ? 2 : 3.2, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.globalAlpha = 1;
}
