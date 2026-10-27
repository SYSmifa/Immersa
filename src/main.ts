import { createStage } from './scene/stage';
import { loadTestModel } from './scene/testModel';
import { createLogin } from './ui/login';
import { createStats } from './ui/stats';
import { createProbe } from './xr/probe';
import { createRoomMode } from './xr/roomMode';

const params = new URLSearchParams(location.search);
const probeMode = params.has('probe');
const roomMode = params.has('room');
const { renderer, scene, camera } = createStage(
  probeMode ? ['plane-detection', 'mesh-detection', 'anchors'] : roomMode ? ['plane-detection', 'hand-tracking'] : [],
);
const stats = createStats(camera);
createLogin();
const probe = probeMode ? createProbe(renderer, scene, camera) : null;
const room = roomMode
  ? createRoomMode(renderer, scene, camera, (t) => stats.setInfo(t))
  : null;

renderer.setAnimationLoop((_time, frame) => {
  renderer.render(scene, camera);
  probe?.tick(frame);
  room?.tick(frame);
  stats.tick();
});

if (!roomMode) {
  loadTestModel().then(({ root, source, triangles }) => {
    scene.add(root);
    stats.setInfo(`${source}: ${(triangles / 1000).toFixed(0)}k tris`);
  });
}
