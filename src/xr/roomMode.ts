import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { alignPlanes, type Alignment } from '../room/align';
import { readPlanes } from '../room/capture';
import { loadRoom, saveRoom } from '../room/storage';
import type { RoomFile, RoomItem, RoomPlane } from '../room/types';
import { createTextPanel } from '../ui/textPanel';

/* eslint-disable @typescript-eslint/no-explicit-any */
const MAX_RESID = 0.05; // m: accept the alignment only below this mean plane error
const MIN_MATCH = 0.7; // fraction of saved planes that must be found again

// ?room end-to-end test: pinch drops a cube (saved in the room's own frame);
// on the next session the saved planes are aligned to the live scan and the
// cubes should reappear at the same real-world spot. ?room=reset clears it.
export function createRoomMode(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
  if (new URLSearchParams(location.search).get('room') === 'reset') saveRoom(null);
  let room: RoomFile | null = loadRoom();

  const panel = createTextPanel(camera, 0.3, -0.1, -0.9);
  const root = new Group(); // room frame -> session frame
  root.matrixAutoUpdate = false;
  scene.add(root);
  const cubeGeo = new BoxGeometry(0.15, 0.15, 0.15);

  function addCube(item: RoomItem, index: number) {
    const cube = new Mesh(
      cubeGeo,
      new MeshBasicMaterial({ color: new Color().setHSL((index * 0.17) % 1, 1, 0.5) }),
    );
    cube.position.set(...item.pos);
    root.add(cube);
  }
  room?.items.forEach(addCube);
  root.visible = !room;

  let bound: XRSession | null = null;
  let started = 0;
  let lastTry = 0;
  let lastDraw = 0;
  let aligned: Alignment | null = null;
  let livePlanes: RoomPlane[] = [];
  let msg = room ? 'aligning...' : 'no room: pinch to start';

  function bind(session: XRSession) {
    bound = session;
    started = performance.now();
    lastTry = 0;
    aligned = null;
    root.visible = !room;
    root.matrix.identity();
    session.addEventListener('select', (ev: any) => place(ev));
  }

  function place(ev: any) {
    const ref = renderer.xr.getReferenceSpace();
    if (!ref) return;
    const pose = ev.frame.getPose(ev.inputSource.targetRaySpace, ref);
    if (!pose) return;
    if (!room) {
      if (livePlanes.length < 4) {
        msg = 'scan not ready, wait a few s';
        return;
      }
      // First capture: the room frame is this session's frame.
      room = { version: 1, savedAt: Date.now(), planes: livePlanes, items: [] };
      root.matrix.identity();
      root.visible = true;
    } else if (!aligned) {
      msg = 'not aligned yet, cannot place';
      return;
    }
    const p = pose.transform.position;
    const q = pose.transform.orientation;
    const dir = new Vector3(0, 0, -1).applyQuaternion({ x: q.x, y: q.y, z: q.z, w: q.w } as any);
    const world = new Vector3(p.x + dir.x, p.y + dir.y, p.z + dir.z);
    root.updateWorldMatrix(true, false);
    const local = root.worldToLocal(world);
    const item: RoomItem = { id: String(Date.now()), pos: [local.x, local.y, local.z] };
    room.items.push(item);
    addCube(item, room.items.length - 1);
    saveRoom(room);
    msg = `cube ${room.items.length} saved`;
  }

  return {
    tick(frame?: XRFrame) {
      if (!frame) return;
      if (frame.session !== bound) bind(frame.session);
      const ref = renderer.xr.getReferenceSpace();
      if (!ref) return;
      const now = performance.now();
      const planes = readPlanes(frame, ref);

      if (!room) {
        if (now - started > 4000) livePlanes = planes;
      } else if (!aligned && planes.length && now - started > 3000 && now - lastTry > 1500) {
        lastTry = now;
        const a = alignPlanes(room.planes, planes);
        if (a && a.resid < MAX_RESID && a.matched >= MIN_MATCH * a.total) {
          aligned = a;
          // three's Y rotation is the opposite sense of our xz yaw.
          root.matrix.makeRotationY(-a.yaw).setPosition(a.tx, a.ty, a.tz);
          root.visible = true;
          msg = 'aligned';
        } else if (a) {
          msg = `no good match: ${(a.resid * 100).toFixed(1)}cm ${a.matched}/${a.total}`;
        }
      }

      if (now - lastDraw < 500) return;
      lastDraw = now;
      const lines = [
        'ROOM',
        `live planes ${planes.length}`,
        room
          ? `saved: ${room.planes.length} planes, ${room.items.length} cubes`
          : 'saved: none',
        aligned
          ? `align ${(aligned.resid * 100).toFixed(1)}cm ${aligned.matched}/${aligned.total}`
          : 'align: -',
        msg,
      ];
      panel.setText(lines.join('\n'));
    },
  };
}

