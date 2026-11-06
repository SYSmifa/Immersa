import { PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three';
import type { Backend } from '../cloud/backend';
import { readBoxes, readPlanes } from '../room/capture';
import { createLaser } from '../ui3d/laser';
import { createPanelLayers } from '../ui3d/layers';
import { createHands } from '../xr/hands';
import { palmNormal, pinchPoint } from '../xr/pinch';
import { createAppCore, handPreferred, LAST_PROJECT_KEY, type Capture, type Head } from './core';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Connects the app core to a WebXR session: rays from hands/controllers, plane
// scan, pinch events and the system room-scan request.
// The session had planes and now reports none (the headset lost its scene data, e.g. after a standby, whatever its
// length): after this long without any the app restarts. The headset reports the planes of every stored room, so
// "none at all" is never normal.
const NO_PLANES_MS = 1500;
// Still no planes after this long: the card says what to do (the app does NOT restart itself: a relaunch from inside the app is
// not treated like one from the Library and the headset then shows its own boundary again).
const LOST_ROOM_MS = 25000;
const AWAY_LOG_MS = 2000; // diagnostics: a return after at least this long is logged with the plane count

// How many planes the session reports, and for how many of them a pose is available in `ref` (diagnostics).
function planeFeed(frame: XRFrame, ref: XRReferenceSpace): string {
  const set = (frame as any).detectedPlanes as Set<any> | undefined;
  if (!set) return 'detectedPlanes assente';
  let posed = 0;
  for (const plane of set) if (frame.getPose(plane.planeSpace, ref)) posed++;
  return `detectedPlanes ${set.size} (con posa ${posed})`;
}

export function createXrApp(renderer: WebGLRenderer, scene: Scene, _camera: PerspectiveCamera, backend: Backend, onFps: (on: boolean) => void) {
  let dominant: 'left' | 'right' = handPreferred(); // the hand that points with the laser; the other one is the "off hand"
  let rightPinching = false; // the dominant hand is pinching
  // Laser smoothing (exponential, time based): light while pointing, heavier while pinching (grabs) for precision.
  createHands(renderer, scene);
  let smoothO: Vector3 | null = null;
  let smoothD: Vector3 | null = null;
  const TAU_POINT = 0.03;
  const TAU_PINCH = 0.1;
  let laserHidden = false; // the dominant hand is turned palm up / towards the face (the system's own gesture): no laser
  const layers: ReturnType<typeof createPanelLayers> = createPanelLayers(renderer, (text) => core.logEvent(text));
  const core = createAppCore({
    onLayers: (on) => layers.setEnabled(on),
    onFps,
    onHand: (h) => {
      dominant = h; // the laser, the selection and the two-hand gesture swap hands
      core.host.noCursor.clear();
      rightPinching = false;
    },
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

  for (const p of core.layerPanels()) layers.register(p);

  // Laser from the right hand (hand tracking or controller).
  const laser = createLaser();
  core.host.root.add(laser.mesh);
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
  let waiting: number | null = null; // since when the planes are gone and the app is waiting for them
  let hinted = false;
  let seenPlanes = false; // the session has reported planes at least once
  let probeAt = 0; // one diagnostic line about the planes, a few seconds after the session starts

  function bind(session: XRSession) {
    bound = session;
    zeroSince = 0;
    planesHidden = false;
    waiting = null;
    hinted = false;
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
      const hand = e.inputSource.handedness;
      if (hand === 'left' || hand === 'right') {
        const role = hand === dominant ? 'right' : 'left'; // core: 'right' = main hand, 'left' = the other
        // Only the main hand presses on panels; the other one never clicks (its pinch opens / closes the menu).
        if (role === 'right' && laserHidden) return; // a pinch of the system gesture, not a click
        const consumed = role === 'right' ? core.host.press(id) : false;
        if (role === 'right') rightPinching = true;
        core.pinchDown(role, id, consumed);
      }
    });
    session.addEventListener('select', (ev) => core.host.release(idOf((ev as XRInputSourceEvent).inputSource)));
    session.addEventListener('selectend', (ev) => {
      const src = (ev as XRInputSourceEvent).inputSource;
      core.host.cancel(idOf(src));
      if (src.handedness === 'left' || src.handedness === 'right') {
        const role = src.handedness === dominant ? 'right' : 'left';
        if (role === 'right') rightPinching = false;
        core.pinchUp(role, idOf(src));
      }
    });
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
          if (waiting !== null) {
            core.logEvent(`piani tornati dopo ${Math.round((now - waiting) / 1000)} s`);
            waiting = null;
            hinted = false;
            core.hideSearching();
          }
        } else if (seenPlanes && frame.session.visibilityState === 'visible' && !core.isScanning()) {
          zeroSince ||= now;
          if (!planesHidden && now - zeroSince > 500) {
            planesHidden = true;
            core.planesGap(true); // a wireframe in the wrong place is worse than none
          }
          if (waiting === null && now - zeroSince > NO_PLANES_MS) {
            // The session is blind. Ending it would close the installed app, and the relaunch from inside is not a
            // launch from the Library: wait for the planes, and keep the open project for a manual relaunch.
            waiting = now;
            core.logEvent('nessun piano: aspetto (niente riavvio)');
            core.prepareResume();
            core.showSearching(false);
          } else if (waiting !== null && !hinted && now - waiting > LOST_ROOM_MS) {
            hinted = true;
            core.logEvent('piani non tornati: chiudere e riaprire dalla Libreria');
            core.showSearching(true);
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
        if (src.handedness === 'none') continue;
        if (src.handedness === dominant) pr = pinchPoint(frame, src, ref);
        else pl = pinchPoint(frame, src, ref);
      }
      core.setPinchPoints(pl, pr); // for the two-hand turn / scale
      const seen = new Set<string>();
      let laserOn = false;
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
          if (src.handedness === dominant) {
            const palm = palmNormal(frame, src, ref);
            if (palm) {
              const toHead = head().pos.sub(palm.wrist).normalize();
              const facing = Math.max(palm.normal.y, palm.normal.dot(toHead)); // 1: palm straight up / at the face
              laserHidden = laserHidden ? facing > 0.55 : facing > 0.75; // hysteresis: no flicker at the edge
            } else laserHidden = false;
          }
          if (src.handedness === dominant && laserHidden) {
            core.host.setRay(id, null);
          } else if (src.handedness === dominant) {
            core.host.noCursor.add(id);
            if (!smoothO || !smoothD || smoothO.distanceTo(origin) > 0.4) {
              smoothO = origin.clone();
              smoothD = dir.clone();
            } else {
              const k = 1 - Math.exp(-Math.min(dt, 0.1) / (rightPinching ? TAU_PINCH : TAU_POINT));
              smoothO.lerp(origin, k);
              smoothD.lerp(dir, k).normalize();
            }
            origin.copy(smoothO);
            dir.copy(smoothD);
            const hit = core.aim(id, origin, dir);
            laser.meshReticle = !layers.active;
            laser.meshBeam = !layers.active;
            layers.showBeam(origin, dir, hit.length, head().pos);
            const end = laser.show(origin, dir, hit.length, hit.target !== 'none', rightPinching, head().pos);
            if (end) layers.showReticle(end.pos, head().pos, end.radius);
            laserOn = true;
          } else {
            core.host.setRay(id, null); // the other hand does not point at panels
          }
        } else {
          core.host.setRay(id, null);
        }
        if (src.handedness !== dominant && src.handedness !== 'none') {
          // The other controller's face buttons (X / Y, or A / B) toggle the menu.
          const pressed = !!(src.gamepad?.buttons[4]?.pressed || src.gamepad?.buttons[5]?.pressed);
          if (pressed && !leftToggleHeld) core.menu.toggle();
          leftToggleHeld = pressed;
        }
      }
      if (!laserOn) {
        smoothO = smoothD = null;
        laser.hide();
        rightPinching = false;
        if (!seen.size) laserHidden = false;
      }
      for (const id of activeIds) if (!seen.has(id)) core.host.setRay(id, null);
      activeIds = seen;

      const h = head();
      core.tick(now, h, dt);
      layers.update(frame, ref); // after the panels were placed for this frame
    },
  };
}
