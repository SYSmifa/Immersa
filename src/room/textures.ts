// Catalogue of classic surface textures for walls and floors, drawn with canvas (no image files to ship or download).
// Each one is a small PBR set built from one drawing: colour, a height field, and from the height the normal map, the
// ambient-occlusion map (cavities darker) and the roughness map (grout / pores rougher than the surface). Each tiles
// seamlessly and covers `size` metres of real surface.
export interface TextureDef {
  id: string;
  name: string;
  size: number; // metres covered by one tile of the image
  roughness: number; // of the surface itself (grout and pores come out rougher)
  bump: number; // strength of the normal map
  draw(ctx: CanvasRenderingContext2D, n: number, p: Paint): void;
}
// The same drawing runs twice: `p(colour, height)` gives the colour in the colour pass and a grey for the height in the other.
export type Paint = (colour: string, height: number, alpha?: number) => string;

// Small seeded random: the same texture looks the same on every device and in both passes.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};
const grey = (h: number, alpha = 1) => {
  const v = Math.max(0, Math.min(255, Math.round(h * 255)));
  return `rgba(${v},${v},${v},${alpha})`;
};
// Speckle over the tile: in the colour pass light / dark dots, in the height pass small bumps and pits.
function grain(ctx: CanvasRenderingContext2D, n: number, rand: () => number, count: number, alpha: number, p: Paint) {
  const colourPass = p('#ffffff', 1) === '#ffffff';
  for (let i = 0; i < count; i++) {
    const up = rand() > 0.5;
    const a = rand() * alpha;
    const x = rand() * n;
    const y = rand() * n;
    const w = 1 + rand() * 2;
    ctx.globalAlpha = Math.min(1, colourPass ? a : a * 3);
    ctx.fillStyle = p(up ? '#ffffff' : '#000000', up ? 0.85 : 0.15);
    ctx.fillRect(x, y, w, w);
  }
  ctx.globalAlpha = 1;
}

export const TEXTURES: TextureDef[] = [
  {
    id: 'parquet',
    name: 'Parquet',
    size: 1.2,
    roughness: 0.5,
    bump: 5,
    draw(ctx, n, p) {
      const rand = rng(11);
      const tones = ['#b98253', '#a8703f', '#c48f60', '#9b6a3e'];
      const rows = 6;
      const h = n / rows;
      ctx.fillStyle = p('#2a1608', 0.05);
      ctx.fillRect(0, 0, n, n);
      for (let r = 0; r < rows; r++) {
        const plank = n / 2;
        const off = (r % 2) * (plank / 2);
        for (let c = -1; c < 3; c++) {
          const x = off + c * plank;
          const tone = tones[Math.floor(rand() * tones.length)];
          const lift = 0.8 + rand() * 0.1;
          ctx.fillStyle = p(tone, lift);
          ctx.fillRect(x + 1.5, r * h + 1.5, plank - 3, h - 3);
          // grain: dark streaks following the plank
          for (let g = 0; g < 9; g++) {
            const y = r * h + 4 + rand() * (h - 8);
            const wobble = rand() * 6 - 3;
            ctx.strokeStyle = p('rgba(60,30,10,0.22)', lift - 0.12, 0.6);
            ctx.lineWidth = 0.8 + rand();
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.bezierCurveTo(x + plank * 0.3, y + wobble, x + plank * 0.6, y - wobble, x + plank, y);
            ctx.stroke();
          }
        }
      }
    },
  },
  {
    id: 'tiles',
    name: 'Piastrelle',
    size: 1.2,
    roughness: 0.22,
    bump: 6,
    draw(ctx, n, p) {
      const rand = rng(23);
      ctx.fillStyle = p('#8b929c', 0.12);
      ctx.fillRect(0, 0, n, n);
      const cells = 3;
      const t = n / cells;
      for (let y = 0; y < cells; y++)
        for (let x = 0; x < cells; x++) {
          const k = 0.96 + rand() * 0.06;
          ctx.fillStyle = p(shade('#e6e9ee', k), 0.85 + rand() * 0.04);
          ctx.fillRect(x * t + 4, y * t + 4, t - 8, t - 8);
          // a soft bevel at the edge of each tile
          ctx.strokeStyle = p('rgba(255,255,255,0.5)', 0.97, 0.7);
          ctx.lineWidth = 2;
          ctx.strokeRect(x * t + 5, y * t + 5, t - 10, t - 10);
        }
    },
  },
  {
    id: 'mosaic',
    name: 'Mosaico',
    size: 0.6,
    roughness: 0.3,
    bump: 6,
    draw(ctx, n, p) {
      const rand = rng(37);
      const tones = ['#1f7a8c', '#2aa3b5', '#5ec2cf', '#a7dde4', '#16606f', '#e8f6f8'];
      const cells = 16;
      const t = n / cells;
      ctx.fillStyle = p('#cfd8dc', 0.08);
      ctx.fillRect(0, 0, n, n);
      for (let y = 0; y < cells; y++)
        for (let x = 0; x < cells; x++) {
          ctx.fillStyle = p(tones[Math.floor(rand() * tones.length)], 0.8 + rand() * 0.12);
          ctx.fillRect(x * t + 2, y * t + 2, t - 4, t - 4);
        }
    },
  },
  {
    id: 'plaster',
    name: 'Muro classico',
    size: 1.5,
    roughness: 0.92,
    bump: 2.5,
    draw(ctx, n, p) {
      const rand = rng(41);
      ctx.fillStyle = p('#ece8df', 0.5);
      ctx.fillRect(0, 0, n, n);
      // soft trowel marks
      for (let i = 0; i < 60; i++) {
        const x = rand() * n;
        const y = rand() * n;
        const r = 20 + rand() * 50;
        const up = rand() > 0.5;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, p(up ? 'rgba(255,255,255,0.18)' : 'rgba(120,110,95,0.12)', up ? 0.7 : 0.3, 0.25));
        g.addColorStop(1, p('rgba(255,255,255,0)', 0.5, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      grain(ctx, n, rand, 9000, 0.1, p);
    },
  },
  {
    id: 'brick',
    name: 'Mattoni',
    size: 1,
    roughness: 0.85,
    bump: 6,
    draw(ctx, n, p) {
      const rand = rng(53);
      ctx.fillStyle = p('#cbbfb2', 0.12);
      ctx.fillRect(0, 0, n, n);
      const rows = 8;
      const h = n / rows;
      const w = n / 4;
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) * (w / 2);
        for (let c = -1; c < 5; c++) {
          ctx.fillStyle = p(shade('#a9573e', 0.85 + rand() * 0.3), 0.78 + rand() * 0.12);
          ctx.fillRect(off + c * w + 3, r * h + 3, w - 6, h - 6);
        }
      }
      grain(ctx, n, rand, 3000, 0.16, p);
    },
  },
  {
    id: 'concrete',
    name: 'Cemento',
    size: 2,
    roughness: 0.8,
    bump: 3,
    draw(ctx, n, p) {
      const rand = rng(67);
      ctx.fillStyle = p('#9a9c9f', 0.55);
      ctx.fillRect(0, 0, n, n);
      for (let i = 0; i < 40; i++) {
        const up = rand() > 0.5;
        ctx.fillStyle = p(up ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', up ? 0.68 : 0.42, 0.12);
        ctx.beginPath();
        ctx.arc(rand() * n, rand() * n, 20 + rand() * 60, 0, Math.PI * 2);
        ctx.fill();
      }
      // pores
      for (let i = 0; i < 220; i++) {
        ctx.fillStyle = p('rgba(40,40,40,0.5)', 0.05, 0.9);
        ctx.beginPath();
        ctx.arc(rand() * n, rand() * n, 0.8 + rand() * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      grain(ctx, n, rand, 7000, 0.14, p);
    },
  },
  {
    id: 'marble',
    name: 'Marmo',
    size: 1.5,
    roughness: 0.14,
    bump: 1,
    draw(ctx, n, p) {
      const rand = rng(79);
      ctx.fillStyle = p('#eceff1', 0.75);
      ctx.fillRect(0, 0, n, n);
      for (let v = 0; v < 7; v++) {
        let x = rand() * n;
        ctx.strokeStyle = p('rgba(90,100,110,0.38)', 0.7, 0.6);
        ctx.lineWidth = 0.6 + rand() * 1.6;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        for (let y = 0; y <= n; y += 16) {
          x += (rand() - 0.5) * 22;
          ctx.lineTo(((x % n) + n) % n, y);
        }
        ctx.stroke();
      }
      grain(ctx, n, rand, 1500, 0.06, p);
    },
  },
  {
    id: 'stone',
    name: 'Pietra',
    size: 1.2,
    roughness: 0.82,
    bump: 5,
    draw(ctx, n, p) {
      const rand = rng(97);
      ctx.fillStyle = p('#5f5a54', 0.1);
      ctx.fillRect(0, 0, n, n);
      const rows = 4;
      const h = n / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rand() * 80;
        while (x < n) {
          const w = 90 + rand() * 90;
          ctx.fillStyle = p(shade('#a79f94', 0.8 + rand() * 0.35), 0.5 + rand() * 0.35);
          ctx.fillRect(x + 4, r * h + 4, w - 8, h - 8);
          x += w;
        }
      }
      grain(ctx, n, rand, 5000, 0.14, p);
    },
  },
];

export const textureById = (id: string | undefined) => TEXTURES.find((t) => t.id === id);

const N = 512;
export interface TextureMaps {
  color: HTMLCanvasElement;
  normal: HTMLCanvasElement;
  ao: HTMLCanvasElement;
  rough: HTMLCanvasElement;
}
const cache = new Map<string, TextureMaps>();
const newCanvas = () => {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  return c;
};

// Separable box blur that wraps at the edges (so the result still tiles).
function blur(src: Float32Array, radius: number): Float32Array {
  const tmp = new Float32Array(N * N);
  const out = new Float32Array(N * N);
  const k = 2 * radius + 1;
  for (let y = 0; y < N; y++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += src[y * N + ((i + N) % N)];
    for (let x = 0; x < N; x++) {
      tmp[y * N + x] = sum / k;
      sum += src[y * N + ((x + radius + 1) % N)] - src[y * N + ((x - radius + N) % N)];
    }
  }
  for (let x = 0; x < N; x++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += tmp[((i + N) % N) * N + x];
    for (let y = 0; y < N; y++) {
      out[y * N + x] = sum / k;
      sum += tmp[((y + radius + 1) % N) * N + x] - tmp[((y - radius + N) % N) * N + x];
    }
  }
  return out;
}

function build(def: TextureDef): TextureMaps {
  const color = newCanvas();
  def.draw(color.getContext('2d')!, N, (c) => c);
  const hc = newCanvas();
  const hctx = hc.getContext('2d')!;
  def.draw(hctx, N, (_c, h) => grey(h));
  const px = hctx.getImageData(0, 0, N, N).data;
  const h = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) h[i] = px[i * 4] / 255;
  const wrap = (v: number) => (v + N) % N;

  const normal = newCanvas();
  const nctx = normal.getContext('2d')!;
  const nimg = nctx.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = h[y * N + wrap(x + 1)] - h[y * N + wrap(x - 1)];
      const dy = h[wrap(y + 1) * N + x] - h[wrap(y - 1) * N + x];
      let nx = -dx * def.bump;
      let ny = dy * def.bump;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const o = (y * N + x) * 4;
      nimg.data[o] = (nx * 0.5 + 0.5) * 255;
      nimg.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      nimg.data[o + 2] = (1 / len * 0.5 + 0.5) * 255;
      nimg.data[o + 3] = 255;
    }
  nctx.putImageData(nimg, 0, 0);

  // Ambient occlusion: darker where the surface is lower than its surroundings (grout lines, joints, pits).
  const soft = blur(h, 7);
  const wide = blur(h, 20);
  const ao = newCanvas();
  const actx = ao.getContext('2d')!;
  const aimg = actx.createImageData(N, N);
  const rough = newCanvas();
  const rctx = rough.getContext('2d')!;
  const rimg = rctx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const cavity = Math.max(0, soft[i] - h[i]) * 2.2 + Math.max(0, wide[i] - h[i]) * 0.9;
    const a = Math.round(255 * Math.max(0.25, 1 - cavity));
    // Rougher in the low parts (grout, pores), the surface's own value elsewhere.
    const r = Math.round(255 * Math.min(1, def.roughness + Math.max(0, 0.55 - h[i]) * 0.5));
    const o = i * 4;
    aimg.data[o] = aimg.data[o + 1] = aimg.data[o + 2] = a;
    aimg.data[o + 3] = 255;
    rimg.data[o] = rimg.data[o + 1] = rimg.data[o + 2] = r;
    rimg.data[o + 3] = 255;
  }
  actx.putImageData(aimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return { color, normal, ao, rough };
}

export function textureMaps(id: string): TextureMaps | null {
  const def = textureById(id);
  if (!def) return null;
  let m = cache.get(id);
  if (!m) cache.set(id, (m = build(def)));
  return m;
}
export const textureCanvas = (id: string) => textureMaps(id)?.color ?? null;

// Average colour of a texture ('#rrggbb'): a swatch for lists.
const averages = new Map<string, string>();
export function textureAverage(id: string): string {
  let a = averages.get(id);
  if (!a) {
    const c = textureCanvas(id);
    if (!c) return '#888888';
    const t = document.createElement('canvas');
    t.width = t.height = 1;
    const ctx = t.getContext('2d')!;
    ctx.drawImage(c, 0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    a = `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    averages.set(id, a);
  }
  return a;
}
