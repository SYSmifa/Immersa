import {
  Box3,
  Camera,
  GridHelper,
  Group,
  Object3D,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Backend } from '../cloud/backend';
import { uploadModel } from '../cloud/models';
import { createSupabaseBackend } from '../cloud/repo';
import { drawPlanes } from '../room/draw';
import { createModelLayer } from '../room/modelLayer';
import type { Project, Room, Vec3 } from '../room/types';
import { createStage } from '../scene/stage';
import { createLogin } from '../ui/login';
import { createEditorUi } from './editorUi';

interface Deps {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  controls: OrbitControls;
  backend: Backend;
  upload?: (file: File) => Promise<{ path: string; name: string }>;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Where a new model starts: middle of the floor, on the floor.
function floorSpot(room: Room): Vec3 {
  const planes = room.scan.planes;
  const floors = planes.filter((p) => p.label === 'floor');
  const src = floors.length ? floors : planes;
  if (!src.length) return [0, 0, 0];
  const mean = (i: number) => src.reduce((a, p) => a + p.pos[i], 0) / src.length;
  return [mean(0), floors.length ? mean(1) : Math.min(...src.map((p) => p.pos[1])), mean(2)];
}

// Entry for the PC: stage without AR, login box, then the editor.
export function createEditorPage(backend: Backend = createSupabaseBackend(), upload?: Deps['upload']) {
  const { renderer, scene, camera, controls } = createStage({ arButton: false });
  createLogin();
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
  return createEditor({ renderer, scene, camera, controls, backend, upload });
}

// PC editor: pick a room (named scans from the headset), pick or create a project,
// add .glb models, move / rotate / scale them in real size, save the project.
export async function createEditor({ renderer, scene, camera, controls, backend, upload = uploadModel }: Deps) {
  let rooms: Room[] = [];
  let room: Room | null = null;
  let projects: Project[] = [];
  let project: Project | null = null;
  let selectedId: string | null = null;
  let dirty = false;
  let lastDrag = 0;

  const planesGroup = new Group();
  const modelsGroup = new Group();
  scene.add(planesGroup, modelsGroup);
  const layer = createModelLayer(modelsGroup, (t) => ui.setStatus(`Errore modello: ${t}`));

  const transform = new TransformControls(camera, renderer.domElement);
  scene.add(transform.getHelper());
  transform.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    lastDrag = Date.now();
  });

  const models = () => project?.models ?? [];
  const find = (id: string | null) => models().find((m) => m.id === id) ?? null;

  function refresh() {
    ui.setModels(models(), selectedId);
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

  function markDirty(on = true) {
    dirty = on;
    ui.setDirty(on);
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

  const confirmLeave = () => !dirty || confirm('Ci sono modifiche non salvate al progetto. Continuare senza salvare?');

  function showRoom(r: Room | null) {
    room = r;
    planesGroup.clear();
    project = null;
    projects = [];
    layer.sync([]);
    select(null);
    markDirty(false);
    ui.setRooms(rooms, r?.id ?? null);
    if (!r) {
      ui.setProjects([], null, false);
      return;
    }
    ui.setProjects([], null, true); // "Nuovo" works from here on, even if listing projects fails
    const drawn = drawPlanes(r.scan.planes, planesGroup, true);
    const spot = floorSpot(r);
    planesGroup.add(new GridHelper(8, 16, 0x335566, 0x223344).translateX(spot[0]).translateY(spot[1]).translateZ(spot[2]));
    const bounds = new Box3().setFromObject(planesGroup);
    const centre = bounds.getCenter(new Vector3());
    const span = Math.max(3, bounds.getSize(new Vector3()).length());
    controls.target.copy(centre);
    camera.position.set(centre.x, centre.y + span * 0.7, centre.z + span * 0.9);
    controls.update();
    ui.setStatus(`Stanza "${r.name}": ${r.scan.planes.length} piani (${drawn} con contorno)`);
  }

  function showProject(p: Project | null) {
    project = p;
    layer.sync(models());
    select(null);
    markDirty(false);
    ui.setProjects(projects, p?.id ?? null, !!room);
  }

  async function chooseRoom(id: string) {
    if (!confirmLeave()) return ui.setRooms(rooms, room?.id ?? null);
    const r = rooms.find((x) => x.id === id) ?? null;
    showRoom(r);
    if (!r) return;
    try {
      projects = await backend.listProjects(r.id);
    } catch (e) {
      return ui.setStatus(`Errore: ${errText(e)}`);
    }
    showProject(projects[0] ?? null); // the most recently saved one
    if (!projects.length) ui.setStatus(`Stanza "${r.name}": nessun progetto, creane uno con "Nuovo".`);
  }

  const ui = createEditorUi({
    onRoom: (id) => void chooseRoom(id),
    async onRenameRoom() {
      if (!room) return;
      const name = prompt('Nome della stanza', room.name)?.trim();
      if (!name || name === room.name) return;
      try {
        await backend.renameRoom(room.id, name);
        room.name = name;
        ui.setRooms(rooms, room.id);
      } catch (e) {
        ui.setStatus(`Errore: ${errText(e)}`);
      }
    },
    async onDeleteRoom() {
      if (!room || !confirm(`Eliminare la stanza "${room.name}" e tutti i suoi progetti?`)) return;
      try {
        await backend.deleteRoom(room.id);
        rooms = rooms.filter((r) => r !== room);
        dirty = false;
        showRoom(null);
        ui.setStatus('Stanza eliminata.');
      } catch (e) {
        ui.setStatus(`Errore: ${errText(e)}`);
      }
    },
    onProject(id) {
      if (!confirmLeave()) return ui.setProjects(projects, project?.id ?? null, !!room);
      showProject(projects.find((p) => p.id === id) ?? null);
    },
    async onNewProject() {
      if (!room || !confirmLeave()) return;
      const name = prompt('Nome del progetto')?.trim();
      if (!name) return;
      try {
        const p = await backend.createProject(room.id, name, []);
        projects.unshift(p);
        showProject(p);
        ui.setStatus(`Progetto "${name}" creato`);
      } catch (e) {
        ui.setStatus(`Errore: ${errText(e)}`);
      }
    },
    async onRenameProject() {
      if (!project) return;
      const name = prompt('Nome del progetto', project.name)?.trim();
      if (!name || name === project.name) return;
      try {
        await backend.saveProject(project.id, { name });
        project.name = name;
        ui.setProjects(projects, project.id, true);
      } catch (e) {
        ui.setStatus(`Errore: ${errText(e)}`);
      }
    },
    async onDeleteProject() {
      if (!project || !confirm(`Eliminare il progetto "${project.name}"?`)) return;
      try {
        await backend.deleteProject(project.id);
        projects = projects.filter((p) => p !== project);
        showProject(projects[0] ?? null);
      } catch (e) {
        ui.setStatus(`Errore: ${errText(e)}`);
      }
    },
    async onUpload(file) {
      if (!room || !project) return ui.setStatus('Scegli una stanza e un progetto prima di caricare un modello');
      ui.setStatus(`Carico ${file.name}...`);
      try {
        const { path, name } = await upload(file);
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        project.models.push({ id, name, path, pos: floorSpot(room), yaw: 0, scale: 1 });
        layer.sync(project.models);
        select(id);
        markDirty();
        ui.setStatus('Caricato. Ricorda di salvare.');
      } catch (e) {
        ui.setStatus(`Upload FALLITO: ${errText(e)}`);
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
      if (!m) return;
      m.scale = value;
      layer.sync(models());
      markDirty();
      refresh();
    },
    onDeleteModel() {
      if (!project || !selectedId) return;
      project.models = project.models.filter((m) => m.id !== selectedId);
      layer.sync(project.models);
      select(null);
      markDirty();
    },
    async onSave() {
      if (!project) return;
      ui.setStatus('Salvo...');
      try {
        await backend.saveProject(project.id, { models: project.models });
        markDirty(false);
        ui.setStatus(`Progetto "${project.name}" salvato`);
      } catch (e) {
        ui.setStatus(`Salvataggio FALLITO: ${errText(e)}`);
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
  setInterval(() => selectedId && refresh(), 1000); // late-loading models change the size readout

  ui.setRooms([], null);
  ui.setProjects([], null, false);
  ui.setStatus('Carico le stanze...');
  try {
    if (!(await backend.email())) return ui.setStatus('Accedi (in alto a destra) con lo stesso account del visore.');
    rooms = await backend.listRooms();
  } catch (e) {
    return ui.setStatus(`Caricamento FALLITO: ${errText(e)}`);
  }
  ui.setRooms(rooms, null);
  ui.setStatus(
    rooms.length
      ? 'Scegli la stanza da aprire.'
      : 'Nessuna stanza salvata: scansionala e salvala dal visore (tab Scan).',
  );
  if (rooms.length === 1) void chooseRoom(rooms[0].id);
  return { select };
}
