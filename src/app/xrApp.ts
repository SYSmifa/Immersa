import { PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three';
import type { Backend } from '../cloud/backend';
import { readBoxes, readPlanes } from '../room/capture';
import { createLaser } from '../ui3d/laser';
import { Panel } from '../ui3d/panel';
import { handAnchor, pinchPoint } from '../xr/pinch';
import { createAppCore, LAST_PROJECT_KEY, type Capture, type Head } from './core';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Connects the app core to a WebXR session: rays from hands/controllers, plane
// scan, pinch events, the wrist menu button, and the system room-scan request.
// The session had planes and now reports none (the headset lost its scene data, e.g. after a standby, whatever its
// length): after this long without any the app restarts. The headset reports the planes of every stored room, so
// "none at all" is never normal.
const NO_PLANES_MS = 1500;
const AWAY_LOG_MS = 2000; // diagnostics: a return after at least this long is logged with the plane count

// How many planes the session reports, and for how many of them a pose is available in `ref` (diagnostics).
function planeFeed(frame: XRFrame, ref: XRReferenceSpace): string {
  const set = (frame as any).detectedPlanes as Set<any> | undefined;
  if (!set) return 'detectedPlanes assente';
  let posed = 0;
  for (const plane of set) if (frame.getPose(plane.planeSpace, ref)) posed++;
  return `detectedPlanes ${set.size} (con posa ${posed})`;
}

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

  // Laser from the right hand (hand tracking or controller).
  const laser = createLaser();
  core.host.root.add(laser.mesh);
  let rightPinching = false;

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

  let wakeStart = 0; // diagnostics: plane count at a few moments after a wake from standby
  const wakeChecks: number[] = [];
  let zeroSince = 0; // when the planes disappeared (0: they are there)
  let planesHidden = false; // rooms and models are hidden while the planes are gone
  let restarting = false;
  let seenPlanes = false; // the session has reported planes at least once
  let probeAt = 0; // one diagnostic line about the planes, a few seconds after the session starts

  function bind(session: XRSession) {
    bound = session;
    zeroSince = 0;
    planesHidden = false;
    restarting = false;
    wakeStart = 0;
    seenPlanes = false;
    const s = session as any;
    const capture: Capture =
      typeof s.initiateRoomCapture === 'function'
        ? { available: true, start: () => s.initiateRoomCapture() }
        : { available: false, start: async () => undefined };
    core.sessionStarted(capture);
    core.logEvent(`app: ${['standalone', 'fullscreen', 'browser'].find((m) => matchMedia(`(display-mode: ${m})`).matches)} ${document.referrer.slice(0, 40)}`);
    core.logEvent(`funzioni: ${((s.enabledFeatures ?? []) as string[]).join(' ') || 'n/d'}`);
    probeAt = performance.now() + 4000;

    session.addEventListener('selectstart', (ev) => {
      const e = ev as XRInputSourceEvent;
      const id = idOf(e.inputSource);
      const consumed = core.host.press(id);
      const hand = e.inputSource.handedness;
      if (hand === 'right') rightPinching = true;
      if (hand === 'left' || hand === 'right') core.pinchDown(hand, id, consumed);
    });
    session.addEventListener('select', (ev) => core.host.release(idOf((ev as XRInputSourceEvent).inputSource)));
    session.addEventListener('selectend', (ev) => {
      const src = (ev as XRInputSourceEvent).inputSource;
      core.host.cancel(idOf(src));
      if (src.handedness === 'right') rightPinching = false;
      if (src.handedness === 'left' || src.handedness === 'right') core.pinchUp(src.handedness, idOf(src));
    });
    session.addEventListener('squeezestart', () => core.menu.toggle());
    // Standby / resume: only logged here (the plane check in tick() decides about the restart).
    let awaySince = 0;
    session.addEventListener('visibilitychange', () => {
      core.logEvent(`sessione ${session.visibilityState}`);
      const now = performance.now();
      if (session.visibilityState === 'hidden') {
        awaySince ||= now;
      } else if (session.visibilityState === 'visible' && awaySince) {
        const away = now - awaySince;
        awaySince = 0;
        probeAt = now + 3000;
        if (away >= AWAY_LOG_MS) {
          wakeStart = now;
          wakeChecks.splice(0, wakeChecks.length, 5, 15, 30, 60, 120);
          core.logEvent(`ritorno dopo ${Math.round(away / 1000)} s`);
        }
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
        ref.addEventListener('reset', (ev) => core.referenceReset((ev as XRReferenceSpaceEvent).transform?.matrix));
      }
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (Math.floor(now / 500) !== Math.floor((now - dt * 1000) / 500)) {
        const planes = readPlanes(frame, ref);
        const boxes = readBoxes(frame, ref);
        core.setLivePlanes(planes, boxes);
        if (wakeStart && wakeChecks.length && now - wakeStart > wakeChecks[0] * 1000) {
          core.logEvent(`${wakeChecks.shift()} s dopo il risveglio: piani ${planes.length}, ${planeFeed(frame, ref)}`);
          if (!wakeChecks.length) wakeStart = 0;
        }
        if (planes.length) {
          seenPlanes = true;
          zeroSince = 0;
          planesHidden = false; // the core shows the rooms again once it has found them
        } else if (seenPlanes && !restarting && frame.session.visibilityState === 'visible' && !core.isScanning()) {
          zeroSince ||= now;
          if (!planesHidden && now - zeroSince > 500) {
            planesHidden = true;
            core.planesGap(true); // a wireframe in the wrong place is worse than none
          }
          if (now - zeroSince > NO_PLANES_MS) {
            // The session stays open but is blind (ending it closes the installed app): start over.
            restarting = true;
            core.logEvent('nessun piano: riapro l\'app');
            core.prepareResume();
            core.showRestarting();
            setTimeout(onResume, 600); // long enough to read the message
          }
        } else if (!planes.length) {
          zeroSince = 0; // hidden or scanning: do not count this time
        }
        if (probeAt && now > probeAt) {
          probeAt = 0;
          const f = frame as any;
          core.logEvent(`piani ${planes.length}, volumi ${boxes.length}, ${planeFeed(frame, ref)}, detectedMeshes ${f.detectedMeshes ? f.detectedMeshes.size : 'assente'}`);
        }
      }

      let pl: Vector3 | null = null;
      let pr: Vector3 | null = null;
      for (const src of frame.session.inputSources) {
        if (src.handedness === 'left') pl = pinchPoint(frame, src, ref);
        else if (src.handedness === 'right') pr = pinchPoint(frame, src, ref);
      }
      core.setPinchPoints(pl, pr); // for the two-hand turn / scale
      const seen = new Set<string>();
      let laserOn = false;
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
          const origin = new Vector3(p.x, p.y, p.z);
          if (src.handedness === 'right') {
            core.host.noCursor.add(id);
            const hit = core.aim(id, origin, dir);
            laser.show(origin, dir, hit.length, hit.target !== 'none', rightPinching, head().pos);
            laserOn = true;
          } else {
            core.host.setRay(id, origin, dir);
          }
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
      if (!laserOn) {
        laser.hide();
        rightPinching = false;
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
