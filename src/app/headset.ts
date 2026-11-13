import { createSupabaseBackend } from '../cloud/repo';
import { createStats } from '../ui/stats';
import { createStage } from '../scene/stage';
import { createEnterAr, isInstalledApp } from './enterAr';
import { relaunchApp, relaunchMode, takeRelaunchMark, whenAllowed } from './relaunch';
import { createLauncher } from './launcher';
import { depthFixPreferred, fpsPreferred } from './core';
import { createXrApp } from './xrApp';
import { takeDepthProbeRequest } from '../xr/depthFlag';

const FEATURES = ['plane-detection', 'mesh-detection', 'hand-tracking', 'layers'];

// The "unbounded" reference space is meant for AR without a boundary, and the origin is not
// recentred when you change room (the Guardian does not come back). If the browser refuses it we
// fall back to local-floor (see createEnterAr). ?ref=local-floor forces the old behaviour.
const UNBOUNDED = new URLSearchParams(location.search).get('ref') !== 'local-floor';

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
  const stats = createStats(camera); // fps readout, shown only when Options → "Pannello fps" is on
  stats.setEnabled(fpsPreferred());
  const enter = createEnterAr(renderer, features, depth ? { depthSensing: { usagePreference: ['cpu-optimized', 'gpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] } } : {});
  // Meta allows one room scan per XR session: for the next one the session is ended and the installed app opens itself again
  // (same relaunch as the old standby restart); the new session starts the scan by itself.
  const app = createXrApp(renderer, scene, camera, backend, (on) => stats.setEnabled(on), (opts) => {
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
    renderer.render(scene, camera);
    app.tick(frame);
    stats.setInfo(`${(renderer.info.render.triangles / 1000).toFixed(0)}k tris`);
    stats.tick(renderer.xr.isPresenting);
  });
}
