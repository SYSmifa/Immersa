import { createSupabaseBackend } from '../cloud/repo';
import { createStats } from '../ui/stats';
import { createStage } from '../scene/stage';
import { createEnterAr, isInstalledApp } from './enterAr';
import { createLauncher } from './launcher';
import { fpsPreferred } from './core';
import { createXrApp } from './xrApp';

const APP_PACKAGE = 'app.immersa.quest'; // the installed app (see docs/pwa-quest.md)
const FEATURES = ['plane-detection', 'mesh-detection', 'hand-tracking', 'layers'];

// The "unbounded" reference space is meant for AR without a boundary, and the origin is not
// recentred when you change room (the Guardian does not come back). If the browser refuses it we
// fall back to local-floor (see createEnterAr). ?ref=local-floor forces the old behaviour.
const UNBOUNDED = new URLSearchParams(location.search).get('ref') !== 'local-floor';

// Headset entry point: tries to start AR straight away (works when launched from the installed app; otherwise one "Entra in AR" button), then
// the in-AR menu (sign-in, Load / Scan / Options / Account).
export async function runHeadsetApp() {
  const backend = createSupabaseBackend();
  const features = UNBOUNDED ? [...FEATURES, 'unbounded'] : FEATURES;
  const { renderer, scene, camera } = createStage({ features, arButton: false });
  renderer.xr.setReferenceSpaceType(UNBOUNDED ? 'unbounded' : 'local-floor');
  const stats = createStats(camera); // fps readout, shown only when Options → "Pannello fps" is on
  stats.setEnabled(fpsPreferred());
  const enter = createEnterAr(renderer, features);
  // Ending the session closes the installed app. Ask Android to open it again (experiment: if the browser refuses, the app
  // just closes and is opened from the library); the last project comes back by itself.
  const app = createXrApp(renderer, scene, camera, backend, (on) => stats.setEnabled(on), () => {
    if (isInstalledApp()) {
      try {
        location.href = `intent://${location.host}/#Intent;scheme=https;package=${APP_PACKAGE};end`;
      } catch {
        /* not allowed */
      }
    }
    setTimeout(() => void enter.restart(), 100);
  });
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
