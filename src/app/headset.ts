import { createSupabaseBackend } from '../cloud/repo';
import { createStage } from '../scene/stage';
import { createEnterAr } from './enterAr';
import { createLauncher } from './launcher';
import { createXrApp } from './xrApp';

const FEATURES = ['plane-detection', 'mesh-detection', 'hand-tracking'];

// The "unbounded" reference space is meant for AR without a boundary, and the origin is not
// recentred when you change room (the Guardian does not come back). If the browser refuses it we
// fall back to local-floor (see createEnterAr). ?ref=local-floor forces the old behaviour.
const UNBOUNDED = new URLSearchParams(location.search).get('ref') !== 'local-floor';

// Opened from the installed app icon: the tap is the user gesture that lets us start AR at once.
const params = new URLSearchParams(location.search);
const INSTALLED =
  params.has('pwa') ||
  document.referrer.startsWith('android-app://') ||
  ['standalone', 'fullscreen'].some((m) => matchMedia(`(display-mode: ${m})`).matches);

// Headset entry point: AR straight away when installed (otherwise one "Entra in AR" button), then
// the in-AR menu (sign-in, Load / Scan / Options / Account).
export async function runHeadsetApp() {
  const backend = createSupabaseBackend();
  const features = UNBOUNDED ? [...FEATURES, 'unbounded'] : FEATURES;
  const { renderer, scene, camera } = createStage({ features, arButton: false });
  renderer.xr.setReferenceSpaceType(UNBOUNDED ? 'unbounded' : 'local-floor');
  const enter = createEnterAr(renderer, features);
  const app = createXrApp(renderer, scene, camera, backend, () => void enter.restart());
  const launcher = await createLauncher(enter);
  renderer.xr.addEventListener('sessionend', () => launcher.show());
  if (INSTALLED) void enter.start(); // if the browser refuses (no gesture), the button stays
  renderer.setAnimationLoop((_t, frame) => {
    renderer.render(scene, camera);
    app.tick(frame);
  });
}
