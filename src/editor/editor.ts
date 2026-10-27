import {
  Box3,
  BufferGeometry,
  Camera,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineLoop,
  Object3D,
  Points,
  PointsMaterial,
  Quaternion,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { uploadModel } from '../cloud/models';
import { createModelLayer } from '../room/modelLayer';
import { loadRoom, saveRoom } from '../room/storage';
import type { RoomFile, Vec3 } from '../room/types';
import { createEditorUi } from './editorUi';

interface Deps {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  controls: OrbitControls;
}

// Returns how many outlines could be drawn. Plane centres are always marked (yellow dots).
function drawPlanes(room: RoomFile, into: Group): number {
  let drawn = 0;
  const mat = new LineBasicMaterial({ color: 0x00c8ff });
  const floor = new LineBasicMaterial({ color: 0x40ff80 });
  for (const p of room.planes) {
    if (!p.poly || !p.quat || p.poly.length < 6) continue;
    const pts: Vector3[] = [];
    for (let i = 0; i < p.poly.length; i += 2) pts.push(new Vector3(p.poly[i], 0, p.poly[i + 1]));
    const line = new LineLoop(new BufferGeometry().setFromPoints(pts), p.label === 'floor' ? floor : mat);
    line.matrixAutoUpdate = false;
    line.matrix.compose(new Vector3(...p.pos), new Quaternion(...p.quat), new Vector3(1, 1, 1));
    into.add(line);
    drawn++;
  }
  const centres = room.planes.map((p) => new Vector3(...p.pos));
  into.add(new Points(new BufferGeometry().setFromPoints(centres), new PointsMaterial({ color: 0xffd000, size: 8, sizeAttenuation: false })));
  return drawn;
}

// Where a new model starts: middle of the floor, on the floor.
function floorSpot(room: RoomFile): Vec3 {
  const floors = room.planes.filter((p) => p.label === 'floor');
  const src = floors.length ? floors : room.planes;
  if (!src.length) return [0, 0, 0];
  const mean = (i: number) => src.reduce((a, p) => a + p.pos[i], 0) / src.length;
  return [mean(0), floors.length ? mean(1) : Math.min(...src.map((p) => p.pos[1])), mean(2)];
}

// PC editor (?edit): the saved room as wireframe, models from the cloud that can
// be added, moved, rotated, scaled and saved back to the same room.
export async function createEditor({ renderer, scene, camera, controls }: Deps) {
  document.getElementById('ARButton')?.remove();
  let room: RoomFile | null = null;
  let selectedId: string | null = null;
  let dirty = false;

  const view = new Group(); // room frame
  scene.add(view);
  const layer = createModelLayer(view, (t) => ui.setStatus(`Errore modello: ${t}`));

  const transform = new TransformControls(camera, renderer.domElement);
  scene.add(transform.getHelper());
  transform.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    lastDrag = Date.now();
  });
  let lastDrag = 0;

  const find = (id: string | null) => room?.models.find((m) => m.id === id) ?? null;

  function refresh() {
    ui.setModels(room?.models ?? [], selectedId);
    const m = find(selectedId);
    const holder = selectedId ? layer.holders.get(selectedId) : null;
    if (!m || !holder) return ui.setSelection(null);
    // Size along the model's own axes: measure with yaw 0, matrices fresh.
    const yaw = holder.rotation.y;
    holder.rotation.y = 0;
    holder.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(holder);
    holder.rotation.y = yaw;
    holder.updateWorldMatrix(true, true);
    const dim = box.isEmpty() ? null : box.getSize(new Vector3());
    ui.setSelection({ scale: m.scale, size: dim ? [dim.x, dim.y, dim.z] : null });
  }

  function select(id: string | null) {
    selectedId = id;
    const holder = id ? layer.holders.get(id) : null;
    if (holder) transform.attach(holder);
    else transform.detach();
    refresh();
  }

  function markDirty() {
    dirty = true;
    ui.setDirty(true);
  }

  // The holder is the source of truth while dragging; copy it back to the model.
  transform.addEventListener('objectChange', () => {
    const holder = transform.object as Object3D | undefined;
    const m = find(holder?.userData.modelId ?? null);
    if (!holder || !m) return;
    m.pos = [holder.position.x, holder.position.y, holder.position.z];
    m.yaw = holder.rotation.y;
    markDirty();
  });

  const ui = createEditorUi({
    async onUpload(file) {
      if (!room) return ui.setStatus('Nessuna stanza: scansiona prima dal visore (?room)');
      ui.setStatus(`Carico ${file.name}...`);
      try {
        const { path, name } = await uploadModel(file);
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        room.models.push({ id, name, path, pos: floorSpot(room), yaw: 0, scale: 1 });
        layer.sync(room.models);
        select(id);
        markDirty();
        ui.setStatus('Caricato. Ricorda di salvare.');
      } catch (e) {
        ui.setStatus(`Upload FALLITO: ${(e as Error).message}`);
      }
    },
    onSelect: select,
    onMode(mode) {
      transform.setMode(mode);
      // Only yaw makes sense for a model standing on the floor.
      transform.showX = mode === 'translate';
      transform.showZ = mode === 'translate';
    },
    onScale(value) {
      const m = find(selectedId);
      if (!room || !m) return;
      m.scale = value;
      layer.sync(room.models);
      markDirty();
      refresh();
    },
    onDelete() {
      if (!room || !selectedId) return;
      room.models = room.models.filter((m) => m.id !== selectedId);
      layer.sync(room.models);
      select(null);
      markDirty();
    },
    async onSave() {
      if (!room) return;
      ui.setStatus('Salvo...');
      try {
        room.savedAt = Date.now();
        const kind = await saveRoom(room);
        dirty = false;
        ui.setDirty(false);
        ui.setStatus(kind === 'cloud' ? 'Salvato nel cloud' : 'Salvato solo in locale (non sei loggato)');
      } catch (e) {
        ui.setStatus(`Salvataggio FALLITO: ${(e as Error).message}`);
      }
    },
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  // Click a model in the 3D view to select it (ignoring drags and gizmo clicks).
  const ray = new Raycaster();
  let down: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    if (Date.now() - lastDrag < 300 || transform.axis) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([...layer.holders.values()], true)[0];
    let o: Object3D | null = hit?.object ?? null;
    while (o && !o.userData.modelId) o = o.parent;
    select(o ? (o.userData.modelId as string) : null);
  });

  // Reflect late-loading models in the size readout.
  setInterval(() => selectedId && refresh(), 1000);

  ui.setStatus('Carico la stanza...');
  try {
    const { room: loaded, kind } = await loadRoom();
    room = loaded;
    if (!room) {
      ui.setStatus(
        kind === 'local'
          ? 'Nessuna stanza: accedi (in alto a destra), con lo stesso account del visore.'
          : 'Nessuna stanza salvata: aprila nel visore con ?room per scansionarla.',
      );
      return;
    }
  } catch (e) {
    ui.setStatus(`Caricamento FALLITO: ${(e as Error).message}`);
    return;
  }

  const drawn = drawPlanes(room, view);
  const outlines = new Box3().setFromObject(view);
  const spot = floorSpot(room);
  view.add(new GridHelper(8, 16, 0x335566, 0x223344).translateX(spot[0]).translateY(spot[1]).translateZ(spot[2]));
  const bounds = outlines.isEmpty() ? new Box3().setFromPoints(room.planes.map((p) => new Vector3(...p.pos))) : outlines;
  const centre = bounds.getCenter(new Vector3());
  const span = Math.max(3, bounds.getSize(new Vector3()).length());
  controls.target.copy(centre);
  camera.position.set(centre.x, centre.y + span * 0.7, centre.z + span * 0.9);
  controls.update();

  layer.sync(room.models);
  select(null);
  const ext = new Box3().setFromPoints(room.planes.map((p) => new Vector3(...p.pos))).getSize(new Vector3());
  ui.setStatus(
    `Stanza: ${room.planes.length} piani (${drawn} con contorno), ${room.models.length} modelli\n` +
      `Ingombro centri ${ext.x.toFixed(1)} × ${ext.y.toFixed(1)} × ${ext.z.toFixed(1)} m` +
      (drawn ? '' : '\nNessun contorno disegnabile: se hai appena rifatto ?room=reset, dimmelo'),
  );
}

