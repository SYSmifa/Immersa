import {
  Box3,
  BoxGeometry,
  Camera,
  Color,
  GridHelper,
  Group,
  HalfFloatType,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MOUSE,
  Object3D,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Backend } from '../cloud/backend';
import { uploadModel } from '../cloud/models';
import { createSupabaseBackend } from '../cloud/repo';
import { drawBoxes, drawPlanes } from '../room/draw';
import { floorCentre } from '../room/floor';
import { createModelLayer } from '../room/modelLayer';
import { nodeByPath, partFromMesh, partName, pivotWorld } from '../room/parts';
import { listMaterials } from '../room/selection';
import { createStructureLayer, placeStructure } from '../room/structures';
import type { PartEdit, Project, Room, RoomModel, Structure } from '../room/types';
import { createStage } from '../scene/stage';
import { SelectionOutlinePass } from './outline';
import { createLogin } from '../ui/login';
import { createEditorUi, type BuildKind, type Details, type Gizmo, type LookEdit, type StructureEdit } from './editorUi';

interface Deps {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  controls: OrbitControls;
  backend: Backend;
  upload?: (file: File) => Promise<{ path: string; name: string }>;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dateOf = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const WALL_HEIGHT = 2.5;
const WALL_THICKNESS = 0.1;
const FLOOR_THICKNESS = 0.05;
const GRID_STEP = 0.05;
const VERTEX_RANGE = 0.2; // m: how close a point must be to a vertex of another wall / floor to jump onto it
const ORTHO_FOV = 1; // "orthographic" = a tiny field of view from far away: picking, orbit and gizmo keep working unchanged
const orthoK = (fov: number) => Math.tan(MathUtils.degToRad(fov / 2)) / Math.tan(MathUtils.degToRad(ORTHO_FOV / 2));

// A softer, more modern gizmo: Aura palette (coral / teal / blue), slimmer, translucent planes.
function restyleGizmo(t: TransformControls) {
  const axis = { X: 0xf2545b, Y: 0x2dd4bf, Z: 0x4c8dff } as Record<string, number>;
  const plane = { XY: axis.Z, YZ: axis.X, XZ: axis.Y } as Record<string, number>;
  t.size = 0.8;
  t.getHelper().traverse((o) => {
    const m = (o as Mesh).material as (MeshBasicMaterial & { _color?: Color; _opacity?: number }) | undefined;
    if (!m || !m.color) return;
    if (o.name === 'AXIS') m.visible = false; // the endless line along the dragged axis only confuses
    const hex = axis[o.name] ?? plane[o.name] ?? (o.name === 'XYZ' || o.name === 'E' || o.name === 'XYZE' ? 0xe8edf5 : null);
    if (hex === null) return;
    m.color.set(hex);
    m._color = m.color.clone();
    m.opacity = plane[o.name] ? 0.35 : o.name === 'E' || o.name === 'XYZE' ? 0.5 : 0.95;
    m._opacity = m.opacity;
    m.transparent = true;
  });
}

// Entry for the PC: stage without AR, then the editor (the login box lives in its sidebar).
export function createEditorPage(backend: Backend = createSupabaseBackend(), upload?: Deps['upload']) {
  const { renderer, scene, camera, controls } = createStage({ arButton: false });
  return createEditor({ renderer, scene, camera, controls, backend, upload });
}

// PC editor: open or create a project, add the rooms it covers (named scans from the headset), then for each room add
// .glb models, build floors and walls, and move / rotate / scale everything in real size.
export async function createEditor({ renderer, scene, camera, controls, backend, upload = uploadModel }: Deps) {
  const persp = camera as PerspectiveCamera;
  let rooms: Room[] = [];
  let projects: Project[] = [];
  let project: Project | null = null;
  let room: Room | null = null; // the room of the project being edited
  let sel: string[] = []; // selected keys: 'm:<model id>' / 's:<structure id>'
  let dirty = false;
  let lastDrag = 0;
  // toolbar state
  let build: BuildKind | null = null;
  let gizmo: Gizmo = 'translate';
  let ortho = false;
  let snapGrid = true;
  let snapVertex = true;
  let local = false;
  let partSel: { modelId: string; path: string } | null = null; // a component of a model is chosen (double click)
  let keepBuild = false; // a Shift-held series of walls / floors is going on

  const planesGroup = new Group();
  const gridGroup = new Group(); // the floor grid stays when a room's scan is hidden
  const hiddenRooms = new Set<string>(); // rooms whose scan is hidden (eye in the sidebar)
  const modelsGroup = new Group();
  const structuresGroup = new Group();
  scene.add(planesGroup, gridGroup, modelsGroup, structuresGroup);
  const layer = createModelLayer(modelsGroup, (t) => ui.setStatus(`Errore modello: ${t}`));
  const structLayer = createStructureLayer(structuresGroup);

  scene.background = new Color(0x15171c); // through the composer the clear colour would be encoded twice

  // Selection outline: a screen-space azure edge round the selected objects.
  // The composer renders off-screen, where the canvas' own antialiasing does not apply: give it 4x MSAA targets, and finish
  // with SMAA so the outline (a screen-space edge) is smooth too.
  const pr = renderer.getPixelRatio();
  const composer = new EffectComposer(
    renderer,
    new WebGLRenderTarget(window.innerWidth * pr, window.innerHeight * pr, { type: HalfFloatType, samples: 4 }),
  );
  composer.addPass(new RenderPass(scene, camera));
  const outlinePass = new SelectionOutlinePass(scene, camera);
  composer.addPass(outlinePass);
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass());
  window.addEventListener('resize', () => composer.setSize(window.innerWidth, window.innerHeight));
  renderer.setAnimationLoop(() => {
    if (ortho) {
      const d = camera.position.distanceTo(controls.target);
      persp.near = Math.max(0.05, d * 0.4);
      persp.far = d * 2.5;
      persp.updateProjectionMatrix();
    }
    updateFade();
    composer.render();
  });

  // The gizmo drives an invisible pivot (centre of the selection); the selected objects follow it.
  const pivot = new Object3D();
  scene.add(pivot);
  const transform = new TransformControls(camera, renderer.domElement);
  scene.add(transform.getHelper());
  outlinePass.ignore = [transform.getHelper()];
  restyleGizmo(transform);
  transform.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    lastDrag = Date.now();
    if (e.value) startDrag();
    else {
      start = null;
      partStart = null;
      refreshPivot();
      commit();
      refreshAll();
    }
  });

  const projectRoomsList = () => (project?.roomIds ?? []).map((id) => rooms.find((r) => r.id === id)).filter((r): r is Room => !!r);
  // A project without rooms has a free space (roomId ''): the grid at the world origin, models placed anywhere in it.
  const spaceId = () => room?.id ?? '';
  const models = () => project?.models.filter((m) => m.roomId === spaceId()) ?? [];
  const structures = () => project?.structures.filter((s) => s.roomId === spaceId()) ?? [];
  const findModel = (id: string) => models().find((m) => m.id === id) ?? null;
  const findStructure = (id: string) => structures().find((s) => s.id === id) ?? null;
  const floorY = () => (room ? floorCentre(room.scan.planes)[1] : 0);
  const selModels = () => sel.filter((k) => k[0] === 'm').map((k) => findModel(k.slice(2))).filter((m): m is RoomModel => !!m);
  const selStructs = () => sel.filter((k) => k[0] === 's').map((k) => findStructure(k.slice(2))).filter((s): s is Structure => !!s);
  const objectOf = (key: string): Object3D | null => (key[0] === 'm' ? layer.holders.get(key.slice(2)) : structLayer.meshes.get(key.slice(2))) ?? null;
  const wallYaw = (s: Structure) => -Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
  // The pivot of a wall / floor is its first point: that is what snaps onto the grid and onto other vertices.
  const anchorOf = (s: Structure): [number, number] => [s.a[0], s.a[1]];

  // ---- history (undo / redo): snapshots of the project's models and structures ----
  let hist: string[] = [];
  let hi = -1;
  const snapshot = () => JSON.stringify({ m: project?.models ?? [], s: project?.structures ?? [] });
  function resetHistory() {
    hist = project ? [snapshot()] : [];
    hi = hist.length - 1;
    refreshToolbar();
  }
  function commit() {
    if (!project) return;
    const s = snapshot();
    if (s === hist[hi]) return;
    hist = hist.slice(0, hi + 1);
    hist.push(s);
    if (hist.length > 100) hist.shift();
    hi = hist.length - 1;
    refreshToolbar();
  }
  function jump(i: number) {
    if (!project || i < 0 || i >= hist.length) return;
    hi = i;
    const d = JSON.parse(hist[hi]) as { m: RoomModel[]; s: Structure[] };
    project.models = d.m;
    project.structures = d.s;
    layer.sync(models());
    structLayer.sync(structures());
    sel = sel.filter((k) => (k[0] === 'm' ? findModel(k.slice(2)) : findStructure(k.slice(2))));
    if (partSel && !findModel(partSel.modelId)) partSel = null;
    markDirty();
    setSelection(sel);
  }

  function markDirty(on = true) {
    dirty = on;
    ui.setDirty(on);
  }
  // A change made by the user: redraw and remember it (doCommit = false while a slider / field is still being edited).
  function changed(doCommit: boolean) {
    layer.sync(models());
    structLayer.sync(structures());
    markDirty();
    if (doCommit) commit();
    refreshAll();
  }

  // ---- selection, pivot and gizmo ----
  const effectiveGizmo = (): Gizmo => (gizmo === 'scale' && !partSel && !(selModels().length === 1 && sel.length === 1) ? 'translate' : gizmo);

  // ---- a chosen component of a model ----
  const partModel = () => (partSel ? findModel(partSel.modelId) : null);
  const partHolder = () => (partSel ? (layer.holders.get(partSel.modelId) ?? null) : null);
  const partNode = () => {
    const h = partHolder();
    return h && partSel ? nodeByPath(h, partSel.path) : null;
  };
  const partEdit = (create = false): PartEdit | undefined => {
    const m = partModel();
    if (!m || !partSel) return undefined;
    if (create) {
      m.parts ??= {};
      return (m.parts[partSel.path] ??= {});
    }
    return m.parts?.[partSel.path];
  };
  function setPart(modelId: string | null, path: string | null) {
    partSel = modelId && path ? { modelId, path } : null;
    if (partSel) sel = [`m:${modelId}`];
    if (partSel && !build) {
      refreshPivot();
      transform.attach(pivot);
    } else if (!sel.length || build) transform.detach();
    else {
      refreshPivot();
      transform.attach(pivot);
    }
    applyGizmo();
    refreshAll();
  }

  function refreshPivot() {
    const node = partNode();
    const holder = partHolder();
    const pm = partModel();
    if (node && holder && pm) {
      const e = partEdit();
      pivot.position.copy(pivotWorld(holder, node, e));
      pivot.rotation.set(0, local ? pm.yaw + (e?.yaw ?? 0) : 0, 0); // "relative": along the component's own heading
      pivot.scale.setScalar(1);
      pivot.updateMatrixWorld(true);
      return;
    }
    const ms = selModels();
    const ss = selStructs();
    const n = ms.length + ss.length;
    if (!n) return;
    const c = new Vector3();
    for (const m of ms) c.add(new Vector3(...m.pos));
    for (const s of ss) c.add(new Vector3(anchorOf(s)[0], s.y, anchorOf(s)[1]));
    c.divideScalar(n);
    pivot.position.copy(c);
    // "Relative" pivot: the gizmo follows the heading of a single object; with more it stays on the world axes.
    const yaw = local && n === 1 ? (ms[0] ? ms[0].yaw : ss[0].kind === 'wall' ? wallYaw(ss[0]) : 0) : 0;
    pivot.rotation.set(0, yaw, 0);
    pivot.scale.setScalar(1);
    pivot.updateMatrixWorld(true);
  }

  function applyGizmo() {
    const mode = effectiveGizmo();
    transform.setMode(mode);
    transform.showX = mode !== 'rotate'; // only yaw makes sense for things standing on the floor
    transform.showZ = mode !== 'rotate';
    transform.setSpace(local && mode !== 'scale' ? 'local' : 'world');
    transform.setTranslationSnap(null); // done by hand in objectChange: the pivot lands exactly on a grid point
    transform.setRotationSnap(snapGrid ? MathUtils.degToRad(15) : null);
    transform.setScaleSnap(snapGrid ? GRID_STEP : null);
  }

  function setSelection(keys: string[]) {
    sel = keys;
    partSel = null;
    if (keys.length && !build) {
      refreshPivot();
      transform.attach(pivot);
    } else transform.detach();
    applyGizmo();
    refreshAll();
  }

  function pick(key: string | null, additive: boolean) {
    if (!key) return additive ? undefined : setSelection([]);
    if (!additive) return setSelection([key]);
    setSelection(sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key]);
  }

  // ---- drag of the gizmo: apply the pivot's movement to every selected object ----
  interface Start {
    c: Vector3;
    q: Quaternion;
    models: Map<string, { pos: [number, number, number]; yaw: number; scale: number }>;
    structs: Map<string, { a: [number, number]; b: [number, number]; y: number }>;
  }
  let start: Start | null = null;
  let partStart: { c: Vector3; q: Quaternion; d: [number, number, number]; yaw: number; scale: number } | null = null;
  function startDrag() {
    if (partSel) {
      const e = partEdit();
      partStart = { c: pivot.position.clone(), q: pivot.quaternion.clone(), d: [...(e?.d ?? [0, 0, 0])] as [number, number, number], yaw: e?.yaw ?? 0, scale: e?.scale ?? 1 };
      start = { c: pivot.position.clone(), q: pivot.quaternion.clone(), models: new Map(), structs: new Map() };
      return;
    }
    start = {
      c: pivot.position.clone(),
      q: pivot.quaternion.clone(),
      models: new Map(selModels().map((m) => [m.id, { pos: [...m.pos] as [number, number, number], yaw: m.yaw, scale: m.scale }])),
      structs: new Map(selStructs().map((s) => [s.id, { a: [...s.a] as [number, number], b: [...s.b] as [number, number], y: s.y }])),
    };
  }

  // Vertices (wall ends, floor corners) of the structures that are not being moved.
  function snapToVertex(x: number, z: number, exclude: Set<string>): [number, number] | null {
    let best: [number, number] | null = null;
    let bd = VERTEX_RANGE;
    for (const s of structures()) {
      if (exclude.has(s.id)) continue;
      const pts: [number, number][] = [s.a, s.b];
      if (s.kind === 'floor') pts.push([s.a[0], s.b[1]], [s.b[0], s.a[1]]);
      for (const p of pts) {
        const d = Math.hypot(p[0] - x, p[1] - z);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
    }
    return best;
  }

  transform.addEventListener('objectChange', () => {
    if (!start) return;
    const mode = effectiveGizmo();
    if (partSel && partStart) {
      // A component: the pivot's move, in the model's own frame at scale 1.
      if (snapGrid && mode === 'translate') {
        pivot.position.x = Math.round(pivot.position.x / GRID_STEP) * GRID_STEP;
        pivot.position.z = Math.round(pivot.position.z / GRID_STEP) * GRID_STEP;
      }
      const pm = partModel();
      const e = partEdit(true);
      if (!pm || !e) return;
      const dp = pivot.position.clone().sub(partStart.c);
      const cs = Math.cos(pm.yaw);
      const sn = Math.sin(pm.yaw);
      // world -> model frame: undo the model's turn about Y and its scale
      e.d = [partStart.d[0] + (dp.x * cs - dp.z * sn) / pm.scale, partStart.d[1] + dp.y / pm.scale, partStart.d[2] + (dp.x * sn + dp.z * cs) / pm.scale];
      if (mode === 'rotate') {
        const dq = pivot.quaternion.clone().multiply(partStart.q.clone().invert());
        e.yaw = partStart.yaw + 2 * Math.atan2(dq.y, dq.w);
      }
      if (mode === 'scale') {
        e.scale = Math.max(0.05, partStart.scale * Math.max(0.001, [pivot.scale.x, pivot.scale.y, pivot.scale.z].reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1)));
      }
      layer.sync(models());
      markDirty();
      ui.setDetails(detailsInfo());
      return;
    }
    if (snapGrid && mode === 'translate') {
      pivot.position.x = Math.round(pivot.position.x / GRID_STEP) * GRID_STEP;
      pivot.position.z = Math.round(pivot.position.z / GRID_STEP) * GRID_STEP;
      pivot.position.y = Math.round(pivot.position.y / GRID_STEP) * GRID_STEP;
    }
    // Vertex snap while moving: the closest end of a moved wall / floor (or a model's centre) jumps onto a vertex.
    if (snapVertex && mode === 'translate') {
      const ids = new Set(selStructs().map((s) => s.id));
      const dx0 = pivot.position.x - start.c.x;
      const dz0 = pivot.position.z - start.c.z;
      let best: { dx: number; dz: number; d: number } | null = null;
      const probe = (x: number, z: number) => {
        const v = snapToVertex(x + dx0, z + dz0, ids);
        if (!v) return;
        const d = Math.hypot(v[0] - (x + dx0), v[1] - (z + dz0));
        if (!best || d < best.d) best = { dx: v[0] - (x + dx0), dz: v[1] - (z + dz0), d };
      };
      for (const s of start.structs.values()) {
        probe(...s.a);
        probe(...s.b);
      }
      for (const m of start.models.values()) probe(m.pos[0], m.pos[2]);
      if (best) {
        const b = best as { dx: number; dz: number };
        pivot.position.x += b.dx;
        pivot.position.z += b.dz;
      }
    }
    const dp = pivot.position.clone().sub(start.c);
    const dq = pivot.quaternion.clone().multiply(start.q.clone().invert());
    const dyaw = mode === 'rotate' ? 2 * Math.atan2(dq.y, dq.w) : 0;
    let factor = 1;
    if (mode === 'scale') {
      // The component that moved the most (the uniform handle moves all three).
      factor = Math.max(0.001, [pivot.scale.x, pivot.scale.y, pivot.scale.z].reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1));
    }
    const cs = Math.cos(dyaw);
    const sn = Math.sin(dyaw);
    const c = start.c;
    const rot = (x: number, z: number): [number, number] => [c.x + (x - c.x) * cs + (z - c.z) * sn + dp.x, c.z - (x - c.x) * sn + (z - c.z) * cs + dp.z];
    for (const m of selModels()) {
      const s0 = start.models.get(m.id);
      if (!s0) continue;
      const [x, z] = rot(s0.pos[0], s0.pos[2]);
      m.pos = [x, s0.pos[1] + dp.y, z];
      m.yaw = Math.atan2(Math.sin(s0.yaw + dyaw), Math.cos(s0.yaw + dyaw));
      m.scale = s0.scale * factor;
    }
    for (const s of selStructs()) {
      const s0 = start.structs.get(s.id);
      if (!s0) continue;
      s.a = rot(...s0.a);
      s.b = rot(...s0.b);
      s.y = s0.y + dp.y;
    }
    layer.sync(models());
    structLayer.sync(structures());
    markDirty();
    ui.setDetails(detailsInfo());
  });

  // ---- sidebar / outline / details data ----
  const confirmLeave = () => !dirty || confirm('Ci sono modifiche non salvate al progetto. Continuare senza salvare?');

  function refreshToolbar() {
    ui.setToolbar({ build, gizmo, ortho, grid: snapGrid, vertex: snapVertex, local, canUndo: hi > 0, canRedo: hi < hist.length - 1 });
  }

  function refreshLists() {
    ui.setProjects(projects.map((p) => ({ id: p.id, name: p.name })), project?.id ?? null);
    ui.setRooms(rooms.map((r) => ({ id: r.id, name: r.name, sub: `Creata il ${dateOf(r.createdAt)}` })));
    ui.setProject(
      project?.name ?? '',
      projectRoomsList().map((r) => ({ id: r.id, name: r.name, hidden: hiddenRooms.has(r.id) })),
      room?.id ?? null,
      rooms.filter((r) => !project?.roomIds.includes(r.id)).map((r) => ({ id: r.id, name: r.name })),
    );
    ui.setState(!!project, !!room);
  }

  function refreshOutline() {
    const walls = structures().filter((s) => s.kind === 'wall');
    const floors = structures().filter((s) => s.kind === 'floor');
    ui.setOutline(
      [
        ...models().map((m) => ({ key: `m:${m.id}`, name: m.name, kind: 'model' as const })),
        ...walls.map((s, i) => ({ key: `s:${s.id}`, name: `Parete ${i + 1}`, kind: 'wall' as const })),
        ...floors.map((s, i) => ({ key: `s:${s.id}`, name: `Pavimento ${i + 1}`, kind: 'floor' as const })),
      ],
      new Set(sel),
    );
  }

  // Size along the model's own axes: measure with yaw 0, matrices fresh.
  function modelSize(holder: Object3D): [number, number, number] | null {
    const yaw = holder.rotation.y;
    holder.rotation.y = 0;
    holder.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(holder);
    holder.rotation.y = yaw;
    holder.updateWorldMatrix(true, true);
    if (box.isEmpty()) return null;
    const d = box.getSize(new Vector3());
    return [d.x, d.y, d.z];
  }

  function detailsInfo(): Details | null {
    const pn = partNode();
    const pm = partModel();
    if (pn && pm && partSel) {
      const e = partEdit();
      const info = listMaterials(pn)[0];
      return {
        kind: 'part',
        key: `p:${pm.id}:${partSel.path}`,
        name: partName(pn),
        model: pm.name,
        scale: e?.scale ?? 1,
        yawDeg: ((e?.yaw ?? 0) * 180) / Math.PI,
        color: e?.color ?? pm.color ?? info?.color ?? '#ffffff',
        tinted: !!e?.color,
        finish: { roughness: e?.finish?.roughness ?? pm.finish?.roughness ?? info?.roughness ?? 0.5, metalness: e?.finish?.metalness ?? pm.finish?.metalness ?? info?.metalness ?? 0 },
        moved: !!(e?.d || e?.yaw || (e?.scale && e.scale !== 1)),
      };
    }
    if (sel.length === 0) return null;
    if (sel.length > 1) return { kind: 'multi', count: sel.length };
    const m = selModels()[0];
    if (m) {
      const holder = layer.holders.get(m.id);
      const materials = holder
        ? listMaterials(holder).map((info, i) => ({
            name: info.name,
            color: m.materialColors?.[i] ?? m.color ?? info.color,
            roughness: m.materialFinish?.[i]?.roughness ?? m.finish?.roughness ?? info.roughness,
            metalness: m.materialFinish?.[i]?.metalness ?? m.finish?.metalness ?? info.metalness,
          }))
        : [];
      return {
        kind: 'model',
        key: `m:${m.id}`,
        color: m.color ?? null,
        finish: { roughness: m.finish?.roughness ?? materials[0]?.roughness ?? 0.5, metalness: m.finish?.metalness ?? materials[0]?.metalness ?? 0 },
        scale: m.scale, yawDeg: (m.yaw * 180) / Math.PI, size: holder ? modelSize(holder) : null, materials };
    }
    const s = selStructs()[0];
    if (!s) return null;
    const dx = Math.abs(s.b[0] - s.a[0]);
    const dz = Math.abs(s.b[1] - s.a[1]);
    return {
      kind: 'structure',
      key: `s:${s.id}`,
      type: s.kind,
      height: s.height,
      thickness: s.thickness,
      color: s.color ?? null,
      texture: s.texture ?? null,
      measure: s.kind === 'wall' ? `Lunga ${Math.hypot(dx, dz).toFixed(2)} m` : `${dx.toFixed(2)} × ${dz.toFixed(2)} m · ${(dx * dz).toFixed(2)} m²`,
    };
  }

  function refreshAll() {
    refreshOutline();
    ui.setDetails(detailsInfo());
    const pn2 = partNode();
    outlinePass.selected = pn2 ? [pn2] : sel.map(objectOf).filter((o): o is Object3D => !!o);
    refreshToolbar();
  }

  // ---- camera: perspective <-> orthographic top view ----
  let perspective = { fov: 60, near: 0.05, far: 50 };
  function setOrtho(on: boolean) {
    if (on === ortho) return;
    const target = controls.target;
    if (on) {
      perspective = { fov: persp.fov, near: persp.near, far: persp.far };
      const d = camera.position.distanceTo(target) * orthoK(perspective.fov);
      persp.fov = ORTHO_FOV;
      camera.position.set(target.x, target.y + d, target.z + 0.01); // straight above: the plan
      controls.enableRotate = false;
      controls.mouseButtons.LEFT = MOUSE.PAN;
    } else {
      const d = camera.position.distanceTo(target) / orthoK(perspective.fov);
      persp.fov = perspective.fov;
      persp.near = perspective.near;
      persp.far = perspective.far;
      camera.position.set(target.x, target.y + d * 0.7, target.z + d * 0.7);
      controls.enableRotate = true;
      controls.mouseButtons.LEFT = MOUSE.ROTATE;
    }
    ortho = on;
    persp.updateProjectionMatrix();
    controls.update();
    refreshToolbar();
  }

  // The wall between the camera and the inside of the room fades out, so you can look into the room from any side.
  // Each shell plane gets its own materials (they are shared otherwise) and its normal + a point to tell the sides apart.
  interface Fade {
    obj: Object3D & { material: MeshBasicMaterial | MeshBasicMaterial[] };
    inward: Vector3; // the side of this plane that faces the inside of the room
    p: Vector3;
    base: number;
    a: number;
  }
  let fades: Fade[] = [];
  function prepareFade(shell: Group, centre: [number, number, number], planes: Room['scan']['planes']) {
    // The floor polygons (x, z) tell which side of a wall is the inside, also for odd shaped rooms where "towards the centre" is wrong.
    const floors: [number, number][][] = [];
    for (const f of planes) {
      if (f.label !== 'floor' || !f.poly || !f.quat) continue;
      const q = new Quaternion(...f.quat);
      const poly: [number, number][] = [];
      for (let i = 0; i < f.poly.length; i += 2) {
        const v = new Vector3(f.poly[i], 0, f.poly[i + 1]).applyQuaternion(q);
        poly.push([f.pos[0] + v.x, f.pos[2] + v.z]);
      }
      floors.push(poly);
    }
    const inside = (x: number, z: number) =>
      floors.some((poly) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, zi] = poly[i];
          const [xj, zj] = poly[j];
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
        }
        return c;
      });
    const mid = new Vector3(...centre);
    fades = [];
    for (const o of shell.children as (Object3D & { material?: MeshBasicMaterial })[]) {
      if (!o.material) continue;
      const q = new Quaternion();
      const p = new Vector3();
      o.matrix.decompose(p, q, new Vector3());
      const n = new Vector3(0, 1, 0).applyQuaternion(q);
      const h = new Vector3(n.x, 0, n.z);
      let inward = n.clone();
      if (h.length() > 0.3) {
        h.normalize();
        // Is there floor just in front of the plane, or just behind it?
        const hits = (sign: number) => [0.3, 0.6, 1].some((d) => inside(p.x + sign * h.x * d, p.z + sign * h.z * d));
        const front = hits(1);
        const back = hits(-1);
        if (front !== back) inward = h.multiplyScalar(front ? 1 : -1);
        else if (n.dot(mid.clone().sub(p)) < 0) inward.negate(); // no floor to tell: towards the room's centre
      } else if (n.dot(mid.clone().sub(p)) < 0) inward.negate();
      o.material = o.material.clone();
      o.material.transparent = true;
      fades.push({ obj: o as Fade['obj'], inward, p, base: o.material.opacity, a: 1 });
    }
  }
  function updateFade() {
    for (const f of fades) {
      const outside = f.inward.dot(camera.position.clone().sub(f.p)) < 0; // the camera is on the outer side of this plane
      f.a += ((outside ? 0 : 1) - f.a) * 0.2;
      (f.obj.material as MeshBasicMaterial).opacity = f.base * f.a;
      f.obj.visible = f.a > 0.02;
    }
  }

  // ---- rooms and projects ----
  function showRoom(r: Room | null) {
    room = r;
    planesGroup.clear();
    gridGroup.clear();
    setOrtho(false);
    build = null;
    layer.sync(models());
    structLayer.sync(structures());
    setSelection([]);
    refreshLists();
    if (!r) {
      if (!project) return ui.setStatus('Apri un progetto, o creane uno nuovo.');
      // No room: just the grid, and models can be loaded (they appear in front of you in the headset).
      gridGroup.add(new GridHelper(8, 16, 0x335566, 0x223344));
      controls.target.set(0, 0.5, 0);
      camera.position.set(0, 4, 5);
      controls.update();
      ui.setStatus('Progetto senza stanza: carica un modello, lo ritroverai davanti a te nel visore. Puoi aggiungere una stanza quando vuoi.');
      return;
    }
    planesGroup.visible = !hiddenRooms.has(r.id);
    const plan = drawPlanes(r.scan.planes, planesGroup, true, r.scan.boxes ?? [], false, 0, true);
    const volumes = drawBoxes(r.scan.boxes ?? [], planesGroup, true, 0, true);
    prepareFade(plan.shell, floorCentre(r.scan.planes), r.scan.planes);
    const spot = floorCentre(r.scan.planes);
    gridGroup.add(new GridHelper(8, 16, 0x335566, 0x223344).translateX(spot[0]).translateY(spot[1]).translateZ(spot[2]));
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
    resetHistory();
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

  function deleteSelection() {
    if (!project || !sel.length) return;
    const mk = new Set(selModels().map((m) => m.id));
    const sk = new Set(selStructs().map((s) => s.id));
    project.models = project.models.filter((m) => !mk.has(m.id));
    project.structures = project.structures.filter((s) => !sk.has(s.id));
    layer.sync(models());
    structLayer.sync(structures());
    setSelection([]);
    markDirty();
    commit();
  }

  // ---- the UI ----
  const ui = createEditorUi({
    onOpenProject(id) {
      if (!confirmLeave()) return;
      showProject(projects.find((p) => p.id === id) ?? null);
      ui.setView('project');
    },
    onCreateProject: (name, roomIds) =>
      run(async () => {
        if (!confirmLeave()) return;
        const p = await backend.createProject(name, roomIds, []);
        projects.unshift(p);
        showProject(p);
        ui.setView('project');
        ui.setStatus(`Progetto "${name}" creato${p.roomIds.length ? '' : ' senza stanza: carica un modello'}`);
      }),
    onCloseProject() {
      if (!confirmLeave()) return;
      showProject(null);
      ui.setView('home');
    },
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
        ui.setView('home');
      }),
    onProjectRoom(id) {
      showRoom(rooms.find((r) => r.id === id) ?? null);
      resetHistory();
    },
    onAddRoom(id) {
      const r = rooms.find((x) => x.id === id);
      if (!project || !r) return;
      project.roomIds.push(id);
      markDirty();
      showRoom(r);
      resetHistory();
    },
    onRemoveRoom() {
      if (!project || !room || !confirm(`Togliere la stanza "${room.name}" dal progetto? Anche i suoi modelli, pareti e pavimenti vengono tolti.`)) return;
      const id = room.id;
      project.roomIds = project.roomIds.filter((x) => x !== id);
      project.models = project.models.filter((m) => m.roomId !== id);
      project.structures = project.structures.filter((x) => x.roomId !== id);
      markDirty();
      showRoom(projectRoomsList()[0] ?? null);
      resetHistory();
    },
    onRoomVisible(id) {
      if (hiddenRooms.has(id)) hiddenRooms.delete(id);
      else hiddenRooms.add(id);
      if (room?.id === id) planesGroup.visible = !hiddenRooms.has(id);
      refreshLists();
    },
    async onUpload(file) {
      if (!project) return ui.setStatus('Apri o crea un progetto prima di caricare un modello');
      ui.setStatus(`Carico ${file.name}...`);
      try {
        const { path, name } = await upload(file);
        const id = newId();
        // In a room: its floor centre. Without one: in a row along x, so that several do not overlap.
        const free = models().length;
        project.models.push({ id, roomId: spaceId(), name, path, pos: room ? floorCentre(room.scan.planes) : [free * 1.2, 0, 0], yaw: 0, scale: 1 });
        layer.sync(models());
        setSelection([`m:${id}`]);
        markDirty();
        commit();
        ui.setStatus('Caricato. Ricorda di salvare.');
      } catch (e) {
        ui.setStatus(`Upload FALLITO: ${errText(e)}`);
      }
    },
    onRenameRoom: (id) =>
      run(async () => {
        const r = rooms.find((x) => x.id === id);
        const name = r && prompt('Nome della stanza', r.name)?.trim();
        if (!r || !name || name === r.name) return;
        if (rooms.some((x) => x.id !== id && x.name.trim().toLowerCase() === name.toLowerCase())) return ui.setStatus(`Esiste già una stanza chiamata "${name}": scegli un altro nome.`);
        await backend.renameRoom(id, name);
        r.name = name;
        refreshLists();
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
        if (room === r) showRoom(projectRoomsList()[0] ?? null);
        refreshLists();
        resetHistory();
        ui.setStatus('Stanza eliminata.');
      }),
    onSave: save,
    onBuild(kind) {
      build = kind;
      keepBuild = false;
      if (kind) {
        transform.detach();
        ui.setStatus(kind === 'wall' ? 'Parete: trascina sul pavimento' : 'Pavimento: trascina sul pavimento');
      } else setSelection(sel);
      refreshToolbar();
    },
    onGizmo(mode) {
      gizmo = mode;
      applyGizmo();
      refreshToolbar();
    },
    onOrtho: setOrtho,
    onSnapGrid(on) {
      snapGrid = on;
      applyGizmo();
      refreshToolbar();
    },
    onSnapVertex(on) {
      snapVertex = on;
      refreshToolbar();
    },
    onLocal(on) {
      local = on;
      refreshPivot();
      applyGizmo();
      refreshToolbar();
    },
    onUndo: () => jump(hi - 1),
    onRedo: () => jump(hi + 1),
    onPick: pick,
    onModelScale(value, doCommit) {
      const m = selModels()[0];
      if (!m || !(value > 0)) return;
      m.scale = value;
      refreshPivot();
      changed(doCommit);
    },
    onModelYaw(deg, doCommit) {
      const m = selModels()[0];
      if (!m) return;
      const r = (deg * Math.PI) / 180;
      m.yaw = Math.atan2(Math.sin(r), Math.cos(r));
      refreshPivot();
      changed(doCommit);
    },
    onModelLook(edit: LookEdit, doCommit) {
      const m = selModels()[0];
      if (!m) return;
      const finish = (prev: { roughness?: number; metalness?: number } | undefined) => ({
        ...prev,
        ...(edit.roughness !== undefined && { roughness: edit.roughness }),
        ...(edit.metalness !== undefined && { metalness: edit.metalness }),
      });
      const hasFinish = edit.roughness !== undefined || edit.metalness !== undefined;
      if (edit.reset) {
        delete m.color;
        delete m.materialColors;
        delete m.finish;
        delete m.materialFinish;
      } else if (edit.target === 'all') {
        if (edit.color !== undefined) {
          if (edit.color === null) delete m.color;
          else m.color = edit.color;
          delete m.materialColors;
        }
        if (hasFinish) {
          m.finish = finish(m.finish);
          delete m.materialFinish;
        }
      } else if (typeof edit.target === 'number') {
        const i = String(edit.target);
        if (edit.color !== undefined) {
          m.materialColors = { ...m.materialColors };
          if (edit.color === null) delete m.materialColors[i];
          else m.materialColors[i] = edit.color;
        }
        if (hasFinish) m.materialFinish = { ...m.materialFinish, [i]: finish(m.materialFinish?.[i]) };
      }
      changed(doCommit);
    },
    onStructure(edit: StructureEdit, doCommit) {
      for (const s of selStructs()) {
        if (edit.height !== undefined && edit.height > 0 && s.kind === 'wall') s.height = edit.height;
        if (edit.thickness !== undefined && edit.thickness > 0) s.thickness = edit.thickness;
        if (edit.color) s.color = edit.color;
        if (edit.texture !== undefined) {
          if (edit.texture === null) delete s.texture;
          else s.texture = edit.texture;
        }
      }
      changed(doCommit);
    },
    onDeleteSelection: deleteSelection,
    onPartScale(value, doCommit) {
      const e = partEdit(true);
      if (!e || !(value > 0)) return;
      e.scale = value;
      refreshPivot();
      changed(doCommit);
    },
    onPartYaw(deg, doCommit) {
      const e = partEdit(true);
      if (!e) return;
      const r = (deg * Math.PI) / 180;
      e.yaw = Math.atan2(Math.sin(r), Math.cos(r));
      refreshPivot();
      changed(doCommit);
    },
    onPartLook(edit, doCommit) {
      const e = partEdit(true);
      if (!e) return;
      if (edit.color !== undefined) {
        if (edit.color === null) delete e.color;
        else e.color = edit.color;
      }
      if (edit.roughness !== undefined || edit.metalness !== undefined) {
        e.finish = { ...e.finish, ...(edit.roughness !== undefined && { roughness: edit.roughness }), ...(edit.metalness !== undefined && { metalness: edit.metalness }) };
      }
      changed(doCommit);
    },
    onPartReset() {
      const m = partModel();
      const e = partEdit();
      if (!m?.parts || !e || !partSel) return;
      delete e.d;
      delete e.yaw;
      delete e.scale;
      if (!Object.keys(e).length) delete m.parts[partSel.path];
      if (!Object.keys(m.parts).length) delete m.parts;
      refreshPivot();
      changed(true);
      ui.setStatus('Componente riposizionato dov\'era.');
    },
    onPartExit: () => partSel && setPart(partSel.modelId, null),
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });
  void createLogin(ui.footer);

  // ---- 3D view: left click selects (Shift adds); with a Build button on, a drag on the floor draws ----
  const ray = new Raycaster();
  let down: { x: number; y: number } | null = null;
  let drag: { start: Vector3; mesh: Mesh } | null = null;
  const ndcOf = (e: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    return new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  };
  // Point of the room's floor plane under the mouse, snapped to the grid / to the vertices of other structures.
  const floorPoint = (e: PointerEvent) => {
    ray.setFromCamera(ndcOf(e), camera);
    const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -floorY()), new Vector3());
    if (!hit) return null;
    let x = snapGrid ? Math.round(hit.x / GRID_STEP) * GRID_STEP : hit.x;
    let z = snapGrid ? Math.round(hit.z / GRID_STEP) * GRID_STEP : hit.z;
    if (snapVertex) {
      const v = snapToVertex(hit.x, hit.z, new Set());
      if (v) [x, z] = v;
    }
    return new Vector3(x, floorY(), z);
  };
  const draftOf = (a: Vector3, b: Vector3, kind: BuildKind): Pick<Structure, 'kind' | 'a' | 'b' | 'y' | 'height' | 'thickness'> => ({
    kind,
    a: [a.x, a.z],
    b: [b.x, b.z],
    y: floorY(),
    height: WALL_HEIGHT,
    thickness: kind === 'wall' ? WALL_THICKNESS : FLOOR_THICKNESS,
  });
  const dropPreview = () => {
    if (!drag) return;
    structuresGroup.remove(drag.mesh);
    drag.mesh.geometry.dispose();
    (drag.mesh.material as MeshBasicMaterial).dispose();
    drag = null;
    controls.enabled = true;
  };

  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    if (!build || !project || e.button !== 0) return;
    const p = floorPoint(e);
    if (!p) return;
    controls.enabled = false; // the drag draws, it does not orbit
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.55 }));
    mesh.visible = false;
    structuresGroup.add(mesh);
    drag = { start: p, mesh };
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!drag || !build) return;
    const p = floorPoint(e);
    if (!p) return;
    const d = draftOf(drag.start, p, build);
    placeStructure(drag.mesh, d);
    drag.mesh.visible = true;
    const dx = Math.abs(d.b[0] - d.a[0]);
    const dz = Math.abs(d.b[1] - d.a[1]);
    ui.setStatus(build === 'wall' ? `Parete: ${Math.hypot(dx, dz).toFixed(2)} m` : `Pavimento: ${dx.toFixed(2)} × ${dz.toFixed(2)} m`);
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (drag && build) {
      const kind = build;
      const from = drag.start;
      dropPreview();
      const p = floorPoint(e);
      if (p && project) {
        const d = draftOf(from, p, kind);
        const dx = Math.abs(d.b[0] - d.a[0]);
        const dz = Math.abs(d.b[1] - d.a[1]);
        if (kind === 'wall' ? Math.hypot(dx, dz) >= 0.1 : dx >= 0.1 && dz >= 0.1) {
          const id = newId();
          project.structures.push({ id, roomId: spaceId(), ...d });
          // Back to selection after each one; Shift held keeps the tool for the next.
          // Shift held: keep the tool for the next one; letting go of Shift leaves it (see the keyup below).
          keepBuild = e.shiftKey;
          if (!e.shiftKey) build = null;
          structLayer.sync(structures());
          setSelection([`s:${id}`]);
          markDirty();
          commit();
          ui.setStatus(`${kind === 'wall' ? 'Parete' : 'Pavimento'} creato. Ricorda di salvare.`);
        } else ui.setStatus('Troppo piccolo: trascina più a lungo.');
      }
      refreshToolbar();
      return;
    }
    if (build) return;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    if (Date.now() - lastDrag < 300 || transform.axis) return;
    ray.setFromCamera(ndcOf(e), camera);
    const targets: Object3D[] = [...layer.holders.values(), ...structLayer.meshes.values()];
    const hit = ray.intersectObjects(targets, true)[0];
    let o: Object3D | null = hit?.object ?? null;
    while (o && !o.userData.modelId && !o.userData.structureId) o = o.parent;
    pick(o ? (o.userData.modelId ? `m:${o.userData.modelId}` : `s:${o.userData.structureId}`) : null, e.shiftKey || e.ctrlKey || e.metaKey);
  });

  // Releasing Shift (or leaving the window) ends a Shift-held series of walls / floors.
  const endSeries = () => {
    if (!keepBuild) return;
    keepBuild = false;
    if (build && !drag) {
      build = null;
      setSelection(sel); // the gizmo was hidden while building: bring it back on the last one made
    }
  };
  // Double click on a model: its component under the mouse (again on the same: the one it is part of).
  renderer.domElement.addEventListener('dblclick', (e) => {
    if (build) return;
    ray.setFromCamera(ndcOf(e as unknown as PointerEvent), camera);
    const hit = ray.intersectObjects([...layer.holders.values()], true)[0];
    let o: Object3D | null = hit?.object ?? null;
    while (o && !o.userData.modelId) o = o.parent;
    if (!hit || !o) return partSel ? setPart(partSel.modelId, null) : undefined;
    const id = o.userData.modelId as string;
    const path = partFromMesh(o, hit.object, partSel?.modelId === id ? partSel.path : null);
    if (!path) return ui.setStatus('Questo modello non ha componenti separati.');
    setPart(id, path);
    ui.setStatus(`Componente: ${partName(nodeByPath(o, path)!)} (Esc per uscire)`);
  });
  window.addEventListener('keyup', (e) => e.key === 'Shift' && endSeries());
  window.addEventListener('blur', endSeries);

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
    if (!project) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') {
      e.preventDefault();
      void save();
    } else if (mod && k === 'z') {
      e.preventDefault();
      jump(e.shiftKey ? hi + 1 : hi - 1);
    } else if (mod && k === 'y') {
      e.preventDefault();
      jump(hi + 1);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!partSel) deleteSelection();
    } else if (e.key === 'Escape') {
      dropPreview();
      build = null;
      if (partSel) setPart(partSel.modelId, null); // leave the component, keep the model
      else setSelection([]);
    } else if (!mod && project) {
      const next = ({ w: 'translate', e: 'rotate', r: 'scale' } as Record<string, Gizmo>)[k];
      if (next) {
        gizmo = next;
        applyGizmo();
        refreshToolbar();
      }
    }
  });
  setInterval(() => sel.length && ui.setDetails(detailsInfo()), 1000); // late-loading models change the size and materials

  ui.setStatus('Carico i progetti...');
  refreshToolbar();
  try {
    if (!(await backend.email())) return ui.setStatus('Accedi (in basso a sinistra) con lo stesso account del visore.');
    [rooms, projects] = await Promise.all([backend.listRooms(), backend.listProjects()]);
  } catch (e) {
    return ui.setStatus(`Caricamento FALLITO: ${errText(e)}`);
  }
  refreshLists();
  ui.setStatus(
    !rooms.length
      ? 'Nessuna stanza salvata: scansionala e salvala dal visore (tab Scan).'
      : projects.length
        ? 'Apri un progetto, o creane uno nuovo.'
        : 'Nessun progetto: creane uno con "Nuovo progetto".',
  );
  return { select: (id: string | null) => pick(id ? `m:${id}` : null, false) };
}
