import { PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three';
import type { Backend } from '../cloud/backend';
import { readBoxes, readPlanes } from '../room/capture';
import { Panel } from '../ui3d/panel';
import { handAnchor, pinchPoint } from '../xr/pinch';
import { createAppCore, LAST_PROJECT_KEY, type Capture, type Head } from './core';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Connects the app core to a WebXR session: rays from hands/controllers, plane
// scan, pinch events, the wrist menu button, and the system room-scan request.
const STANDBY_MS = 20000; // hidden for at least this long = the headset was put down

export function createXrApp(renderer: WebGLRenderer, scene: Scene, _camera: PerspectiveCamera, backend: Backend, onResume: () => void) {
  const core = createAppCore({
    scene,
    backend,
    signOut: async () => {
      try {
        localStorage.removeItem(LAST_PROJECT_KEY);
      } catch {
        /* storage can be unavailable */
      }
      await backend.signOut();
      renderer.xr.getSession()?.end();
      location.reload();
    },
  });

  // Small menu button floating above the left wrist / controller.
  const wrist = new Panel(0.07, 0.07, 1000, 'rgba(14,16,22,0.92)');
  wrist.set([{ rect: { x: 4, y: 4, w: 62, h: 62 }, text: '☰', size: 40, onClick: () => core.menu.toggle() }]);
  wrist.mesh.visible = false;
  core.host.root.add(wrist.mesh);
  core.host.add(wrist);

  const ids = new Map<XRInputSource, string>();
  let activeIds = new Set<string>();
  let bound: XRSession | null = null;
  let last = performance.now();
  let leftToggleHeld = false;
  let watched: XRReferenceSpace | null = null;

  const idOf = (src: XRInputSource) => {
    let id = ids.get(src);
    if (!id) {
      id = `${src.handedness}${ids.size}`;
      ids.set(src, id);
    }
    return id;
  };

  function head(): Head {
    const cam = renderer.xr.getCamera();
    return { pos: cam.getWorldPosition(new Vector3()), fwd: cam.getWorldDirection(new Vector3()) };
  }

  let probeAt = 0; // one diagnostic line about the planes, a few seconds after the session starts

  function bind(session: XRSession) {
    bound = session;
    const s = session as any;
    const capture: Capture =
      typeof s.initiateRoomCapture === 'function'
        ? { available: true, start: () => s.initiateRoomCapture() }
        : { available: false, start: async () => undefined };
    core.sessionStarted(capture);
    core.logEvent(`funzioni: ${((s.enabledFeatures ?? []) as string[]).join(' ') || 'n/d'}`);
    probeAt = performance.now() + 4000;

    session.addEventListener('selectstart', (ev) => {
      const e = ev as XRInputSourceEvent;
      const consumed = core.host.press(idOf(e.inputSource));
      const ref = renderer.xr.getReferenceSpace();
      if (!consumed && e.inputSource.handedness === 'left' && ref) {
        const point = pinchPoint(e.frame, e.inputSource, ref);
        if (point) core.moveGazedModel(point, head());
      }
    });
    session.addEventListener('select', (ev) => core.host.release(idOf((ev as XRInputSourceEvent).inputSource)));
    session.addEventListener('selectend', (ev) => core.host.cancel(idOf((ev as XRInputSourceEvent).inputSource)));
    session.addEventListener('squeezestart', () => core.menu.toggle());
    // Standby / resume: the system brings the Guardian back, whatever reference space we ask for.
    // A fresh session does not have it, so restart the session and reopen the project.
    // Only a real standby needs this (the system menu or a room scan also change the visibility,
    // and restarting then would throw the user out of AR): hidden for a while, and not scanning.
    let awaySince = 0;
    session.addEventListener('visibilitychange', () => {
      core.logEvent(`sessione ${session.visibilityState}`);
      const now = performance.now();
      if (session.visibilityState === 'hidden') {
        awaySince ||= now;
      } else if (session.visibilityState === 'visible' && awaySince) {
        const away = now - awaySince;
        awaySince = 0;
        if (away < STANDBY_MS || core.isScanning()) return core.logEvent(`ritorno dopo ${Math.round(away / 1000)} s: sessione mantenuta`);
        core.logEvent('risveglio: riavvio la sessione');
        core.prepareResume();
        onResume();
      }
    });
    session.addEventListener('end', () => {
      bound = null;
      wrist.mesh.visible = false;
    });
  }

  const dir = new Vector3();
  const quat = new Quaternion();

  return {
    core,
    tick(frame?: XRFrame) {
      if (!frame) return;
      if (frame.session !== bound) bind(frame.session);
      const ref = renderer.xr.getReferenceSpace();
      if (!ref) return;
      if (ref !== watched) {
        watched = ref;
        // Fires when the headset moves the origin (e.g. after the boundary is set up again).
        ref.addEventListener('reset', () => core.referenceReset());
      }
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (Math.floor(now / 500) !== Math.floor((now - dt * 1000) / 500)) {
        const planes = readPlanes(frame, ref);
        const boxes = readBoxes(frame, ref);
        core.setLivePlanes(planes, boxes);
        if (probeAt && now > probeAt) {
          probeAt = 0;
          const f = frame as any;
          core.logEvent(`piani ${planes.length}, volumi ${boxes.length}, detectedPlanes ${f.detectedPlanes ? f.detectedPlanes.size : 'assente'}, detectedMeshes ${f.detectedMeshes ? f.detectedMeshes.size : 'assente'}`);
        }
      }

      const seen = new Set<string>();
      let anchor: Vector3 | null = null;
      for (const src of frame.session.inputSources) {
        const id = idOf(src);
        seen.add(id);
        const pose = src.targetRaySpace ? frame.getPose(src.targetRaySpace, ref) : null;
        if (pose) {
          const p = pose.transform.position;
          const q = pose.transform.orientation;
          quat.set(q.x, q.y, q.z, q.w);
          dir.set(0, 0, -1).applyQuaternion(quat);
          core.host.setRay(id, new Vector3(p.x, p.y, p.z), dir);
        } else {
          core.host.setRay(id, null);
        }
        if (src.handedness === 'left') {
          anchor = handAnchor(frame, src, ref);
          // Left controller face buttons (X / Y) also toggle the menu.
          const pressed = !!(src.gamepad?.buttons[4]?.pressed || src.gamepad?.buttons[5]?.pressed);
          if (pressed && !leftToggleHeld) core.menu.toggle();
          leftToggleHeld = pressed;
        }
      }
      for (const id of activeIds) if (!seen.has(id)) core.host.setRay(id, null);
      activeIds = seen;

      const h = head();
      wrist.mesh.visible = !!anchor;
      if (anchor) {
        wrist.mesh.position.copy(anchor).y += 0.08;
        wrist.mesh.lookAt(h.pos);
      }
      core.tick(now, h, dt);
    },
  };
}
