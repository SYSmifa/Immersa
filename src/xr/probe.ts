import {
  BoxGeometry,
  BufferGeometry,
  Group,
  LineLoop,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { createTextPanel } from '../ui/textPanel';

// Diagnostic for ?probe: does the Quest Space Setup (planes/meshes) and an
// anchor stay put across sessions, standby, reboot, days? Compares what it
// sees now with a stored baseline and the previous session.

type Vec = [number, number, number];
interface PlaneRec { label: string; pos: Vec }
interface Snapshot { t: number; planes: PlaneRec[] }
interface AnchorRec { uuid: string; pos: Vec }

// Persistent-anchor / plane / mesh APIs are newer than @types/webxr.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const KEY_BASE = 'immersa.probe.base';
const KEY_LAST = 'immersa.probe.last';
const KEY_ANCHOR = 'immersa.probe.anchor';

function load<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: probe still runs, just without comparison */
  }
}
const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Each session has its own origin (position + yaw at session start), so raw
// coordinates are not comparable. Find the yaw + translation that best maps the
// previous plane centres onto the current ones (ICP seeded with 24 yaw guesses,
// pairing planes with the same label) and report the residual error.
function compare(prev: Snapshot | null, now: PlaneRec[]) {
  if (!prev || !prev.planes.length || !now.length) return null;
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  let best: { resid: number; yaw: number; dy: number; matched: number } | null = null;

  for (let deg = 0; deg < 360; deg += 15) {
    let th = (deg * Math.PI) / 180;
    const ca: Vec = [mean(prev.planes.map((p) => p.pos[0])), 0, mean(prev.planes.map((p) => p.pos[2]))];
    const cb: Vec = [mean(now.map((p) => p.pos[0])), 0, mean(now.map((p) => p.pos[2]))];
    let tx = 0;
    let tz = 0;
    let dy = 0;
    const apply = (p: Vec): Vec => {
      const c = Math.cos(th);
      const s = Math.sin(th);
      return [c * p[0] - s * p[2] + tx, p[1] + dy, s * p[0] + c * p[2] + tz];
    };
    tx = cb[0] - (Math.cos(th) * ca[0] - Math.sin(th) * ca[2]);
    tz = cb[2] - (Math.sin(th) * ca[0] + Math.cos(th) * ca[2]);

    let pairs: [Vec, Vec][] = [];
    for (let it = 0; it < 12; it++) {
      pairs = [];
      for (const p of prev.planes) {
        const t = apply(p.pos);
        let bestC: PlaneRec | null = null;
        let bestD = Infinity;
        for (const c of now) {
          const d = c.label === p.label ? dist(t, c.pos) : Infinity;
          if (d < bestD) {
            bestD = d;
            bestC = c;
          }
        }
        if (bestC) pairs.push([p.pos, bestC.pos]);
      }
      if (pairs.length < 2) break;
      const ma = [mean(pairs.map((q) => q[0][0])), mean(pairs.map((q) => q[0][2]))];
      const mb = [mean(pairs.map((q) => q[1][0])), mean(pairs.map((q) => q[1][2]))];
      let cross = 0;
      let dot = 0;
      for (const [a, b] of pairs) {
        const ax = a[0] - ma[0];
        const az = a[2] - ma[1];
        const bx = b[0] - mb[0];
        const bz = b[2] - mb[1];
        cross += ax * bz - az * bx;
        dot += ax * bx + az * bz;
      }
      th = Math.atan2(cross, dot);
      tx = mb[0] - (Math.cos(th) * ma[0] - Math.sin(th) * ma[1]);
      tz = mb[1] - (Math.sin(th) * ma[0] + Math.cos(th) * ma[1]);
      dy = mean(pairs.map(([a, b]) => b[1] - a[1]));
    }
    if (!pairs.length) continue;
    const resid = mean(pairs.map(([a, b]) => dist(apply(a), b)));
    if (!best || resid < best.resid) {
      best = { resid, yaw: (th * 180) / Math.PI, dy, matched: pairs.length };
    }
  }
  return best && { ...best, total: prev.planes.length };
}

const fmt = (c: ReturnType<typeof compare>) =>
  c
    ? `${(c.resid * 100).toFixed(1)}cm yaw ${c.yaw.toFixed(0)} dy ${(c.dy * 100).toFixed(0)}cm`
    : 'n/a';
const ago = (s: Snapshot | null) =>
  s ? `${((Date.now() - s.t) / 60000).toFixed(0)}m` : 'none';

export function createProbe(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
  const panel = createTextPanel(camera, 0.3, -0.1, -0.9);
  const overlay = new Group();
  scene.add(overlay);

  const planeLines = new Map<Any, LineLoop>();
  const lineMat = new LineBasicMaterial({ color: 0x00ffff });
  const marker = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshBasicMaterial({ color: 0xff00ff }));
  marker.visible = false;
  marker.matrixAutoUpdate = false;
  scene.add(marker);

  let base = load<Snapshot>(KEY_BASE);
  const prev = load<Snapshot>(KEY_LAST);
  let storedAnchor = load<AnchorRec>(KEY_ANCHOR);
  const status: string[] = [];
  let features = '';
  let anchor: Any = null;
  let anchorMsg = storedAnchor ? 'restoring...' : 'none (trigger/pinch = place)';
  let placing = false;
  let started = 0;
  let saved = false;
  let lastDraw = 0;
  let sessionBound: XRSession | null = null;

  function bind(session: XRSession) {
    sessionBound = session;
    started = performance.now();
    saved = false;
    features = ((session as Any).enabledFeatures ?? []).join(',') || '(enabledFeatures n/a)';
    if (storedAnchor && (session as Any).restorePersistentAnchor) {
      (session as Any)
        .restorePersistentAnchor(storedAnchor.uuid)
        .then((a: Any) => {
          anchor = a;
          anchorMsg = 'restored, checking pose...';
        })
        .catch((e: Error) => {
          anchorMsg = `restore FAILED: ${e.message}`;
        });
    } else if (storedAnchor) {
      anchorMsg = 'restorePersistentAnchor unsupported';
    }
    session.addEventListener('select', (ev: Any) => placeAnchor(ev));
  }

  function placeAnchor(ev: Any) {
    const ref = renderer.xr.getReferenceSpace();
    if (!ref || placing || !ev.frame.createAnchor) return;
    const pose = ev.frame.getPose(ev.inputSource.targetRaySpace, ref);
    if (!pose) return;
    placing = true;
    const p = pose.transform.position;
    // Anchor 1 m in front of the pointing ray origin along the ray.
    const q = pose.transform.orientation;
    const dir = new Vector3(0, 0, -1).applyQuaternion({ x: q.x, y: q.y, z: q.z, w: q.w } as Any);
    const pos: Vec = [p.x + dir.x, p.y + dir.y, p.z + dir.z];
    ev.frame
      .createAnchor(new XRRigidTransform({ x: pos[0], y: pos[1], z: pos[2] }), ref)
      .then(async (a: Any) => {
        anchor = a;
        if (!a.requestPersistentAnchor) {
          anchorMsg = 'placed (persistence unsupported)';
          return;
        }
        const uuid = await a.requestPersistentAnchor();
        storedAnchor = { uuid, pos };
        save(KEY_ANCHOR, storedAnchor);
        anchorMsg = `placed+saved ${uuid.slice(0, 8)}`;
      })
      .catch((e: Error) => {
        anchorMsg = `place FAILED: ${e.message}`;
      })
      .finally(() => {
        placing = false;
      });
  }

  function planeLine(plane: Any) {
    let line = planeLines.get(plane);
    const pts = (plane.polygon as DOMPointReadOnly[]).map((p) => new Vector3(p.x, p.y, p.z));
    if (!line) {
      line = new LineLoop(new BufferGeometry(), lineMat);
      line.matrixAutoUpdate = false;
      overlay.add(line);
      planeLines.set(plane, line);
    }
    line.geometry.setFromPoints(pts);
    return line;
  }

  return {
    tick(frame?: XRFrame) {
      if (!frame) return;
      const session = frame.session;
      if (session !== sessionBound) bind(session);
      const ref = renderer.xr.getReferenceSpace();
      if (!ref) return;
      const f = frame as Any;

      // Planes
      const planes: PlaneRec[] = [];
      const seen = new Set<Any>();
      for (const plane of (f.detectedPlanes ?? []) as Set<Any>) {
        const pose = frame.getPose(plane.planeSpace, ref);
        if (!pose) continue;
        seen.add(plane);
        const line = planeLines.get(plane) ?? planeLine(plane);
        if (plane.lastChangedTime !== (line.userData.changed ?? -1)) {
          planeLine(plane);
          line.userData.changed = plane.lastChangedTime;
        }
        line.matrix.fromArray(pose.transform.matrix as unknown as number[]);
        const p = pose.transform.position;
        planes.push({ label: plane.semanticLabel || plane.orientation || '?', pos: [p.x, p.y, p.z] });
      }
      for (const [plane, line] of planeLines) {
        if (!seen.has(plane)) {
          overlay.remove(line);
          line.geometry.dispose();
          planeLines.delete(plane);
        }
      }

      // Meshes (counted only: the global mesh can be large)
      let meshes = 0;
      let tris = 0;
      for (const m of (f.detectedMeshes ?? []) as Set<Any>) {
        meshes++;
        tris += (m.indices?.length ?? 0) / 3;
      }

      // Save snapshot once planes have had time to arrive
      if (!saved && planes.length && performance.now() - started > 4000) {
        const snap: Snapshot = { t: Date.now(), planes };
        if (!base) {
          base = snap;
          save(KEY_BASE, base);
        }
        save(KEY_LAST, snap);
        saved = true;
      }

      // Anchor pose vs stored
      let anchorDelta = '';
      if (anchor) {
        const pose = frame.getPose(anchor.anchorSpace, ref);
        marker.visible = !!pose;
        if (pose) {
          const p = pose.transform.position;
          marker.matrix.fromArray(pose.transform.matrix as unknown as number[]);
          if (storedAnchor && anchorMsg.startsWith('restored')) {
            anchorDelta = ` d=${(dist([p.x, p.y, p.z], storedAnchor.pos) * 100).toFixed(1)}cm`;
          }
        }
      }

      const now = performance.now();
      if (now - lastDraw < 500) return;
      lastDraw = now;
      const labels = new Map<string, number>();
      planes.forEach((p) => labels.set(p.label, (labels.get(p.label) ?? 0) + 1));
      const lines = [
        'PROBE',
        `feat: ${features}`.slice(0, 44),
        `planes ${planes.length}  meshes ${meshes} (${(tris / 1000).toFixed(0)}k tris)`,
        [...labels].map(([k, v]) => `${k}:${v}`).join(' ').slice(0, 44),
        `vs base ${ago(base)}: ${fmt(compare(base, planes))}`,
        `vs last ${ago(prev)}: ${fmt(compare(prev, planes))}`,
        `anchor: ${anchorMsg}${anchorDelta}`,
        ...status,
      ];
      panel.setText(lines.join('\n'));
      console.log(lines.join(' | '));
    },
  };
}

