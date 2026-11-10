import { CanvasTexture, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { createStage } from '../scene/stage';
import { cm, findWalls, floorBand, mean, median, std } from './depthMath';
import { createGpuDepthReader, GRID_U, GRID_V, PATCH, rawToMeters } from './depthGpu';
import { planeNormal } from '../room/align';
import { readPlanes } from '../room/capture';
import type { RoomPlane } from '../room/types';

// ?depth: how good is the headset's depth in the browser? Not part of the app: a measuring page, to decide whether Immersa
// can find a room and correct its position by itself, looking at the real walls, without trusting Meta's saved planes.
//
// It shows (1) whether depth / camera access were granted, (2) the distance at the centre of the view as mean and spread
// (compare it with a tape measure; tap = save a reading), (3) the floor and the vertical walls found in the accumulated depth
// points, and how far they lie from the planes Meta reports for the same room.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const CAP = 24000; // points kept per variant (ring buffer)
const MAX_RANGE = 4.5; // m: farther depth is too coarse
const MIN_RANGE = 0.25;
const ANALYSE_MS = 1500;
const PANEL_W = 1024;
const PANEL_H = 700;

// The two things we do not know for sure about the browser's depth image are whether a value is the distance along the
// view's axis or along the ray, and whether v runs from the top or from the bottom. Four variants of the same samples are
// kept, and the one that makes the floor sharpest (all floor points at one height) is the right one.
const VARIANTS = [
  { name: 'z/alto', radial: false, flip: false },
  { name: 'z/basso', radial: false, flip: true },
  { name: 'raggio/alto', radial: true, flip: false },
  { name: 'raggio/basso', radial: true, flip: true },
] as const;

export function runDepthProbe(auto = false) {
  const { renderer, scene, camera } = createStage({ arButton: false });

  // Panel on the camera (head-locked): the DOM is not visible in XR.
  const canvas = document.createElement('canvas');
  canvas.width = PANEL_W;
  canvas.height = PANEL_H;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  const panel = new Mesh(new PlaneGeometry(0.7, (0.7 * PANEL_H) / PANEL_W), new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false }));
  panel.renderOrder = 999;
  panel.position.set(0, -0.12, -0.95);
  camera.add(panel);
  panel.visible = false;

  const paint = (lines: string[]) => {
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, PANEL_W, PANEL_H);
    ctx.fillStyle = '#ffe94d';
    ctx.font = '26px monospace';
    lines.forEach((l, i) => ctx.fillText(l, 14, 34 + i * 31));
    texture.needsUpdate = true;
  };

  // Entry page (outside XR).
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;background:#12151c;color:#e8edf5;font:16px system-ui;text-align:center';
  const hint = document.createElement('div');
  hint.style.cssText = 'max-width:560px;line-height:1.5';
  hint.innerHTML =
    '<b>Prova della profondità</b><br>Entra in AR e guarda un muro a distanza nota (1, 2, 3 m con il metro). Un pinch salva la lettura della distanza al centro. ' +
    'Poi girati intorno alla stanza per qualche secondo: il pannello confronta pareti e pavimento trovati con la profondità con i piani di Meta. Fotografa il pannello.';
  const go = document.createElement('button');
  go.textContent = 'Entra in AR';
  go.style.cssText = 'padding:14px 28px;border-radius:999px;border:0;background:#2dd4bf;color:#04211d;font:700 18px system-ui';
  const note = document.createElement('div');
  box.append(hint, go, note);
  document.body.append(box);

  const readings: string[] = [];
  const recent: number[] = []; // centre distance, last frames
  let message = '';
  let session: XRSession | null = null;
  let lastAnalyse = 0;
  let frameNo = 0;
  let depthFrames = 0;
  let depthFps = 0;
  let fpsAt = performance.now();
  let infoLine = '';
  let validPct = 0;

  const bufs = VARIANTS.map(() => new Float32Array(3 * CAP));
  let filled = 0; // points stored per variant (same for all)
  let wrote = 0;
  let lines: string[] = ['(in attesa dei dati...)'];
  const invP = new Matrix4();
  const viewM = new Matrix4();
  const tmp = new Vector3();
  const dirTop = new Vector3();
  const dirBot = new Vector3();
  const head = new Vector3();

  async function start() {
    note.textContent = '';
    try {
      const init: Any = {
        optionalFeatures: ['local-floor', 'plane-detection', 'mesh-detection', 'depth-sensing', 'camera-access'],
        depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] },
      };
      const s = await navigator.xr!.requestSession('immersive-ar', init);
      renderer.xr.setReferenceSpaceType('local-floor');
      await renderer.xr.setSession(s);
      session = s;
      box.style.display = 'none';
      panel.visible = true;
      s.addEventListener('select', () => {
        if (recent.length < 10) return void (message = 'ancora pochi dati');
        readings.push(`${mean(recent).toFixed(3)}m ±${(std(recent) * 100).toFixed(1)}cm`);
        if (readings.length > 4) readings.shift();
      });
      s.addEventListener('end', () => {
        box.style.display = 'flex';
        panel.visible = false;
        session = null;
      });
    } catch (e) {
      note.textContent = `Non riesco ad avviare l'AR: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  go.onclick = () => void start();
  if (auto) void start(); // started from the installed app: its launch is the gesture

  const gpu = createGpuDepthReader(renderer);

  // One view of the frame: the depth at the centre patch and at a grid of points, in metres (0 = nothing measured), from the
  // CPU depth if the browser gives it, otherwise from the GPU texture.
  function readView(frame: XRFrame, view: XRView, vi: number, wantGrid: boolean) {
    let info: Any = null;
    try {
      info = (frame as Any).getDepthInformation(view);
    } catch {
      info = null;
    }
    if (info && typeof info.getDepthInMeters === 'function') {
      const patch: number[] = [];
      for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) patch.push(info.getDepthInMeters(0.5 + a * 0.008, 0.5 + b * 0.008));
      let grid: Float32Array | null = null;
      if (wantGrid) {
        grid = new Float32Array(GRID_U * GRID_V);
        for (let a = 0; a < GRID_U; a++) for (let b = 0; b < GRID_V; b++) grid[b * GRID_U + a] = info.getDepthInMeters((a + 0.5) / GRID_U, (b + 0.5) / GRID_V);
      }
      return { patch, grid, jitter: [0.5, 0.5] as [number, number], note: `CPU ${info.width}x${info.height}` };
    }
    const g = gpu.read(session!, view, vi);
    if (!g) return null;
    const m = (d: number) => rawToMeters(d, g.near, g.far);
    const patch = Array.from(g.patch, m);
    const raw = g.patch[(PATCH * PATCH) >> 1];
    let grid: Float32Array | null = null;
    if (wantGrid) grid = g.grid.map(m);
    return { patch, grid, jitter: g.jitter, note: `GPU ${g.width}x${g.height} raw ${raw.toFixed(4)} n${g.near.toFixed(2)} f${Number.isFinite(g.far) ? g.far.toFixed(0) : 'inf'}` };
  }

  function sample(frame: XRFrame, ref: XRReferenceSpace) {
    const pose = frame.getViewerPose(ref);
    if (!pose) return;
    head.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
    const sampleGrid = frameNo % 3 === 0;
    let valid = 0;
    let total = 0;
    pose.views.forEach((view, vi) => {
      const r = readView(frame, view, vi, sampleGrid);
      if (!r) return;
      if (vi === 0) {
        depthFrames++;
        infoLine = r.note;
        const vals = r.patch.filter((d) => d > 0.1 && d < 8);
        if (vals.length > 10) {
          recent.push(median(vals));
          if (recent.length > 90) recent.shift();
        }
      }
      if (!r.grid) return;
      invP.fromArray(view.projectionMatrix as unknown as number[]).invert();
      viewM.fromArray(view.transform.matrix as unknown as number[]);
      for (let a = 0; a < GRID_U; a++) {
        for (let b = 0; b < GRID_V; b++) {
          const u = (a + r.jitter[0]) / GRID_U;
          const v = (b + r.jitter[1]) / GRID_V;
          total++;
          const d = r.grid[b * GRID_U + a];
          if (!(d > MIN_RANGE && d < MAX_RANGE)) continue;
          valid++;
          // ndc: u to the right; v either from the top (flip false) or from the bottom
          dirTop.set(2 * u - 1, 1 - 2 * v, -1).applyMatrix4(invP);
          dirBot.set(2 * u - 1, 2 * v - 1, -1).applyMatrix4(invP);
          const slot = wrote % CAP;
          VARIANTS.forEach((variant, k) => {
            const dir = variant.flip ? dirBot : dirTop;
            const scale = variant.radial ? d / dir.length() : d / -dir.z;
            tmp.copy(dir).multiplyScalar(scale).applyMatrix4(viewM);
            bufs[k][3 * slot] = tmp.x;
            bufs[k][3 * slot + 1] = tmp.y;
            bufs[k][3 * slot + 2] = tmp.z;
          });
          wrote++;
          filled = Math.min(CAP, wrote);
        }
      }
    });
    if (total) validPct = Math.round((100 * valid) / total);
  }

  function analyse(metaPlanes: RoomPlane[]) {
    const out: string[] = [];
    out.push(`punti ${filled}  sessione: depth ${(session as Any)?.depthUsage ?? 'NO'} ${(session as Any)?.depthDataFormat ?? ''}`);
    if (filled < 3000) {
      out.push('guardati intorno: servono piu\' punti...');
      return out;
    }
    // which variant makes the floor flattest
    const bands = VARIANTS.map((v, k) => ({ v, k, ...floorBand(bufs[k], filled) }));
    bands.sort((a, b) => b.count - a.count);
    out.push(`variante ${bands[0].v.name}: pavimento ${bands[0].count} pt in 5cm (altre: ${bands.slice(1).map((b) => b.count).join(' / ')})`);
    const best = bands[0];
    const floor = metaPlanes.find((p) => p.label === 'floor');
    out.push(`pav y=${cm(best.y)} sd ${(best.sd * 100).toFixed(1)}cm${floor ? `  Meta ${cm(floor.pos[1])} -> diff ${cm(floor.pos[1] - best.y)}` : '  (Meta: nessun pavimento)'}`);
    const walls = findWalls(bufs[best.k], filled, head);
    if (!walls.length) out.push('nessuna parete trovata (serve vedere un muro intero)');
    walls.forEach((w, i) => {
      let meta = 'Meta: nessun piano parallelo';
      let bestOff: number | null = null;
      let ang = 0;
      for (const p of metaPlanes) {
        if (!p.quat) continue;
        const m = planeNormal(p.quat);
        const mh = Math.hypot(m[0], m[2]);
        if (mh < 0.9) continue; // not a vertical plane
        const dot = (m[0] * w.nx + m[2] * w.nz) / mh;
        if (Math.abs(dot) < 0.97) continue;
        const off = w.nx * p.pos[0] + w.nz * p.pos[2] - w.d; // Meta wall - depth wall, along the normal (positive: Meta more inside the room)
        if (Math.abs(off) < 0.4 && (bestOff === null || Math.abs(off) < Math.abs(bestOff))) {
          bestOff = off;
          ang = (Math.acos(Math.min(1, Math.abs(dot))) * 180) / Math.PI;
        }
      }
      if (bestOff !== null) meta = `Meta ${cm(bestOff)} ${ang.toFixed(1)}gr`;
      out.push(`P${i + 1} ${(w.span).toFixed(1)}m ${w.count}pt sd ${(w.rms * 100).toFixed(1)}cm ${meta}`);
    });
    return out;
  }

  renderer.setAnimationLoop((_t, frame) => {
    renderer.render(scene, camera);
    if (!frame || !session) return;
    const ref = renderer.xr.getReferenceSpace();
    if (!ref) return;
    frameNo++;
    sample(frame, ref);
    const now = performance.now();
    if (now - fpsAt > 1000) {
      depthFps = Math.round((depthFrames * 1000) / (now - fpsAt));
      depthFrames = 0;
      fpsAt = now;
    }
    if (now - lastAnalyse < ANALYSE_MS) return;
    lastAnalyse = now;
    const feats: string[] = (session as Any).enabledFeatures ?? [];
    const meta = readPlanes(frame, ref);
    const centre = recent.length ? `${mean(recent).toFixed(3)} m  ±${(std(recent) * 100).toFixed(1)}cm  (n=${recent.length})` : 'nessun dato';
    lines = [
      'PROVA PROFONDITA',
      `depth: ${feats.includes('depth-sensing') ? 'SI' : 'NO'}  camera: ${feats.includes('camera-access') ? 'SI' : 'NO'}  piani Meta: ${meta.length}`,
      `buffer ${infoLine || '-'}`,
      `${depthFps}/s  validi ${validPct}%${gpu.error ? `  ERR ${gpu.error}` : ''}`,
      `centro: ${centre}`,
      `letture (pinch): ${readings.join(' | ') || 'nessuna'}`,
      ...analyse(meta),
      message,
    ].slice(0, 22);
    paint(lines);
    console.log(`[depth] ${lines.join(' | ')}`);
  });
}
