import {
  Box3,
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
import { createModelLayer } from '../room/modelLayer';
import { deleteRoom, loadRoom, saveRoom, type StorageKind } from '../room/storage';
import type { RoomFile, RoomItem, RoomModel } from '../room/types';
import { createTextPanel } from '../ui/textPanel';

/* eslint-disable @typescript-eslint/no-explicit-any */
const MAX_RESID = 0.05; // m: accept the alignment only below this mean plane error
const MIN_MATCH = 0.7; // fraction of saved planes that must be found again

// Position of the pinch: midpoint of thumb and index tips for hands, grip for controllers.
function pinchPoint(frame: XRFrame, src: XRInputSource, ref: XRReferenceSpace): Vector3 | null {
  const hand = (src as any).hand;
  if (hand) {
    const a = hand.get('thumb-tip');
    const b = hand.get('index-finger-tip');
    const pa = a && frame.getJointPose?.(a, ref);
    const pb = b && frame.getJointPose?.(b, ref);
    if (!pa || !pb) return null;
    const u = pa.transform.position;
    const v = pb.transform.position;
    return new Vector3((u.x + v.x) / 2, (u.y + v.y) / 2, (u.z + v.z) / 2);
  }
  const pose = frame.getPose(src.gripSpace ?? src.targetRaySpace, ref);
  if (!pose) return null;
  const p = pose.transform.position;
  return new Vector3(p.x, p.y, p.z);
}

// ?room end-to-end test: the room's planes and placed items are saved in the
// room's own frame; on the next session the saved planes are aligned to the
// live scan and everything reappears at the same real-world spot.
// The room is captured automatically on first use. Models come from the PC editor
// (?edit). Left pinch: moves the model you are looking at exactly to the pinch
// point. Right pinch: drops a cube 1 m ahead. ?room=reset clears the saved room.
export function createRoomMode(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  setInfo: (text: string) => void,
) {
  let room: RoomFile | null = null;
  let roomLoaded = false; // never create/overwrite a room before the saved one is known
  let storage: StorageKind | '?' = '?';

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
  root.visible = true;

  let modelMsg = 'models: -';
  const layer = createModelLayer(root, (t) => {
    modelMsg = `model error: ${t}`.slice(0, 44);
  });

  let bound: XRSession | null = null;
  let started = 0;
  let lastTry = 0;
  let lastDraw = 0;
  let aligned: Alignment | null = null;
  let ready = false; // room frame is usable in this session (aligned or just captured)
  let msg = 'loading room...';

  const reset = new URLSearchParams(location.search).get('room') === 'reset';
  (reset ? deleteRoom().then(() => ({ room: null, kind: '?' as const })) : loadRoom())
    .then(({ room: r, kind }) => {
      room = r;
      storage = kind;
      roomLoaded = true;
      r?.items.forEach(addCube);
      layer.sync(room?.models ?? []);
      modelMsg = `models: ${room?.models.length ?? 0}`;
      setInfo(modelMsg);
      root.visible = !room || ready;
      msg = room ? 'aligning...' : reset ? 'room cleared, capturing...' : 'no room, capturing...';
    })
    .catch((e: Error) => {
      msg = `load FAILED: ${e.message}`;
    });

  const store = (r: RoomFile) =>
    saveRoom(r)
      .then((kind) => {
        storage = kind;
      })
      .catch((e: Error) => {
        msg = `save FAILED: ${e.message}`;
      });

  function bind(session: XRSession) {
    bound = session;
    started = performance.now();
    lastTry = 0;
    aligned = null;
    ready = false;
    root.visible = !room || !roomLoaded;
    root.matrix.identity();
    // selectstart = fingers touching, so the pinch position is exact.
    session.addEventListener('selectstart', (ev: any) => {
      if (ev.inputSource.handedness === 'left') placeModel(ev);
    });
    session.addEventListener('select', (ev: any) => {
      if (ev.inputSource.handedness !== 'left') place(ev);
    });
  }

  // The saved room can be edited once aligned, or created from the live scan.
  function ensureRoom(): boolean {
    if (!roomLoaded) {
      msg = 'room not loaded yet';
      return false;
    }
    if (!room) {
      msg = 'scan not ready, wait a few s';
      return false;
    } else if (!ready) {
      msg = 'not aligned yet, cannot place';
      return false;
    }
    return true;
  }

  // The model whose direction best matches where the user is looking.
  function gazedModel(): RoomModel | null {
    if (!room?.models.length) return null;
    const cam = renderer.xr.getCamera();
    const head = cam.getWorldPosition(new Vector3());
    const fwd = cam.getWorldDirection(new Vector3());
    let best: RoomModel | null = null;
    let bestDot = -2;
    for (const m of room.models) {
      const h = layer.holders.get(m.id);
      if (!h) continue;
      h.updateWorldMatrix(true, true);
      const box = new Box3().setFromObject(h);
      const c = box.isEmpty() ? h.getWorldPosition(new Vector3()) : box.getCenter(new Vector3());
      const dot = fwd.dot(c.sub(head).normalize());
      if (dot > bestDot) {
        bestDot = dot;
        best = m;
      }
    }
    return best;
  }

  function placeModel(ev: any) {
    const ref = renderer.xr.getReferenceSpace();
    if (!ref) return;
    const point = pinchPoint(ev.frame, ev.inputSource, ref);
    if (!point) return;
    if (!ensureRoom() || !room) return;
    const target = gazedModel();
    if (!target) {
      modelMsg = 'no models: add one in ?edit';
      return;
    }
    root.updateWorldMatrix(true, false);
    const local = root.worldToLocal(point.clone());
    target.pos = [local.x, local.y, local.z];
    layer.sync(room.models);
    store(room);
    modelMsg = `moved: ${target.name}`.slice(0, 44);
  }

  function place(ev: any) {
    const ref = renderer.xr.getReferenceSpace();
    if (!ref) return;
    const pose = ev.frame.getPose(ev.inputSource.targetRaySpace, ref);
    if (!pose) return;
    if (!ensureRoom() || !room) return;
    const p = pose.transform.position;
    const q = pose.transform.orientation;
    const dir = new Vector3(0, 0, -1).applyQuaternion({ x: q.x, y: q.y, z: q.z, w: q.w } as any);
    const world = new Vector3(p.x + dir.x, p.y + dir.y, p.z + dir.z);
    root.updateWorldMatrix(true, false);
    const local = root.worldToLocal(world);
    const item: RoomItem = { id: String(Date.now()), pos: [local.x, local.y, local.z] };
    room.items.push(item);
    addCube(item, room.items.length - 1);
    store(room);
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
        // First use of this room: capture the live scan as the room.
        if (roomLoaded && planes.length >= 4 && now - started > 4000) {
          room = { version: 1, savedAt: Date.now(), planes, items: [], models: [] };
          root.matrix.identity();
          root.visible = true;
          ready = true;
          store(room);
          msg = 'room captured+saved';
        }
      } else if (!aligned && planes.length && now - started > 3000 && now - lastTry > 1500) {
        lastTry = now;
        const a = alignPlanes(room.planes, planes);
        if (a && a.resid < MAX_RESID && a.matched >= MIN_MATCH * a.total) {
          aligned = a;
          ready = true;
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
        `live planes ${planes.length}  store: ${storage}`,
        room
          ? `saved: ${room.planes.length} planes, ${room.models.length} models, ${room.items.length} cubes`
          : 'saved: none',
        aligned
          ? `align ${(aligned.resid * 100).toFixed(1)}cm ${aligned.matched}/${aligned.total}`
          : 'align: -',
        msg,
        modelMsg,
      ];
      panel.setText(lines.join('\n'));
    },
  };
}

