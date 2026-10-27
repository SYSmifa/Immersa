import { PlaneGeometry, Raycaster, Vector2, Vector3 } from 'three';
import { buildOccluders, createOccluderMaterial } from '../room/occluders';
import { createStage } from '../scene/stage';
import { createAppCore } from './core';
import { asLive, asLiveBoxes, boxRoom, boxRoomBoxes, createFakeBackend } from './fakeBackend';

/* eslint-disable @typescript-eslint/no-explicit-any */
// ?uitest: the AR menu, keyboard, recognition and project loading on the PC, driven by
// the mouse and fake planes, so the whole flow can be checked without a headset.
// Rooms that are not saved anywhere, by name: [width, depth, height].
const FRESH: Record<string, [number, number, number]> = { Nuova: [4.4, 3.3, 2.5], Nuova2: [6.1, 4.7, 2.7], Nuova3: [3.8, 3, 2.4] };

export function runUiTest() {
  const { renderer, scene, camera, controls } = createStage({ arButton: false });
  controls.enabled = false;
  camera.position.set(0, 1.6, 1.4);
  camera.fov = 80; // wide enough to see the menu and the keyboard below it
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0.9, -1);

  const backend = createFakeBackend();
  const core = createAppCore({ scene, backend, signOut: () => core.say('Esci premuto') });
  core.sessionStarted({ available: true, start: async () => undefined });

  const head = () => ({ pos: camera.getWorldPosition(new Vector3()), fwd: camera.getWorldDirection(new Vector3()) });
  const ray = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const origin = camera.getWorldPosition(new Vector3());
    const dir = new Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(origin).normalize();
    core.host.setRay('mouse', origin, dir);
  };
  const dom = renderer.domElement;
  dom.addEventListener('pointermove', ray);
  dom.addEventListener('pointerdown', (e) => {
    ray(e);
    core.host.press('mouse');
  });
  dom.addEventListener('pointerup', () => core.host.release('mouse'));

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    core.tick(now, head(), Math.min(0.1, (now - last) / 1000));
    last = now;
    renderer.render(scene, camera);
  });

  (window as any).__test = {
    core,
    backend,
    // Pretend the headset now reports this room, in a fresh session frame.
    // 'Nuova', 'Nuova2', 'Nuova3' = rooms that are not saved anywhere; null = nothing scanned.
    // noOutline: planes without outlines (so the floor-under-you filter cannot judge).
    live(roomName: string | null, yawDeg = 0, tx = 0, ty = 0, tz = 0, noOutline = false) {
      const room = backend.rooms.find((r) => r.name === roomName);
      const planes = roomName && FRESH[roomName] ? boxRoom(...FRESH[roomName]) : room?.scan.planes;
      const live = planes ? asLive(planes, (yawDeg * Math.PI) / 180, tx, ty, tz) : [];
      const dims = roomName && FRESH[roomName] ? FRESH[roomName] : null;
      const boxes = dims ? boxRoomBoxes(dims[0], dims[1]) : (room?.scan.boxes ?? []);
      core.setLivePlanes(noOutline ? live.map(({ label, pos }) => ({ label, pos })) : live, planes ? asLiveBoxes(boxes, (yawDeg * Math.PI) / 180, tx, ty, tz) : []);
    },
    // The headset reports several stored rooms at once: [name, yawDeg, tx, ty, tz] each.
    liveMany(rooms: [string, number, number, number, number][]) {
      const planes = rooms.flatMap(([n, yaw, tx, ty, tz]) => {
        const room = backend.rooms.find((r) => r.name === n);
        const src = FRESH[n] ? boxRoom(...FRESH[n]) : (room?.scan.planes ?? []);
        return asLive(src, (yaw * Math.PI) / 180, tx, ty, tz);
      });
      core.setLivePlanes(planes, []);
    },
    // Does a ray from `from` towards `to` hit the room's occluders? (room frame)
    rayHitsOccluders(roomName: string, from: [number, number, number], to: [number, number, number]) {
      const room = backend.rooms.find((r) => r.name === roomName)!;
      const group = buildOccluders(room.scan.planes, createOccluderMaterial());
      group.updateMatrixWorld(true);
      const o = new Vector3(...from);
      const ray = new Raycaster(o, new Vector3(...to).sub(o).normalize());
      ray.far = new Vector3(...to).distanceTo(o);
      return ray.intersectObject(group, true).length;
    },
    // Screen position of a widget, to click it with the mouse.
    screenOf(which: 'menu' | 'keyboard', text: string) {
      const panel = core.panels[which];
      const w = panel.widgets.find((x) => x.text === text);
      if (!w) return null;
      const g = (panel.mesh.geometry as PlaneGeometry).parameters;
      const v = new Vector3(((w.rect.x + w.rect.w / 2) / panel.pxW - 0.5) * g.width, (0.5 - (w.rect.y + w.rect.h / 2) / panel.pxH) * g.height, 0);
      panel.mesh.updateWorldMatrix(true, false);
      panel.mesh.localToWorld(v).project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
  };
}
