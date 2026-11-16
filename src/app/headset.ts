import { createSupabaseBackend } from '../cloud/repo';
import { createStats } from '../ui/stats';
import { perf } from '../ui/perf';
import { createStage } from '../scene/stage';
import { createEnterAr, isInstalledApp } from './enterAr';
import { relaunchApp, relaunchMode, takeRelaunchMark, whenAllowed } from './relaunch';
import { createLauncher } from './launcher';
import { depthFixPreferred, foveationPreferred, fpsPreferred, meshesNeeded, planesPreferred, refSpacePreferred } from './core';
import { createXrApp } from './xrApp';
import { takeDepthProbeRequest } from '../xr/depthFlag';

// ?off=planes,meshes,hands,layers asks the session WITHOUT those features (to find which one makes the models shake); the app is made to cope.
const OFF = (new URLSearchParams(location.search).get('off') ?? '').split(',');
const FEATURES = [
  ['plane-detection', 'planes'],
  ['mesh-detection', 'meshes'],
  ['hand-tracking', 'hands'],
  ['layers', 'layers'],
]
  .filter(([, key]) => !OFF.includes(key))
  .map(([name]) => name)
  // `mesh-detection` (the furniture volumes of a scan) makes the models shake while you walk: asked for only to save a just-scanned room
  .filter((name) => name !== 'mesh-detection' || meshesNeeded())
  .filter((name) => name !== 'plane-detection' || planesPreferred() || meshesNeeded());

// The "unbounded" reference space is meant for AR without a boundary, and the origin is not
// recentred when you change room (the Guardian does not come back). If the browser refuses it we
// fall back to local-floor (see createEnterAr). ?ref=local-floor forces the old behaviour.
const UNBOUNDED = new URLSearchParams(location.search).get('ref') !== 'local-floor' && refSpacePreferred() === 'unbounded';

// Headset entry point: tries to start AR straight away (works when launched from the installed app; otherwise one "Entra in AR" button), then
// the in-AR menu (sign-in, Load / Scan / Options / Account).
export async function runHeadsetApp() {
  if (takeDepthProbeRequest()) return (await import('../xr/depthProbe')).runDepthProbe(true); // asked in Account: this start is the depth measuring page, once
  const backend = createSupabaseBackend();
  // The depth correction of the rooms (Options → "Correzione con la profondità") needs the depth; it is asked for only when on.
  const depth = depthFixPreferred();
  const features = [...FEATURES, ...(UNBOUNDED ? ['unbounded'] : []), ...(depth ? ['depth-sensing'] : [])];
  const { renderer, scene, camera } = createStage({ features, arButton: false });
  renderer.xr.setReferenceSpaceType(UNBOUNDED ? 'unbounded' : 'local-floor');
  // With the depth on, three.js also draws the headset's depth into the scene so that the real world hides virtual things (the sofa
  // behind your hand): at the depth's low resolution the edges are blocky. We only READ the depth (for the correction of the rooms),
  // so that occlusion is left out, as it was before: the walls and hands are handled as they always were.
  if (depth) {
    renderer.xr.getDepthSensingMesh = () => null;
    renderer.xr.hasDepthSensing = () => false;
  }
  const stats = createStats(camera);
  perf.sink = (name, ms) => stats.section(name, ms); // fps readout, shown only when Options → "Pannello fps" is on
  stats.setEnabled(fpsPreferred());
  const enter = createEnterAr(renderer, features, depth ? { depthSensing: { usagePreference: ['cpu-optimized', 'gpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] } } : {});
  // Meta allows one room scan per XR session: for the next one the session is ended and the installed app opens itself again
  // (same relaunch as the old standby restart); the new session starts the scan by itself.
  renderer.xr.setFoveation(foveationPreferred()); // three.js' own default is the maximum
  const app = createXrApp(renderer, scene, camera, backend, (on) => stats.setEnabled(on), (v) => renderer.xr.setFoveation(v), (opts) => {
    const mode = relaunchMode();
    app.core.logEvent(isInstalledApp() ? `riavvio: ${mode}` : 'riavvio: nuova sessione');
    if (!isInstalledApp()) return void setTimeout(() => void enter.restart(), 100);
    if (mode === 'legacy') {
      relaunchApp(mode); // the old way: an intent to the running app, then a new session in this page
      return void setTimeout(() => void enter.restart(), 100);
    }
    // The APK starts the app again from scratch and closes this one with its task. The session is NOT ended here: ending an XR
    // session closes the installed app, and then nobody would be left to ask for the relaunch. If nothing happens (an APK
    // without the relaunch activity), after a few seconds a new session is started here, as before (not for an automatic
    // relaunch: ending the session would close the app for nothing).
    if (opts?.auto) {
      // Decided by the app, maybe long after the last tap: the browser follows the link right after a tap only.
      if (whenAllowed(() => relaunchApp(mode)) === 'tap') {
        app.core.logEvent('riavvio: aspetto un tocco per poterlo fare');
        app.core.restartNeedsTap();
      }
      return;
    }
    relaunchApp(mode);
    setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      app.core.logEvent('riavvio: l\'APK non ha risposto, nuova sessione qui');
      void enter.restart();
    }, 3500);
  });
  const mark = takeRelaunchMark();
  if (mark) app.core.logEvent(`avviata dopo riavvio (${mark.mode}) in ${mark.seconds.toFixed(1)} s`);
  const launcher = await createLauncher(enter);
  renderer.xr.addEventListener('sessionend', () => launcher.show());
  void enter.autoStart(); // the installed app's launch is the gesture; in a plain tab the button stays
  renderer.setAnimationLoop((_t, frame) => {
    // First what moves with the frame's poses (hands, laser, cards, menu), then the drawing: the other way round everything the app
    // moves was drawn one frame late, which with the head moving shows as shaking (hands most of all).
    const t0 = performance.now();
    app.tick(frame);
    const t1 = performance.now();
    renderer.render(scene, camera);
    stats.section('app', t1 - t0);
    stats.section('disegno', performance.now() - t1);
    const hz = (renderer.xr.getSession() as unknown as { frameRate?: number } | null)?.frameRate;
    const pe = app.core.planesEvery(performance.now());
    stats.setInfo(`${(renderer.info.render.triangles / 1000).toFixed(0)}k tris${hz ? `  ${Math.round(hz)} Hz` : ''}  piani ${pe >= 1000 ? `${pe / 1000}s` : `${pe}ms`}${pe < 15000 ? ` ${app.core.planesWhy(performance.now())}` : ''}`);
    stats.tick(renderer.xr.isPresenting);
  });
}
