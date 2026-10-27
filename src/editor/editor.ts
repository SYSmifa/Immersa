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
import { drawBoxes, drawPlanes } from '../room/draw';
import { floorCentre } from '../room/floor';
import { createModelLayer } from '../room/modelLayer';
import type { Project, Room } from '../room/types';
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

// Entry for the PC: stage without AR, login box, then the editor.
export function createEditorPage(backend: Backend = createSupabaseBackend(), upload?: Deps['upload']) {
  const { renderer, scene, camera, controls } = createStage({ arButton: false });
  createLogin();
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
  return createEditor({ renderer, scene, camera, controls, backend, upload });
}

// PC editor: pick or create a project, add the rooms it covers (named scans from the headset),
// then for each room add .glb models and move / rotate / scale them in real size.
export async function createEditor({ renderer, scene, camera, controls, backend, upload = uploadModel }: Deps) {
  let rooms: Room[] = [];
  let projects: Project[] = [];
  let project: Project | null = null;
  let room: Room | null = null; // the room of the project being edited
  let selectedId: string | null = null;
  let dirty = false;
  let lastDrag = 0;

  const planesGroup = new Group();
  let shell: Group | null = null; // walls, doors, windows of the open room
  let shellVisible = true;
  const modelsGroup = new Group();
  scene.add(planesGroup, modelsGroup);
  const layer = createModelLayer(modelsGroup, (t) => ui.setStatus(`Errore modello: ${t}`));

  const transform = new TransformControls(camera, renderer.domElement);
  scene.add(transform.getHelper());
  transform.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    lastDrag = Date.now();
  });

  const projectRoomsList = () => (project?.roomIds ?? []).map((id) => rooms.find((r) => r.id === id)).filter((r): r is Room => !!r);
  const models = () => project?.models.filter((m) => m.roomId === room?.id) ?? [];
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

  function refreshLists() {
    ui.setProjects(projects.map((p) => ({ id: p.id, name: p.name })), project?.id ?? null);
    const mine = projectRoomsList();
    ui.setProjectRooms(
      mine,
      room?.id ?? null,
      rooms.filter((r) => !project?.roomIds.includes(r.id)),
    );
    ui.setAccountRooms(rooms);
    ui.setState(!!project, !!room);
  }

  // Draw one room of the project and its models.
  function showRoom(r: Room | null) {
    room = r;
    planesGroup.clear();
    shell = null;
    select(null);
    layer.sync(models());
    refreshLists();
    refresh();
    if (!r) {
      ui.setStatus(project ? 'Questo progetto non ha stanze: aggiungine una.' : 'Scegli o crea un progetto.');
      return;
    }
    const plan = drawPlanes(r.scan.planes, planesGroup, true, r.scan.boxes ?? []);
    shell = plan.shell;
    shell.visible = shellVisible;
    const volumes = drawBoxes(r.scan.boxes ?? [], planesGroup, true);
    const spot = floorCentre(r.scan.planes);
    planesGroup.add(new GridHelper(8, 16, 0x335566, 0x223344).translateX(spot[0]).translateY(spot[1]).translateZ(spot[2]));
    const bounds = new Box3().setFromObject(planesGroup);
    const centre = bounds.getCenter(new Vector3());
    const span = Math.max(3, bounds.getSize(new Vector3()).length());
    controls.target.copy(centre);
    camera.position.set(centre.x, centre.y + span * 0.7, centre.z + span * 0.9);
    controls.update();
    ui.setStatus(`Stanza "${r.name}": ${r.scan.planes.length} piani (${plan.drawn} con contorno), ${volumes} volumi`);
  }

  function showProject(p: Project | null) {
    project = p;
    markDirty(false);
    showRoom(projectRoomsList()[0] ?? null);
  }

  async function run(what: () => Promise<void>) {
    try {
      await what();
    } catch (e) {
      ui.setStatus(`Errore: ${errText(e)}`);
    }
  }

  const ui = createEditorUi({
    onProject(id) {
      if (!confirmLeave()) return refreshLists();
      showProject(projects.find((p) => p.id === id) ?? null);
    },
    onNewProject: () =>
      run(async () => {
        if (!confirmLeave()) return;
        const name = prompt('Nome del progetto')?.trim();
        if (!name) return;
        // With a single room in the account the project starts in it.
        const p = await backend.createProject(name, rooms.length === 1 ? [rooms[0].id] : [], []);
        projects.unshift(p);
        showProject(p);
        ui.setStatus(`Progetto "${name}" creato${p.roomIds.length ? '' : ': aggiungi le sue stanze'}`);
      }),
    onRenameProject: () =>
      run(async () => {
        if (!project) return;
        const name = prompt('Nome del progetto', project.name)?.trim();
        if (!name || name === project.name) return;
        await backend.saveProject(project.id, { name });
        project.name = name;
        refreshLists();
      }),
    onDeleteProject: () =>
      run(async () => {
        if (!project || !confirm(`Eliminare il progetto "${project.name}"?`)) return;
        await backend.deleteProject(project.id);
        projects = projects.filter((p) => p !== project);
        showProject(null);
      }),
    onProjectRoom(id) {
      showRoom(rooms.find((r) => r.id === id) ?? null);
    },
    onAddRoom(id) {
      const r = rooms.find((x) => x.id === id);
      if (!project || !r) return;
      project.roomIds.push(id);
      markDirty();
      showRoom(r);
    },
    onRemoveRoom() {
      if (!project || !room || !confirm(`Togliere la stanza "${room.name}" dal progetto? Anche i suoi modelli vengono tolti.`)) return;
      const id = room.id;
      project.roomIds = project.roomIds.filter((x) => x !== id);
      project.models = project.models.filter((m) => m.roomId !== id);
      markDirty();
      showRoom(projectRoomsList()[0] ?? null);
    },
    onShell(visible) {
      shellVisible = visible;
      if (shell) shell.visible = visible;
    },
    async onUpload(file) {
      if (!room || !project) return ui.setStatus('Scegli un progetto e una sua stanza prima di caricare un modello');
      ui.setStatus(`Carico ${file.name}...`);
      try {
        const { path, name } = await upload(file);
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        project.models.push({ id, roomId: room.id, name, path, pos: floorCentre(room.scan.planes), yaw: 0, scale: 1 });
        layer.sync(models());
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
      layer.sync(models());
      select(null);
      markDirty();
    },
    async onSave() {
      if (!project) return;
      ui.setStatus('Salvo...');
      try {
        await backend.saveProject(project.id, { models: project.models, roomIds: project.roomIds });
        markDirty(false);
        ui.setStatus(`Progetto "${project.name}" salvato`);
      } catch (e) {
        ui.setStatus(`Salvataggio FALLITO: ${errText(e)}`);
      }
    },
    onRenameRoom: (id) =>
      run(async () => {
        const r = rooms.find((x) => x.id === id);
        const name = r && prompt('Nome della stanza', r.name)?.trim();
        if (!r || !name || name === r.name) return;
        await backend.renameRoom(id, name);
        r.name = name;
        refreshLists();
        if (room === r) showRoom(r);
      }),
    onDeleteRoom: (id) =>
      run(async () => {
        const r = rooms.find((x) => x.id === id);
        const users = projects.filter((p) => p.roomIds.includes(id));
        const note = users.length ? ` Sarà tolta anche dai progetti: ${users.map((p) => p.name).join(', ')} (con i suoi modelli).` : '';
        if (!r || !confirm(`Eliminare la stanza "${r.name}"?${note}`)) return;
        await backend.deleteRoom(id);
        rooms = rooms.filter((x) => x !== r);
        for (const p of users) {
          p.roomIds = p.roomIds.filter((x) => x !== id);
          p.models = p.models.filter((m) => m.roomId !== id);
          await backend.saveProject(p.id, { roomIds: p.roomIds, models: p.models });
        }
        showRoom(room === r ? (projectRoomsList()[0] ?? null) : room);
        ui.setStatus('Stanza eliminata.');
      }),
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

  ui.setStatus('Carico i progetti...');
  try {
    if (!(await backend.email())) return ui.setStatus('Accedi (in alto a destra) con lo stesso account del visore.');
    [rooms, projects] = await Promise.all([backend.listRooms(), backend.listProjects()]);
  } catch (e) {
    return ui.setStatus(`Caricamento FALLITO: ${errText(e)}`);
  }
  refreshLists();
  ui.setStatus(
    !rooms.length
      ? 'Nessuna stanza salvata: scansionala e salvala dal visore (tab Scan).'
      : projects.length
        ? 'Scegli il progetto da aprire, o creane uno con "Nuovo".'
        : 'Nessun progetto: creane uno con "Nuovo".',
  );
  if (projects.length === 1) showProject(projects[0]);
  return { select };
}
