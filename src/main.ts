import { createStage } from './scene/stage';
import { loadTestModel } from './scene/testModel';
import { createStats } from './ui/stats';
import { createProbe } from './xr/probe';

const probeMode = new URLSearchParams(location.search).has('probe');
const { renderer, scene, camera } = createStage(
  probeMode ? ['plane-detection', 'mesh-detection', 'anchors'] : [],
);
const stats = createStats(camera);
const probe = probeMode ? createProbe(renderer, scene, camera) : null;

renderer.setAnimationLoop((_time, frame) => {
  renderer.render(scene, camera);
  probe?.tick(frame);
  stats.tick();
});

loadTestModel().then(({ root, source, triangles }) => {
  scene.add(root);
  stats.setInfo(`${source}: ${(triangles / 1000).toFixed(0)}k tris`);
});
