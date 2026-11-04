import {
  Box3,
  BoxGeometry,
  Camera,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Plane,
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
import { createStructureLayer, placeStructure } from '../room/structures';
import type { Project, Room, Structure } from '../room/types';
import { createStage } from '../scene/stage';
import { createLogin } from '../ui/login';
import { createEditorUi, type BuildKind, type Tool } from './editorUi';

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
  const structuresGroup = new Group();
  scene.add(structuresGroup);
  const structLayer = createStructureLayer(structuresGroup);
  let tool: Tool = 'translate';
  let buildKind: BuildKind = 'wall';
  let selectedStructure: string | null = null;
  let drag: { start: Vector3; mesh: Mesh } | null = null;
  const WALL_HEIGHT = 2.5;
  const WALL_THICKNESS = 0.1;
  const FLOOR_THICKNESS = 0.05;
  const layer = createModelLayer(modelsGroup, (t) => ui.setStatus(`Errore modello: ${t}`));

  const transform = new TransformControls(camera, renderer.domElement);
  scene.add(transform.getHelper());
  transform.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    lastDrag = Date.now();
  });

  const projectRoomsList = () => (project?.roomIds ?? []).map((id) => rooms.find((r) => r.id === id)).filter((r): r is Room => !!r);
  const models = () => project?.models.filter((m) => m.roomId === room?.id) ?? [];
  const structures = () => project?.structures.filter((s) => s.roomId === room?.id) ?? [];
  const floorY = () => (room ? floorCentre(room.scan.planes)[1] : 0);
  const findStructure = (id: string | null) => structures().find((s) => s.id === id) ?? null;
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
    ui.setSelection({ scale: m.scale, yawDeg: (m.yaw * 180) / Math.PI, size: dim ? [dim.x, dim.y, dim.z] : null });
  }

  function refreshStructure() {
    const s = findStructure(selectedStructure);
    structLayer.sync(structures());
    for (const [id, m] of structLayer.meshes) (m.material as MeshBasicMaterial & { emissive?: { set(c: number): void } }).emissive?.set(id === selectedStructure ? 0x0a6b5f : 0x000000);
    if (!s) return ui.setStructure(null);
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    ui.setStructure({ kind: s.kind, height: s.height, length: s.kind === 'wall' ? len : Math.abs((s.b[0] - s.a[0]) * (s.b[1] - s.a[1])) });
  }

  function selectStructure(id: string | null) {
    selectedStructure = id;
    if (id) select(null);
    refreshStructure();
  }

  function select(id: string | null) {
    if (id && selectedStructure) {
      selectedStructure = null;
      refreshStructure();
    }
    selectedId = id;
    const holder = id ? layer.holders.get(id) : null;
    if (holder && (tool === 'translate' || tool === 'rotate')) transform.attach(holder);
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
    // Beyond +-90 degrees the Euler angles of a turn about Y come out as (180, 90 - a, 180): `rotation.y` alone is then a
    // different heading. Take the heading from the quaternion and keep the holder a pure yaw, as the headset draws it.
    const q = holder.quaternion;
    m.yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    holder.rotation.set(0, m.yaw, 0);
    markDirty();
  });

  transform.addEventListener('mouseUp', refresh);

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
    selectedStructure = null;
    refreshStructure();
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

  async function save() {
    if (!project) return;
    ui.setStatus('Salvo...');
    try {
      await backend.saveProject(project.id, { models: project.models, roomIds: project.roomIds, structures: project.structures });
      markDirty(false);
      ui.setStatus(`Progetto "${project.name}" salvato`);
    } catch (e) {
      ui.setStatus(`Salvataggio FALLITO: ${errText(e)}`);
    }
  }

  function setTool(next: Tool) {
    tool = next;
    // The gizmo only in Move / Rotate; yaw only makes sense for a model standing on the floor.
    if (tool === 'translate' || tool === 'rotate') {
      transform.setMode(tool);
      transform.showX = tool === 'translate';
      transform.showZ = tool === 'translate';
    }
    select(selectedId);
    if (tool !== 'translate' && tool !== 'rotate') transform.detach();
    ui.setTool(tool, buildKind);
    if (tool === 'build') {
      select(null);
      selectStructure(null);
    }
  }

  function deleteModel() {
    if (!project || !selectedId) return;
    project.models = project.models.filter((m) => m.id !== selectedId);
    layer.sync(models());
    select(null);
    markDirty();
  }

  function deleteStructure() {
    if (!project || !selectedStructure) return;
    project.structures = project.structures.filter((x) => x.id !== selectedStructure);
    selectStructure(null);
    markDirty();
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
      project.structures = project.structures.filter((x) => x.roomId !== id);
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
    onTool: setTool,
    onBuildKind(kind) {
      buildKind = kind;
      ui.setTool(tool, buildKind);
    },
    onStructureHeight(value) {
      const st = findStructure(selectedStructure);
      if (!st || st.kind !== 'wall') return;
      st.height = value;
      markDirty();
      refreshStructure();
    },
    onDeleteStructure: deleteStructure,
    onScale(value) {
      const m = find(selectedId);
      if (!m) return;
      m.scale = value;
      layer.sync(models());
      markDirty();
      refresh();
    },
    onDeleteModel: deleteModel,
    onSave: save,
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
          p.structures = p.structures.filter((x) => x.roomId !== id);
          await backend.saveProject(p.id, { roomIds: p.roomIds, models: p.models, structures: p.structures });
        }
        showRoom(room === r ? (projectRoomsList()[0] ?? null) : room);
        ui.setStatus('Stanza eliminata.');
      }),
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  // 3D view: click selects a model or a wall / floor; in Build mode a drag on the floor creates one.
  const ray = new Raycaster();
  let down: { x: number; y: number } | null = null;
  const ndcOf = (e: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    return new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  };
  // Point of the room's floor plane under the mouse, snapped to 5 cm.
  const floorPoint = (e: PointerEvent) => {
    ray.setFromCamera(ndcOf(e), camera);
    const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -floorY()), new Vector3());
    return hit ? hit.set(Math.round(hit.x * 20) / 20, floorY(), Math.round(hit.z * 20) / 20) : null;
  };
  const draftOf = (a: Vector3, b: Vector3, shift: boolean): Pick<Structure, 'kind' | 'a' | 'b' | 'y' | 'height' | 'thickness'> => {
    let bx = b.x;
    let bz = b.z;
    // Shift keeps a wall straight along the axis it is mostly dragged on.
    if (shift && buildKind === 'wall') Math.abs(bx - a.x) >= Math.abs(bz - a.z) ? (bz = a.z) : (bx = a.x);
    return {
      kind: buildKind,
      a: [a.x, a.z],
      b: [bx, bz],
      y: floorY(),
      height: WALL_HEIGHT,
      thickness: buildKind === 'wall' ? WALL_THICKNESS : FLOOR_THICKNESS,
    };
  };
  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    if (tool !== 'build' || !room || e.button !== 0) return;
    const start = floorPoint(e);
    if (!start) return;
    controls.enabled = false; // the drag draws, it does not orbit
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.55 }));
    mesh.visible = false;
    structuresGroup.add(mesh);
    drag = { start, mesh };
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = floorPoint(e);
    if (!p) return;
    const d = draftOf(drag.start, p, e.shiftKey);
    placeStructure(drag.mesh, d);
    drag.mesh.visible = true;
    const len = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
    ui.setStatus(buildKind === 'wall' ? `Parete: ${len.toFixed(2)} m` : `Pavimento: ${Math.abs(d.b[0] - d.a[0]).toFixed(2)} × ${Math.abs(d.b[1] - d.a[1]).toFixed(2)} m`);
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (drag) {
      const { start, mesh } = drag;
      drag = null;
      controls.enabled = true;
      structuresGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      const p = floorPoint(e);
      if (p && project && room) {
        const d = draftOf(start, p, e.shiftKey);
        const big = buildKind === 'wall' ? Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) >= 0.1 : Math.abs(d.b[0] - d.a[0]) >= 0.1 && Math.abs(d.b[1] - d.a[1]) >= 0.1;
        if (big) {
          const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          project.structures.push({ id, roomId: room.id, ...d });
          selectStructure(id);
          markDirty();
          ui.setStatus(`${buildKind === 'wall' ? 'Parete' : 'Pavimento'} creato. Ricorda di salvare.`);
        } else ui.setStatus('Troppo piccolo: trascina più a lungo.');
      }
      return;
    }
    if (tool === 'build') return;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    if (Date.now() - lastDrag < 300 || transform.axis) return;
    ray.setFromCamera(ndcOf(e), camera);
    const hit = ray.intersectObjects([...layer.holders.values()], true)[0];
    let o: Object3D | null = hit?.object ?? null;
    while (o && !o.userData.modelId) o = o.parent;
    if (o) return select(o.userData.modelId as string);
    const sHit = ray.intersectObjects([...structLayer.meshes.values()], false)[0];
    select(null);
    selectStructure(sHit ? (sHit.object.userData.structureId as string) : null);
  });

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedStructure) deleteStructure();
      else if (selectedId) deleteModel();
    } else if (e.key === 'Escape') {
      select(null);
      selectStructure(null);
      if (tool === 'build') setTool('select');
    } else if (!e.ctrlKey && !e.metaKey) {
      const map: Record<string, Tool> = { q: 'select', w: 'translate', e: 'rotate', b: 'build' };
      const next = map[e.key.toLowerCase()];
      if (next && room) setTool(next);
    }
  });
  setInterval(() => selectedId && refresh(), 1000); // late-loading models change the size readout

  ui.setTool(tool, buildKind);
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
