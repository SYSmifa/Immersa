import { createStage } from './stage';
import { loadTestModel } from './testModel';
import { createLogin } from '../ui/login';
import { createStats } from '../ui/stats';
import { createProbe } from '../xr/probe';

// Performance / diagnostics scene: ?test (test model, ?tris= / ?size=) and ?probe (Space Setup stability).
export function runTestScene(probeMode: boolean) {
  const { renderer, scene, camera } = createStage({
    features: probeMode ? ['plane-detection', 'mesh-detection', 'anchors'] : [],
  });
  const stats = createStats(camera);
  createLogin();
  const probe = probeMode ? createProbe(renderer, scene, camera) : null;

  renderer.setAnimationLoop((_time, frame) => {
    renderer.render(scene, camera);
    probe?.tick(frame);
    stats.tick(renderer.xr.isPresenting);
  });

  if (!probeMode) {
    loadTestModel().then(({ root, source, triangles }) => {
      scene.add(root);
      stats.setInfo(`${source}: ${(triangles / 1000).toFixed(0)}k tris`);
    });
  }
}
