import { createStage } from './scene/stage';
import { loadTestModel } from './scene/testModel';
import { createStats } from './ui/stats';

const { renderer, scene, camera } = createStage();
const stats = createStats(camera);

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  stats.tick();
});

loadTestModel().then(({ root, source, triangles }) => {
  scene.add(root);
  stats.setInfo(`${source}: ${(triangles / 1000).toFixed(0)}k tris`);
});
