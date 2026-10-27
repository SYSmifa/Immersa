import { createSupabaseBackend } from '../cloud/repo';
import { createStage } from '../scene/stage';
import { createEnterAr } from './enterAr';
import { createLauncher } from './launcher';
import { createXrApp } from './xrApp';

const FEATURES = ['plane-detection', 'mesh-detection', 'hand-tracking'];

// ?ref=unbounded: experiment, ask for the "unbounded" reference space instead of local-floor
// (meant for AR without a boundary; the origin should not be recentred when you change room).
const UNBOUNDED = new URLSearchParams(location.search).get('ref') === 'unbounded';

// Headset entry point: sign-in page → AR with the in-AR menu (Load / Scan / Options / Account).
export async function runHeadsetApp() {
  const backend = createSupabaseBackend();
  const features = UNBOUNDED ? [...FEATURES, 'unbounded'] : FEATURES;
  const { renderer, scene, camera } = createStage({ features, arButton: false });
  if (UNBOUNDED) renderer.xr.setReferenceSpaceType('unbounded');
  const app = createXrApp(renderer, scene, camera, backend);
  const enter = createEnterAr(renderer, features);
  const launcher = await createLauncher(backend, enter);
  renderer.xr.addEventListener('sessionend', () => void launcher.show());
  renderer.setAnimationLoop((_t, frame) => {
    renderer.render(scene, camera);
    app.tick(frame);
  });
}
