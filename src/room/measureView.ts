import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { Measure } from './measure';

// Draws measures (see measure.ts) in the headset: thin lines a few millimetres wide and labels that always face you, with the
// same apparent size at any distance. Measures come in world coordinates. Drawn over everything (no depth test), so a line
// behind an object is still seen.
const MAX_LABELS = 28;
const LINE_DIM = 0.004; // m
const LINE_GAP = 0.005;
const ASPECT = 6; // label width / height
const PX_H = 64;

interface Label {
  mesh: Mesh;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  key: string;
}

export function createMeasureView() {
  const root = new Group();
  root.visible = false;
  const mat = (color: number, width: number) => new LineMaterial({ color, linewidth: width, worldUnits: true, depthTest: false, transparent: true });
  const dimMat = mat(0xffffff, LINE_DIM);
  const gapMat = mat(0x2dd4bf, LINE_GAP);
  gapMat.depthTest = true; // a distance on the floor goes behind what is in front of it
  let dimLines: LineSegments2 | null = null;
  let gapLines: LineSegments2 | null = null;
  let sig = '';
  const labels: Label[] = [];
  const mid = new Vector3();

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
    return { mesh, canvas, texture, key: '' };
  }

  function paint(l: Label, text: string, kind: Measure['kind']) {
    const key = `${kind}|${text}`;
    if (l.key === key) return;
    l.key = key;
    const c = l.canvas.getContext('2d')!;
    const w = l.canvas.width;
    const h = l.canvas.height;
    c.clearRect(0, 0, w, h);
    let size = 38;
    c.font = `700 ${size}px Sen, system-ui, sans-serif`;
    while (c.measureText(text).width > w - 36 && size > 16) c.font = `700 ${--size}px Sen, system-ui, sans-serif`;
    const tw = Math.min(w - 4, c.measureText(text).width + 32);
    c.fillStyle = kind === 'gap' ? '#14b8a6' : 'rgba(16,19,26,0.88)';
    c.beginPath();
    c.roundRect((w - tw) / 2, 6, tw, h - 12, (h - 12) / 2);
    c.fill();
    c.fillStyle = kind === 'gap' ? '#04211d' : '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 2);
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
      const s = list.map((m) => `${m.kind}${m.a.map((n) => n.toFixed(3))}${m.b.map((n) => n.toFixed(3))}`).join('|');
      if (s !== sig) {
        sig = s;
        for (const l of [dimLines, gapLines]) if (l) (root.remove(l), l.geometry.dispose());
        const flat = (kinds: Measure['kind'][]) => list.filter((m) => kinds.includes(m.kind)).flatMap((m) => [...m.a, ...m.b]);
        const make = (pos: number[], m: LineMaterial) => {
          if (!pos.length) return null;
          const l = new LineSegments2(new LineSegmentsGeometry().setPositions(pos), m);
          l.renderOrder = 1100;
          l.frustumCulled = false;
          root.add(l);
          return l;
        };
        dimLines = make(flat(['dim']), dimMat);
        gapLines = make(flat(['gap', 'tick']), gapMat);
      }
      // the nearest labels, if there are more than the pool
      const sorted = list
        .filter((m) => m.kind !== 'tick')
        .map((m) => ({ m, d: mid.set((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2).distanceTo(head) }))
        .sort((p, q) => p.d - q.d)
        .slice(0, MAX_LABELS);
      while (labels.length < sorted.length) labels.push(makeLabel());
      labels.forEach((l, i) => {
        const it = sorted[i];
        l.mesh.visible = !!it;
        if (!it) return;
        paint(l, it.m.text, it.m.kind);
        l.mesh.position.set((it.m.a[0] + it.m.b[0]) / 2, (it.m.a[1] + it.m.b[1]) / 2 + 0.03, (it.m.a[2] + it.m.b[2]) / 2);
        const h = Math.min(0.22, Math.max(0.05, it.d * 0.045)); // about the same size on the eye at any distance
        l.mesh.scale.set(h * ASPECT, h, 1);
        l.mesh.lookAt(head);
      });
    },
    hide() {
      root.visible = false;
    },
  };
}
