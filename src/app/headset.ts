import { createSupabaseBackend } from '../cloud/repo';
import { createStage } from '../scene/stage';
import { createEnterAr } from './enterAr';
import { createLauncher } from './launcher';
import { createXrApp } from './xrApp';

const FEATURES = ['plane-detection', 'mesh-detection', 'hand-tracking'];

// Headset entry point: sign-in page → AR with the in-AR menu (Load / Scan / Options / Account).
export async function runHeadsetApp() {
  const backend = createSupabaseBackend();
  const { renderer, scene, camera } = createStage({ features: FEATURES, arButton: false });
  const app = createXrApp(renderer, scene, camera, backend);
  const enter = createEnterAr(renderer, FEATURES);
  const launcher = await createLauncher(backend, enter);
  renderer.xr.addEventListener('sessionend', () => void launcher.show());
  renderer.setAnimationLoop((_t, frame) => {
    renderer.render(scene, camera);
    app.tick(frame);
  });
}
