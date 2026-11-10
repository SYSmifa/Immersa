import { CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { Measure } from './measure';
import { SELECT_COLOR } from './selection';

// Draws measures (see measure.ts) in the headset: thin lines a few millimetres wide and labels that always face you, with the
// same apparent size at any distance. Measures come in world coordinates. Drawn over everything (no depth test), so a line
// behind an object is still seen.
const MAX_LABELS = 28;
const LINE_DIM = 0.004; // m
const LINE_GAP = 0.005;
const ASPECT = 4; // label width / height
const LINE_H = 50; // px of one line in a note with several lines
const LINE_PX = 34; // its font size
const MAX_LINES = 8;
const PX_H = 96; // sharp enough for a quad layer, which the compositor samples straight to the display

interface Label {
  mesh: Mesh;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  key: string;
  stamp: number; // grows with every repaint (layers redraw their image when it changes)
  d: number; // distance from the head, set on every update
  rows: number; // image height in single-line heights (a note with several lines is taller)
}

/** A label that can be drawn as a WebXR quad layer (see ui3d/layers.ts); the mesh is only the placement and the fallback. */
export interface LabelLayer {
  canvas: HTMLCanvasElement;
  mesh: Mesh;
  stamp: number;
}

// Breaks a label into lines: where the text has a newline, and between words (or inside a very long one) when a line
// would be wider than `maxW`. `width(text, fontPx)` measures. A single short line comes back as it is.
export function wrapLines(text: string, width: (t: string, px: number) => number, maxW: number): string[] {
  const one = text.split('\n').map((t) => t.trim());
  if (one.length === 1 && width(one[0], 38) <= maxW) return one; // fits at the normal size
  const out: string[] = [];
  for (const para of one) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (width(w, LINE_PX) > maxW && w.length > 1) {
        // a word longer than a line: cut it where it still fits
        let n = w.length - 1;
        while (n > 1 && width(w.slice(0, n), LINE_PX) > maxW) n--;
        if (line) out.push(line);
        out.push(w.slice(0, n));
        line = '';
        w = w.slice(n);
      }
      const next = line ? `${line} ${w}` : w;
      if (line && width(next, LINE_PX) > maxW) {
        out.push(line);
        line = w;
      } else line = next;
    }
    out.push(line);
  }
  if (out.length > MAX_LINES) {
    out.length = MAX_LINES;
    out[MAX_LINES - 1] = `${out[MAX_LINES - 1].replace(/.{1}$/, '')}…`;
  }
  return out;
}

export function createMeasureView() {
  const root = new Group();
  root.visible = false;
  const mat = (color: number, width: number) => new LineMaterial({ color, linewidth: width, worldUnits: true, depthTest: false, transparent: true });
  const dimMat = mat(0xffffff, LINE_DIM);
  const gapMat = mat(0x2dd4bf, LINE_GAP);
  const annotMats = new Map<string, LineMaterial>(); // annotations: a line material per colour
  const haloMat = mat(SELECT_COLOR, LINE_GAP * 3.2);
  haloMat.depthTest = false;
  let haloLines: LineSegments2 | null = null;
  let annotLines: LineSegments2[] = [];
  let dimLines: LineSegments2 | null = null;
  let gapLines: LineSegments2 | null = null;
  let sig = '';
  let sigList: Measure[] | null = null;
  const labels: Label[] = [];
  const mid = new Vector3();
  let chosen: Measure[] | null = null;
  const chosenAt = new Vector3(Infinity, Infinity, Infinity);

  function makeLabel(): Label {
    const canvas = document.createElement('canvas');
    canvas.width = PX_H * ASPECT;
    canvas.height = PX_H;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
    mesh.renderOrder = 1200;
    mesh.frustumCulled = false;
    root.add(mesh);
    return { mesh, canvas, texture, key: '', stamp: 0, d: 0, rows: 1 };
  }

  function paint(l: Label, text: string, kind: Measure['kind'], color?: string, selected?: boolean, scale = 1) {
    // A bigger label gets a bigger image (1, 2, 3 or 4 times the pixels), so that it stays sharp when it is enlarged.
    const q = scale <= 1 ? 1 : Math.min(4, Math.ceil(scale));
    const key = `${kind}|${text}|${color ?? ''}|${selected ? 's' : ''}|${q}`;
    if (l.key === key) return;
    l.key = key;
    l.stamp++;
    const c = l.canvas.getContext('2d')!;
    const w = PX_H * ASPECT;
    const lines = wrapLines(text, (t, px) => {
      c.font = `700 ${px}px Sen, system-ui, sans-serif`;
      return c.measureText(t).width;
    }, w - 36);
    const multi = lines.length > 1;
    const h = multi ? lines.length * LINE_H + 28 : PX_H; // logical height: a single line keeps the old size
    l.rows = h / PX_H;
    if (l.canvas.height !== Math.round(h * q) || l.canvas.width !== w * q) {
      l.canvas.width = w * q;
      l.canvas.height = Math.round(h * q);
      l.texture.dispose(); // the image changed size: a new texture on the GPU
    }
    c.setTransform(q, 0, 0, q, 0, 0); // drawn in the 1x coordinates below
    c.clearRect(0, 0, w, h);
    let size = multi ? LINE_PX : 38;
    c.font = `700 ${size}px Sen, system-ui, sans-serif`;
    if (!multi) while (c.measureText(text).width > w - 36 && size > 16) c.font = `700 ${--size}px Sen, system-ui, sans-serif`;
    const widest = Math.max(...lines.map((t) => c.measureText(t).width));
    const tw = Math.min(w - 4, widest + 32);
    c.fillStyle = color ?? (kind === 'gap' ? '#14b8a6' : 'rgba(16,19,26,0.88)');
    c.beginPath();
    c.roundRect((w - tw) / 2, 6, tw, h - 12, multi ? 30 : (h - 12) / 2);
    c.fill();
    if (selected) {
      c.lineWidth = 6;
      c.strokeStyle = '#35b8ff';
      c.stroke();
    }
    c.fillStyle = color ? '#1a1205' : kind === 'gap' ? '#04211d' : '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    lines.forEach((t, i) => c.fillText(t, w / 2, multi ? 14 + LINE_H * (i + 0.5) + 2 : h / 2 + 2));
    l.texture.needsUpdate = true;
  }

  return {
    root,
    // `list` in world coordinates; `head` where the user's eyes are.
    update(list: Measure[], head: Vector3) {
      if (!list.length) {
        root.visible = false;
        return;
      }
      root.visible = true;
      // The list is made again every so often: only when what it says has changed are the lines and the labels redone.
      const s = list === sigList ? sig : list.map((m) => `${m.kind}${m.a.map((n) => n.toFixed(3))}${m.b.map((n) => n.toFixed(3))}${m.text}${m.color ?? ''}${m.selected ? 's' : ''}${m.scale ?? ''}`).join('|');
      sigList = list;
      if (s !== sig) {
        sig = s;
        chosen = null;
        for (const l of [dimLines, gapLines, haloLines, ...annotLines]) if (l) (root.remove(l), l.geometry.dispose());
        const flat = (match: (m: Measure) => boolean) => list.filter(match).flatMap((m) => [...m.a, ...m.b]);
        const make = (pos: number[], m: LineMaterial) => {
          if (!pos.length) return null;
          const l = new LineSegments2(new LineSegmentsGeometry().setPositions(pos), m);
          l.renderOrder = 1100;
          l.frustumCulled = false;
          root.add(l);
          return l;
        };
        dimLines = make(flat((m) => m.kind === 'dim'), dimMat);
        gapLines = make(flat((m) => m.kind === 'gap'), gapMat);
        haloLines = make(flat((m) => !!m.selected && (m.kind === 'pin' || m.kind === 'ruler')), haloMat);
        if (haloLines) haloLines.renderOrder = 1090; // under the coloured line: it shows as an outline
        annotLines = [];
        for (const color of new Set(list.filter((m) => m.color).map((m) => m.color!))) {
          let am = annotMats.get(color);
          if (!am) annotMats.set(color, (am = mat(new Color(color).getHex(), LINE_GAP)));
          const l = make(flat((m) => m.color === color && (m.kind === 'pin' || m.kind === 'ruler')), am);
          if (l) annotLines.push(l);
        }
      }
      // Which measures get a label: all of them when they fit the pool, else the nearest. Decided when the list changes or when the
      // head has moved well away, NOT every frame: sorting by distance each frame swapped labels between slots as the eyes moved a
      // little (turning the head does that), and every swap repainted a label.
      if (!chosen || head.distanceTo(chosenAt) > 0.7) {
        const labelled = list.filter((m) => m.kind !== 'pin' && m.text); // crosses have no text
        chosen =
          labelled.length <= MAX_LABELS
            ? labelled
            : labelled
                .map((m) => ({ m, d: mid.set((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2).distanceTo(head) }))
                .sort((p, q) => p.d - q.d)
                .slice(0, MAX_LABELS)
                .map((x) => x.m);
        chosenAt.copy(head);
      }
      const sorted = chosen.map((m) => ({ m, d: mid.set((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2).distanceTo(head) }));
      while (labels.length < sorted.length) labels.push(makeLabel());
      labels.forEach((l, i) => {
        const it = sorted[i];
        l.mesh.visible = !!it;
        if (!it) return;
        l.d = it.d;
        paint(l, it.m.text, it.m.kind, it.m.color, it.m.selected, it.m.scale);
        const h = Math.min(0.22, Math.max(0.05, it.d * 0.045)); // about the same size on the eye at any distance
        const sc = it.m.scale ?? 1;
        // a label with several lines is taller: it grows upward from the same base
        l.mesh.position.set((it.m.a[0] + it.m.b[0]) / 2, (it.m.a[1] + it.m.b[1]) / 2 + 0.03 + ((l.rows - 1) * h * sc) / 2, (it.m.a[2] + it.m.b[2]) / 2);
        l.mesh.scale.set(h * sc * ASPECT, h * sc * l.rows, 1);
        l.mesh.lookAt(head);
      });
    },
    // The nearest `max` visible labels, for the layers (the others stay in the scene).
    layerLabels(max: number): LabelLayer[] {
      if (!root.visible) return [];
      return labels
        .filter((l) => l.mesh.visible)
        .sort((p, q) => p.d - q.d)
        .slice(0, max)
        .map((l) => ({ canvas: l.canvas, mesh: l.mesh, stamp: l.stamp }));
    },
    hide() {
      root.visible = false;
    },
  };
}
