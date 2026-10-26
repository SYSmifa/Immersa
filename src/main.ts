import { createStage } from './scene/stage';
import { loadTestModel } from './scene/testModel';
import { createStats } from './ui/stats';
import { createProbe } from './xr/probe';
import { createRoomMode } from './xr/roomMode';

const params = new URLSearchParams(location.search);
const probeMode = params.has('probe');
const roomMode = params.has('room');
const { renderer, scene, camera } = createStage(
  probeMode ? ['plane-detection', 'mesh-detection', 'anchors'] : roomMode ? ['plane-detection'] : [],
);
const stats = createStats(camera);
const probe = probeMode ? createProbe(renderer, scene, camera) : null;
const room = roomMode ? createRoomMode(renderer, scene, camera) : null;

renderer.setAnimationLoop((_time, frame) => {
  renderer.render(scene, camera);
  probe?.tick(frame);
  room?.tick(frame);
  stats.tick();
});

loadTestModel().then(({ root, source, triangles }) => {
  scene.add(root);
  stats.setInfo(`${source}: ${(triangles / 1000).toFixed(0)}k tris`);
});
