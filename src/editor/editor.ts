import {
  Box3,
  BoxGeometry,
  Camera,
  Color,
  Euler,
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
  SphereGeometry,
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
import { isPendingModel, modelUrl, listModels, pendingModelFile, pruneModels, registerPendingModel, removeModels, uploadModel, type PruneReport, type StoredModel } from '../cloud/models';
import { createSupabaseBackend } from '../cloud/repo';
import { drawBoxes, drawPlanes } from '../room/draw';
import { dimsOfSolid, dimsOfStructure, formatLength, gapsOfSolid, modelSolid, planeSeg, roomAxes, wallSegs, type Measure, type Seg, type Solid } from '../room/measure';
import { ANNOTATION_COLORS, annotationLength, annotationMeasures, annotationName, copyAnnotation, newAnnotation, DEFAULT_COLOR } from '../room/annotations';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { floorCentre } from '../room/floor';
import { adoptOrphans } from '../room/free';
import { exportGlb, isSimpleGlb, parseModel, sizeFor } from './importer';
import { countTriangles, glbTrianglesAt, describeGlb, glbTrianglesOfFile, HEAVY_TRIANGLES, MAX_FILE_BYTES, simplifyGlb } from './simplify';
import { createModelLayer, modelsPending } from '../room/modelLayer';
import { nodeByPath, partFromMesh, partName, pivotWorld } from '../room/parts';
import { listMaterials, modelBox, modelSize as localModelSize } from '../room/selection';
import { bakeXf, createStructureLayer, floorPoints, placeStructure, polygonArea, structMeasure, structPoints } from '../room/structures';
import type { Annotation, PartEdit, Project, Room, RoomModel, Structure, Vec3 } from '../room/types';
import { addRoomError, knownPlaces, normPlace, placeChangeConflict, samePlace } from '../room/places';
import { linkSummary } from '../room/layout';
import { createOtherRooms } from './otherRooms';
import { createStage } from '../scene/stage';
import { SelectionOutlinePass } from './outline';
import { createLogin } from '../ui/login';
import { newTone, projectTones } from '../ui3d/theme';
import { guessFloorLayers, guessWallLayers, parsePlan, planToStructures, type PlanOptions } from './dxfImport';
import { createEditorUi, type BuildKind, type MeasureMode, type Details, type Gizmo, type LookEdit, type Option, type StructureEdit } from './editorUi';

interface Deps {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  controls: OrbitControls;
  backend: Backend;
  upload?: (file: File) => Promise<{ path: string; name: string }>;
  library?: { list(): Promise<StoredModel[]>; remove(paths: string[]): Promise<void> };
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
  // The centre handle that grabs the three axes at once is gone from the move gizmo: it sat on top of the corner handles of
  // walls and floors. It stays in the scale gizmo (models and components only), where it scales everything uniformly.
  const centres: Object3D[] = [];
  const inner = t.getHelper().children.find((c) => (c as any).gizmo && (c as any).picker) as { gizmo: Record<string, Object3D>; picker: Record<string, Object3D> } | undefined;
  const scaleGroups = new Set<Object3D | undefined>([inner?.gizmo.scale, inner?.picker.scale]);
  // Also gone: the big outer ring of the rotation gizmo (it turns about the camera's line of sight).
  t.getHelper().traverse((o) => (o.name === 'E' || (o.name === 'XYZ' && !scaleGroups.has(o.parent ?? undefined))) && centres.push(o));
  for (const o of centres) o.parent?.remove(o);
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

// Coming back from Google / Microsoft with a failure, Supabase puts the reason in the address (#error_description=...).
// Read it once, tidy the address, and show it on the login card instead of leaving the user guessing.
function takeAuthError(): string | undefined {
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  const s = new URLSearchParams(location.search);
  const text = q.get('error_description') ?? s.get('error_description') ?? q.get('error') ?? s.get('error');
  if (!text) return undefined;
  history.replaceState(null, '', location.pathname + location.search.replace(/[?&](error|error_code|error_description)=[^&]*/g, '').replace(/^&/, '?'));
  let clean = text.replace(/\+/g, ' ');
  try {
    clean = decodeURIComponent(clean); // Supabase sometimes encodes the message twice
  } catch {
    /* keep it as it is */
  }
  return `Accesso non riuscito: ${clean}`;
}

// Entry for the PC: stage without AR, then the editor (the login box lives in its sidebar).
export function createEditorPage(backend: Backend = createSupabaseBackend(), upload?: Deps['upload'], library?: Deps['library']) {
  const { renderer, scene, camera, controls } = createStage({ arButton: false });
  return createEditor({ renderer, scene, camera, controls, backend, upload, library });
}

// PC editor: open or create a project, add the rooms it covers (named scans from the headset), then for each room add
// .glb models, build floors and walls, and move / rotate / scale everything in real size.
export async function createEditor({ renderer, scene, camera, controls, backend, upload = uploadModel, library = { list: listModels, remove: removeModels } }: Deps) {
  const persp = camera as PerspectiveCamera;
  let rooms: Room[] = [];
  let projects: Project[] = [];
  let project: Project | null = null;
  let room: Room | null = null; // the room of the project being edited
  let sel: string[] = []; // selected keys: 'm:<model id>' / 's:<structure id>'
  let dirty = false;
  let lastDrag = 0;
  // annotations: the tool in use, the first point of a ruler, where the pointer is, the selected one (apart from `sel`)
  let annotMode: 'note' | 'ruler' | null = null;
  let annotFirst: Vec3 | null = null;
  let annotCursor: Vec3 | null = null;
  let selAnnotId: string | null = null;
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
  const broken = new Set<string>(); // models whose file could not be loaded
  const layer = createModelLayer(modelsGroup, (t, m) => {
    broken.add(m.id);
    ui.setStatus(`Errore modello: ${t}. Selezionalo e sostituiscilo dal pannello a destra.`);
    if (sel.includes(`m:${m.id}`)) ui.setDetails(detailsInfo());
  });
  const structLayer = createStructureLayer(structuresGroup);
  // The other rooms of the project, around the one being edited (read-only, see otherRooms.ts), and how sure their places are.
  const others = createOtherRooms(scene, (t) => ui.setStatus(`Errore modello in un'altra stanza: ${t}`));
  let roomStates = new Map<string, 'manual' | 'confirmed' | 'tentative' | 'unknown'>();
  const unknownSeen = new Set<string>(); // rooms with no link met in this project: hidden at first (they would only be put aside), the eye brings them back
  function refreshOthers() {
    roomStates = others.sync(room, projectRoomsList(), project?.models ?? [], hiddenRooms);
    let hid = false;
    for (const [id, st] of roomStates) {
      if (st !== 'unknown' || unknownSeen.has(id)) continue;
      unknownSeen.add(id);
      hiddenRooms.add(id);
      hid = true;
    }
    if (hid) roomStates = others.sync(room, projectRoomsList(), project?.models ?? [], hiddenRooms);
  }

  // ---- measures: sizes and free distances of the selected objects (or the sizes of everything), see room/measure.ts ----
  // Both start off every time: they are for looking something up, not a permanent overlay.
  let measureMode: MeasureMode = 'off';
  let gapsOn = false;
  const measureGroup = new Group();
  scene.add(measureGroup);
  const lineMat = (color: number, width: number) => new LineMaterial({ color, linewidth: width, depthTest: false, transparent: true });
  const dimMat = lineMat(0xffffff, 2);
  const gapMat = lineMat(0x2dd4bf, 2.5);
  let dimLines: LineSegments2 | null = null;
  let gapLines: LineSegments2 | null = null;
  let measureSig = '';
  const mv = new Vector3();

  // The measures of the selection (sizes, distances), then the annotations, then what is being drawn right now.
  function computeSizeMeasures(): Measure[] {
    if ((measureMode === 'off' && !gapsOn) || !project) return [];
    const solids = new Map<string, Solid>();
    for (const m of models()) {
      const h = layer.holders.get(m.id);
      const b = h && modelBox(h);
      if (b) solids.set(m.id, modelSolid(m, b.min, b.max));
    }
    const planes = room?.scan.planes ?? [];
    const walls: Seg[] = [...structures().flatMap(wallSegs), ...planes.map((p, i) => planeSeg(p, i)).filter((x): x is Seg => !!x)];
    // Distances are from the object to the walls only (not to other objects or to the scan's furniture volumes).
    const ctx = { obstacles: walls, axes: roomAxes(walls), ceilingY: null, floorY: 0, vertical: false };
    const picked = new Set(selModels().map((m) => m.id));
    const out: Measure[] = [];
    for (const [id, s] of solids) {
      if (measureMode === 'sel' && picked.has(id)) out.push(...dimsOfSolid(s));
      if (gapsOn && picked.has(id)) out.push(...gapsOfSolid(s, ctx));
    }
    const pickedS = new Set(selStructs().map((x) => x.id));
    for (const st of structures()) if (measureMode === 'sel' && pickedS.has(st.id)) out.push(...dimsOfStructure(st));
    return out;
  }

  // A note's foot: the floor, or the first model / wall / floor under it. Kept until something changes (a ray against heavy models
  // every frame would be slow).
  let anchorEpoch = 0;
  const anchors = new Map<string, { key: string; p: Vec3 | null }>();
  const downRay = new Raycaster();
  function noteAnchor(a: Annotation): Vec3 | null {
    if (a.kind !== 'note') return null;
    const key = `${a.a.map((n) => n.toFixed(3))}|${anchorEpoch}`;
    const hit = anchors.get(a.id);
    if (hit && hit.key === key) return hit.p;
    downRay.set(new Vector3(a.a[0], a.a[1] + 0.01, a.a[2]), new Vector3(0, -1, 0));
    downRay.far = 50;
    const first = downRay.intersectObjects([...layer.holders.values(), ...structLayer.meshes.values()], true).find((h) => (h.object as Mesh).isMesh && h.object.visible);
    let p: Vec3 | null = first ? toVec3(first.point) : null;
    if (!p) {
      const f = downRay.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -floorY()), new Vector3());
      p = f ? toVec3(f) : null;
    }
    anchors.set(a.id, { key, p });
    return p;
  }
  function computeAnnotMeasures(): Measure[] {
    const out = annotations().flatMap((a) => annotationMeasures(a, noteAnchor(a)));
    // While a tool is in use: where the pointer would put the point, and the ruler as far as it goes.
    if (annotMode && annotCursor) {
      const color = DEFAULT_COLOR;
      if (annotMode === 'ruler' && annotFirst) out.push(...annotationMeasures({ id: 'draft', roomId: spaceId(), kind: 'ruler', a: annotFirst, b: annotCursor, text: '', color }));
      else out.push(...annotationMeasures({ id: 'draft', roomId: spaceId(), kind: 'note', a: annotCursor, text: '', color }).filter((m) => m.kind === 'pin'));
    }
    if (annotMode === 'ruler' && annotFirst && !annotCursor) out.push(...annotationMeasures({ id: 'draft', roomId: spaceId(), kind: 'note', a: annotFirst, text: '', color: DEFAULT_COLOR }).filter((m) => m.kind === 'pin'));
    return out;
  }

  // Small spheres at the points of the annotations: invisible, for clicking and dragging them; a white dot on the selected one.
  const annotPickGroup = new Group();
  scene.add(annotPickGroup);
  const annotSphereGeo = new SphereGeometry(1, 12, 8);
  const annotPickMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const annotSelMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false });
  const annotSpheres: Mesh[] = [];
  function syncAnnotSpheres() {
    const pts: { id: string; pt: 'a' | 'b'; pos: Vec3 }[] = [];
    for (const a of annotations()) {
      pts.push({ id: a.id, pt: 'a', pos: a.a });
      if (a.kind === 'ruler' && a.b) pts.push({ id: a.id, pt: 'b', pos: a.b });
    }
    while (annotSpheres.length < pts.length) {
      const m = new Mesh(annotSphereGeo, annotPickMat);
      m.renderOrder = 1000;
      annotPickGroup.add(m);
      annotSpheres.push(m);
    }
    annotSpheres.forEach((m, i) => {
      const q = pts[i];
      m.visible = !!q;
      if (!q) return;
      m.position.set(...q.pos);
      const d = camera.position.distanceTo(m.position);
      const chosen = q.id === selAnnotId;
      m.scale.setScalar(Math.min(0.3, Math.max(0.04, d * (chosen ? 0.009 : 0.016)))); // the same size on screen at any distance
      m.material = chosen ? annotSelMat : annotPickMat;
      m.userData = { annotId: q.id, pt: q.pt };
    });
  }

  const annotMats = new Map<string, LineMaterial>(); // a line material per annotation colour
  let annotLines: LineSegments2[] = [];
  function updateMeasures() {
    const list = [...computeSizeMeasures(), ...computeAnnotMeasures()];
    const sig = list.map((m) => `${m.kind}${m.color ?? ''}${m.a.map((n) => n.toFixed(3))}${m.b.map((n) => n.toFixed(3))}`).join('|');
    if (sig !== measureSig) {
      measureSig = sig;
      for (const l of [dimLines, gapLines, ...annotLines]) if (l) (measureGroup.remove(l), l.geometry.dispose());
      const flat = (match: (m: Measure) => boolean) => list.filter(match).flatMap((m) => [...m.a, ...m.b]);
      const make = (pos: number[], mat: LineMaterial) => {
        if (!pos.length) return null;
        const l = new LineSegments2(new LineSegmentsGeometry().setPositions(pos), mat);
        l.renderOrder = 999;
        l.frustumCulled = false;
        measureGroup.add(l);
        return l;
      };
      dimLines = make(flat((m) => m.kind === 'dim'), dimMat);
      gapLines = make(flat((m) => m.kind === 'gap'), gapMat);
      annotLines = [];
      for (const color of new Set(list.filter((m) => m.color).map((m) => m.color!))) {
        let mat = annotMats.get(color);
        if (!mat) annotMats.set(color, (mat = lineMat(new Color(color).getHex(), 2.5)));
        const l = make(flat((m) => m.color === color && (m.kind === 'pin' || m.kind === 'ruler')), mat);
        if (l) annotLines.push(l);
      }
    }
    for (const mat of [dimMat, gapMat, ...annotMats.values()]) mat.resolution.set(window.innerWidth, window.innerHeight);
    syncAnnotSpheres();
    camera.updateMatrixWorld(); // the labels follow this frame's camera, not the one the last render used (they lagged one frame behind)
    const labels = [];
    for (const m of list) {
      if (m.kind === 'pin' || !m.text) continue;
      mv.set((m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2).project(camera);
      if (mv.z > 1 || Math.abs(mv.x) > 1.2 || Math.abs(mv.y) > 1.2) continue;
      labels.push({ x: ((mv.x + 1) / 2) * window.innerWidth, y: ((1 - mv.y) / 2) * window.innerHeight, text: m.text, kind: m.kind, color: m.color, scale: m.scale });
    }
    ui.setMeasureLabels(labels);
  }

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
    syncHandles();
    updateMeasures();
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
    if (e.value) {
      startDrag();
      topSpin = null;
      if (ortho && effectiveGizmo() === 'rotate') {
        const p0 = floorPointAt(lastPointer.x, lastPointer.y);
        if (p0) topSpin = { prev: p0, r0: Math.max(0.1, Math.hypot(p0.x - pivot.position.x, p0.z - pivot.position.z)), turn: 0 };
      }
    } else {
      topSpin = null;
      start = null;
      annotStart = null;
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
  const annotations = () => project?.annotations.filter((a) => a.roomId === spaceId()) ?? [];
  const findAnnot = (id: string | null) => (id ? (annotations().find((a) => a.id === id) ?? null) : null);
  const floorY = () => (room ? floorCentre(room.scan.planes)[1] : 0);
  const selModels = () => sel.filter((k) => k[0] === 'm').map((k) => findModel(k.slice(2))).filter((m): m is RoomModel => !!m);
  const selStructs = () => sel.filter((k) => k[0] === 's').map((k) => findStructure(k.slice(2))).filter((s): s is Structure => !!s);
  const objectOf = (key: string): Object3D | null => (key[0] === 'm' ? layer.holders.get(key.slice(2)) : structLayer.meshes.get(key.slice(2))) ?? null;
  const wallYaw = (s: Structure) => -Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
  // The pivot of a wall / floor is its first point: that is what snaps onto the grid and onto other vertices.
  const anchorOf = (s: Structure): [number, number] => (s.kind === 'floor' ? floorPoints(s)[0] : [s.a[0], s.a[1]]);

  // ---- history (undo / redo): snapshots of the project's models and structures ----
  let hist: string[] = [];
  let hi = -1;
  const snapshot = () => JSON.stringify({ m: project?.models ?? [], s: project?.structures ?? [], n: project?.annotations ?? [] });
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
    const d = JSON.parse(hist[hi]) as { m: RoomModel[]; s: Structure[]; n?: Annotation[] };
    project.models = d.m;
    project.structures = d.s;
    project.annotations = d.n ?? [];
    if (selAnnotId && !findAnnot(selAnnotId)) selAnnotId = null;
    layer.sync(models());
    structLayer.sync(structures());
    sel = sel.filter((k) => (k[0] === 'm' ? findModel(k.slice(2)) : findStructure(k.slice(2))));
    if (partSel && !findModel(partSel.modelId)) partSel = null;
    markDirty();
    setSelection(sel);
  }

  function markDirty(on = true) {
    anchorEpoch++;
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
  const effectiveGizmo = (): Gizmo => (selAnnotId ? 'translate' : gizmo === 'scale' && !partSel && !(selModels().length === 1 && sel.length === 1) ? 'translate' : gizmo);

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

  const modelQuat = (m: RoomModel) => new Quaternion().setFromEuler(new Euler(m.tilt?.[0] ?? 0, m.yaw, m.tilt?.[1] ?? 0, 'YXZ'));

  function refreshPivot() {
    const an = findAnnot(selAnnotId);
    if (an) {
      // A note: its point. A ruler: the middle of the two. The gizmo moves the whole annotation.
      const b = an.b ?? an.a;
      pivot.position.set((an.a[0] + b[0]) / 2, (an.a[1] + b[1]) / 2, (an.a[2] + b[2]) / 2);
      pivot.rotation.set(0, 0, 0);
      pivot.scale.setScalar(1);
      pivot.updateMatrixWorld(true);
      return;
    }
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
    if (local && n === 1 && ms[0]) pivot.rotation.set(ms[0].tilt?.[0] ?? 0, ms[0].yaw, ms[0].tilt?.[1] ?? 0, 'YXZ');
    else pivot.rotation.set(0, yaw, 0, 'YXZ');
    pivot.scale.setScalar(1);
    pivot.updateMatrixWorld(true);
  }

  function applyGizmo() {
    const mode = effectiveGizmo();
    transform.setMode(mode);
    // Models turn about any axis; walls, floors and components only about the vertical one.
    const modelsOnly = !partSel && sel.length > 0 && selStructs().length === 0 && !ortho; // the top view keeps the vertical ring only, as it was
    transform.showX = mode !== 'rotate' || modelsOnly;
    transform.showZ = mode !== 'rotate' || modelsOnly;
    transform.setSpace(local && mode !== 'scale' ? 'local' : 'world');
    transform.setTranslationSnap(null); // done by hand in objectChange: the pivot lands exactly on a grid point
    transform.setRotationSnap(snapGrid ? MathUtils.degToRad(15) : null);
    transform.setScaleSnap(snapGrid ? GRID_STEP : null);
  }

  function setSelection(keys: string[]) {
    sel = keys;
    selAnnotId = null; // an annotation is selected with selectAnnot, after this
    partSel = null;
    if (keys.length && !build) {
      refreshPivot();
      transform.attach(pivot);
    } else transform.detach();
    applyGizmo();
    refreshAll();
  }

  function selectAnnot(id: string | null) {
    setSelection([]);
    selAnnotId = id;
    if (id && findAnnot(id) && !build) {
      refreshPivot();
      transform.attach(pivot); // the gizmo moves the whole annotation
    }
    applyGizmo();
    refreshAll();
  }

  function pick(key: string | null, additive: boolean) {
    if (key?.startsWith('a:')) return selectAnnot(key.slice(2));
    if (!key) return additive ? undefined : setSelection([]);
    if (!additive) return setSelection([key]);
    setSelection(sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key]);
  }

  // ---- drag of the gizmo: apply the pivot's movement to every selected object ----
  interface Start {
    c: Vector3;
    q: Quaternion;
    models: Map<string, { pos: [number, number, number]; yaw: number; scale: number; q: Quaternion }>;
    structs: Map<string, { a: [number, number]; b: [number, number]; y: number; pts: [number, number][] | null }>;
  }
  let start: Start | null = null;
  let partStart: { c: Vector3; q: Quaternion; d: [number, number, number]; yaw: number; scale: number } | null = null;
  let annotStart: { a: Vec3; b: Vec3 | null; c: Vector3 } | null = null;
  function startDrag() {
    const an = findAnnot(selAnnotId);
    if (an) {
      annotStart = { a: [...an.a] as Vec3, b: an.b ? ([...an.b] as Vec3) : null, c: pivot.position.clone() };
      start = { c: pivot.position.clone(), q: pivot.quaternion.clone(), models: new Map(), structs: new Map() };
      return;
    }
    if (partSel) {
      const e = partEdit();
      partStart = { c: pivot.position.clone(), q: pivot.quaternion.clone(), d: [...(e?.d ?? [0, 0, 0])] as [number, number, number], yaw: e?.yaw ?? 0, scale: e?.scale ?? 1 };
      start = { c: pivot.position.clone(), q: pivot.quaternion.clone(), models: new Map(), structs: new Map() };
      return;
    }
    start = {
      c: pivot.position.clone(),
      q: pivot.quaternion.clone(),
      models: new Map(selModels().map((m) => [m.id, { pos: [...m.pos] as [number, number, number], yaw: m.yaw, scale: m.scale, q: modelQuat(m) }])),
      structs: new Map(selStructs().map((s) => [s.id, { a: [...s.a] as [number, number], b: [...s.b] as [number, number], y: s.y, pts: s.kind === 'floor' ? floorPoints(s).map(([x, z]) => [x, z] as [number, number]) : null }])),
    };
  }

  // Vertices (wall ends, floor corners) of the structures that are not being moved.
  function snapToVertex(x: number, z: number, exclude: Set<string>): [number, number] | null {
    let best: [number, number] | null = null;
    let bd = VERTEX_RANGE;
    for (const s of structures()) {
      if (exclude.has(s.id)) continue;
      for (const p of structPoints(s)) {
        const d = Math.hypot(p[0] - x, p[1] - z);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
    }
    return best;
  }

  // The top view is a tiny field of view from far away, and the gizmo's own rotation speed depends on that distance (it would
  // turn a hundred times too little): there the turn is read from the pointer on the floor. Each move turns by the distance
  // travelled along the circle round the pivot, over the radius where the ring was grabbed: dragging along a line turns at a
  // steady rate, however far from the pivot the pointer goes, and going round the ring follows it.
  let topSpin: { prev: Vector3; r0: number; turn: number } | null = null;
  const lastPointer = { x: 0, y: 0 };
  renderer.domElement.addEventListener('pointermove', (e) => ((lastPointer.x = e.clientX), (lastPointer.y = e.clientY)), true);
  function floorPointAt(cx: number, cy: number): Vector3 | null {
    const rect = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1), camera);
    return ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -pivot.position.y), new Vector3());
  }

  transform.addEventListener('objectChange', () => {
    if (!start) return;
    const mode = effectiveGizmo();
    const moved = findAnnot(selAnnotId);
    if (moved && annotStart) {
      // An annotation follows the gizmo (on the 5 cm grid, like the models).
      if (snapGrid) {
        pivot.position.x = Math.round(pivot.position.x / GRID_STEP) * GRID_STEP;
        pivot.position.y = Math.round(pivot.position.y / GRID_STEP) * GRID_STEP;
        pivot.position.z = Math.round(pivot.position.z / GRID_STEP) * GRID_STEP;
      }
      const dp = pivot.position.clone().sub(annotStart.c);
      moved.a = [annotStart.a[0] + dp.x, annotStart.a[1] + dp.y, annotStart.a[2] + dp.z];
      if (moved.b && annotStart.b) moved.b = [annotStart.b[0] + dp.x, annotStart.b[1] + dp.y, annotStart.b[2] + dp.z];
      markDirty();
      return;
    }
    if (topSpin && mode === 'rotate') {
      const p = floorPointAt(lastPointer.x, lastPointer.y);
      if (p) {
        const rx = p.x - pivot.position.x;
        const rz = p.z - pivot.position.z;
        const r = Math.max(Math.hypot(rx, rz), topSpin.r0 * 0.3);
        // yaw grows with atan2(x, z): d(yaw) = (z dx - x dz) / r^2, here over r * r0
        topSpin.turn += (rz * (p.x - topSpin.prev.x) - rx * (p.z - topSpin.prev.z)) / (r * topSpin.r0);
        topSpin.prev = p;
      }
      let turn = topSpin.turn;
      if (snapGrid) turn = Math.round(turn / MathUtils.degToRad(15)) * MathUtils.degToRad(15);
      const q0 = (partSel && partStart ? partStart.q : start.q).clone();
      pivot.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn).multiply(q0));
    }
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
      // world -> model frame: undo the model's turn (any axis) and its scale
      const inModel = dp.clone().applyQuaternion(modelQuat(pm).invert()).divideScalar(pm.scale);
      e.d = [partStart.d[0] + inModel.x, partStart.d[1] + inModel.y, partStart.d[2] + inModel.z];
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
        for (const q of s.pts ?? [s.a, s.b]) probe(...q);
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
    const turnAny = mode === 'rotate' && selStructs().length === 0; // only models selected: all three axes
    const cs = Math.cos(dyaw);
    const sn = Math.sin(dyaw);
    const c = start.c;
    const rot = (x: number, z: number): [number, number] => [c.x + (x - c.x) * cs + (z - c.z) * sn + dp.x, c.z - (x - c.x) * sn + (z - c.z) * cs + dp.z];
    for (const m of selModels()) {
      const s0 = start.models.get(m.id);
      if (!s0) continue;
      if (turnAny) {
        // Any axis: the whole rotation moves the models' places about the centre and turns each one.
        const p = new Vector3(...s0.pos).sub(c).applyQuaternion(dq).add(c).add(dp);
        m.pos = [p.x, p.y, p.z];
        const e = new Euler().setFromQuaternion(dq.clone().multiply(s0.q), 'YXZ');
        m.yaw = e.y;
        if (Math.abs(e.x) > 1e-4 || Math.abs(e.z) > 1e-4) m.tilt = [e.x, e.z];
        else delete m.tilt;
      } else {
        const [x, z] = rot(s0.pos[0], s0.pos[2]);
        m.pos = [x, s0.pos[1] + dp.y, z];
        m.yaw = Math.atan2(Math.sin(s0.yaw + dyaw), Math.cos(s0.yaw + dyaw));
      }
      m.scale = s0.scale * factor;
    }
    for (const s of selStructs()) {
      const s0 = start.structs.get(s.id);
      if (!s0) continue;
      s.a = rot(...s0.a);
      s.b = rot(...s0.b);
      if (s0.pts) s.pts = s0.pts.map(([x, z]) => rot(x, z));
      s.y = s0.y + dp.y;
    }
    layer.sync(models());
    structLayer.sync(structures());
    markDirty();
    ui.setDetails(detailsInfo());
  });

  // ---- sidebar / outline / details data ----
  const confirmLeave = async () => !dirty || (await ui.askConfirm('Ci sono modifiche non salvate al progetto. Continuare senza salvare?', 'Continua senza salvare', 'Modifiche non salvate'));

  const annotStepText = () => (annotMode === 'note' ? 'Nota: clic su un punto di un modello, di una parete o del pavimento' : annotMode === 'ruler' ? (annotFirst ? 'Metro: clic sul secondo punto' : 'Metro: clic sul primo punto') : '');
  function refreshToolbar() {
    ui.setToolbar({ build, gizmo, ortho, grid: snapGrid, vertex: snapVertex, local, annot: annotMode, annotStep: annotStepText(), measures: measureMode, gaps: gapsOn, canUndo: hi > 0, canRedo: hi < hist.length - 1 });
  }

  // How a room stands with the others of its place: "Cucina ✓, Sala (da confermare)" (a link only seen once is a guess).
  function linksText(r: Room): string | undefined {
    if (!normPlace(r.place)) return undefined;
    const sum = linkSummary(r, rooms);
    if (!sum.length) return rooms.some((x) => x.id !== r.id && samePlace(x.place, r.place)) ? 'nessuna ancora' : undefined;
    return sum.map((l) => `${l.name} ${l.state === 'confirmed' ? '✓' : l.state === 'manual' ? '✓ (a mano)' : '(da confermare)'}`).join(', ');
  }

  function refreshLists() {
    const tones = projectTones(projects);
    ui.setProjects(projects.map((p) => ({ id: p.id, name: p.name, tone: tones.get(p.id) })), project?.id ?? null);
    ui.setRooms(rooms.map((r) => ({ id: r.id, name: r.name, place: r.place, links: linksText(r), sub: `Creata il ${dateOf(r.createdAt)}`, uses: projects.filter((p) => p.roomIds.includes(r.id)).map((p) => p.name) })));
    ui.setProject(
      project?.name ?? '',
      projectRoomsList().map((r) => {
        const st = roomStates.get(r.id);
        return { id: r.id, name: r.name, hidden: hiddenRooms.has(r.id), note: st === 'tentative' ? 'collegamento da confermare' : st === 'unknown' ? 'posizione sconosciuta' : undefined, noteWarn: st === 'tentative' };
      }),
      room?.id ?? null,
      // only rooms of the project's place can be added (a project uses one place)
      rooms.filter((r) => !project?.roomIds.includes(r.id) && !addRoomError(projectRoomsList(), r)).map((r) => ({ id: r.id, name: r.place ? `${r.name} · ${r.place}` : r.name })),
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
        ...annotations().map((a) => ({ key: `a:${a.id}`, name: annotationName(a), kind: a.kind })),
      ],
      new Set(selAnnotId ? [...sel, `a:${selAnnotId}`] : sel),
    );
  }

  // Real size along the model's own axes (the file's box in its own frame, times the scale).
  function modelSize(holder: Object3D, scale: number): [number, number, number] | null {
    const d = localModelSize(holder);
    return d ? [d.x * scale, d.y * scale, d.z * scale] : null;
  }

  function detailsInfo(): Details | null {
    const an = findAnnot(selAnnotId);
    if (an) {
      const len = annotationLength(an);
      return { kind: 'annotation', key: `a:${an.id}`, type: an.kind, text: an.text, color: an.color, colors: ANNOTATION_COLORS, length: len === null ? null : formatLength(len) };
    }
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
    // Several walls, or several floors (not a mix): one set of parameters for all of them, shown with the first one's values.
    const group = selStructs();
    const sameKind = group.length > 1 && group.length === sel.length && group.every((x) => x.kind === group[0].kind);
    if (sel.length > 1 && !sameKind) return { kind: 'multi', count: sel.length };
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
        name: m.name,
        source: m.source,
        missing: broken.has(m.id) ? libOptions : undefined,
        color: m.color ?? null,
        finish: { roughness: m.finish?.roughness ?? materials[0]?.roughness ?? 0.5, metalness: m.finish?.metalness ?? materials[0]?.metalness ?? 0 },
        scale: m.scale, yawDeg: (m.yaw * 180) / Math.PI, tiltDeg: [((m.tilt?.[0] ?? 0) * 180) / Math.PI, ((m.tilt?.[1] ?? 0) * 180) / Math.PI], size: holder ? modelSize(holder, m.scale) : null, materials };
    }
    const s = selStructs()[0];
    if (!s) return null;
    const total = group.reduce((t, x) => t + (x.kind === 'wall' ? Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]) : polygonArea(floorPoints(x))), 0);
    return {
      kind: 'structure',
      key: `s:${group.map((x) => x.id).join(',')}`,
      count: group.length,
      type: s.kind,
      height: s.height,
      thickness: s.thickness,
      color: s.color ?? null,
      texture: s.texture ?? null,
      align: s.kind === 'wall' ? (s.align ?? 'center') : undefined,
      finish: { roughness: s.finish?.roughness ?? (s.texture ? 1 : 0.9), metalness: s.finish?.metalness ?? 0 },
      measure: group.length > 1 ? (s.kind === 'wall' ? `Lunghezza totale ${total.toFixed(2)} m` : `Superficie totale ${total.toFixed(2)} m²`) : structMeasure(s),
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
    applyGizmo(); // the rotation gizmo has all its rings only in the perspective view
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
    annotMode = null;
    annotFirst = null;
    annotCursor = null;
    selAnnotId = null;
    planesGroup.clear();
    gridGroup.clear();
    setOrtho(false);
    build = null;
    layer.sync(models());
    structLayer.sync(structures());
    setSelection([]);
    refreshOthers();
    refreshLists();
    if (!r) {
      if (!project) return ui.setStatus('Apri un progetto, o creane uno nuovo.');
      // No room: just the grid, and models can be loaded (they appear in front of you in the headset).
      gridGroup.add(new GridHelper(8, 16, 0x335566, 0x223344));
      frameWhenLoaded = true;
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
    const around = others.bounds();
    if (!around.isEmpty()) {
      const all = bounds.clone().union(around); // the whole place in view, unless it is huge
      if (all.getSize(new Vector3()).length() < 120) bounds.copy(all);
    }
    const centre = bounds.getCenter(new Vector3());
    const span = Math.max(3, bounds.getSize(new Vector3()).length());
    controls.target.copy(centre);
    camera.position.set(centre.x, centre.y + span * 0.7, centre.z + span * 0.9);
    controls.update();
    const states = [...roomStates.values()];
    const sure = states.filter((x) => x === 'confirmed' || x === 'manual').length;
    const guess = states.filter((x) => x === 'tentative').length;
    const aside = states.filter((x) => x === 'unknown').length;
    const more = states.length ? ` · altre stanze: ${[sure && `${sure} collegate`, guess && `${guess} da confermare`, aside && `${aside} senza collegamento`].filter(Boolean).join(', ')}` : '';
    ui.setStatus(`Stanza "${r.name}": ${r.scan.planes.length} piani (${plan.drawn} con contorno), ${volumes} volumi${more}`);
  }

  function showProject(p: Project | null) {
    project = p;
    unknownSeen.clear();
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

  // The loading card: for what we wait on ourselves (manual), else for models still being downloaded and read.
  let manualLoad: { title: string; sub?: string } | null = null;
  let batchTotal = 0;
  let lastPending = 0;
  // Free space (no room): the camera goes where the models are, whatever their size (a file in centimetres is a hundred times
  // bigger than it should be and would otherwise be out of sight).
  let frameWhenLoaded = false;
  function frameSpace() {
    const box = new Box3();
    for (const h of layer.holders.values()) box.union(new Box3().setFromObject(h));
    for (const m of structLayer.meshes.values()) box.union(new Box3().setFromObject(m));
    if (box.isEmpty()) return;
    const centre = box.getCenter(new Vector3());
    const span = Math.max(2, box.getSize(new Vector3()).length());
    if (ortho) setOrtho(false);
    controls.target.copy(centre);
    camera.position.set(centre.x, centre.y + span * 0.6, centre.z + span * 1.0);
    controls.update();
  }
  function refreshLoading() {
    const pending = modelsPending();
    if (frameWhenLoaded && pending === 0 && !room && [...layer.holders.values()].every((h) => h.children.length)) {
      frameWhenLoaded = false;
      frameSpace();
    }
    if (pending > lastPending) batchTotal += pending - lastPending;
    lastPending = pending;
    if (pending === 0) batchTotal = 0;
    if (manualLoad) return ui.setLoading(manualLoad);
    if (pending > 0) ui.setLoading({ title: 'Carico i modelli', sub: `Modelli ${batchTotal - pending} / ${batchTotal}`, value: (batchTotal - pending) / batchTotal });
    else ui.setLoading(null);
  }
  // `what` may call the function it gets to change the line under the title (progress).
  async function withLoading<T>(title: string, sub: string | undefined, what: (progress: (text: string) => void) => Promise<T>): Promise<T> {
    manualLoad = { title, sub };
    refreshLoading();
    let live = true; // progress that arrives after the work ended (or failed) must not bring the card back
    try {
      return await what((text) => {
        if (!live) return;
        manualLoad = { title, sub: sub ? `${sub} · ${text}` : text };
        refreshLoading();
      });
    } finally {
      live = false;
      manualLoad = null;
      refreshLoading();
    }
  }
  setInterval(refreshLoading, 120);

  let libOptions: Option[] = []; // library files offered when a model's file is missing
  async function refreshLibOptions() {
    try {
      const [files, used] = await Promise.all([library.list(), usage()]);
      libOptions = files.map((f) => ({ id: f.path, name: `${used.get(f.path) ? [...used.get(f.path)!.names].join(' / ') : 'senza progetto'} · ${sizeText(f.size)}` }));
    } catch {
      libOptions = [];
    }
  }

  // The model library: every file of the account with the projects (and names) that use it.
  const sizeText = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  async function usage() {
    const used = new Map<string, { names: Set<string>; projects: Set<string> }>();
    for (const p of await backend.listProjects()) {
      for (const m of p.models) {
        const u = used.get(m.path) ?? { names: new Set(), projects: new Set() };
        u.names.add(m.name);
        u.projects.add(p.name);
        used.set(m.path, u);
      }
    }
    for (const m of project?.models ?? []) {
      const u = used.get(m.path) ?? { names: new Set(), projects: new Set() };
      u.names.add(m.name);
      u.projects.add(project!.name); // what is open now, saved or not
      used.set(m.path, u);
    }
    return used;
  }
  // Triangles per cloud file, remembered in the browser: a path is the hash of the content, so the number never changes.
  const trisKey = (path: string) => `immersa.tris.${path}`;
  const knownTris = (path: string): number | undefined => {
    try {
      const v = localStorage.getItem(trisKey(path));
      return v === null ? undefined : Number(v);
    } catch {
      return undefined;
    }
  };
  let libraryLoad = 0;
  async function loadLibrary(note = '') {
    const token = ++libraryLoad;
    ui.setLibrary(null);
    try {
      const [files, used] = await Promise.all([library.list(), usage()]);
      const items = files.map((f) => {
        const u = used.get(f.path);
        const fallback = f.path.split('/').pop()!.replace(/^\d{10,}-/, '').replace(/\.glb$/i, '');
        const name = u ? [...u.names].join(' / ') : /^[0-9a-f]{64}$/.test(fallback) ? 'Modello senza progetto' : fallback;
        const left = f.createdAt ? Math.ceil((24 * 3600 * 1000 - (Date.now() - new Date(f.createdAt).getTime())) / 3600000) : 0;
        const wait = !u && left > 0 ? ` · si elimina da solo fra ${left} h` : '';
        return { path: f.path, name, sub: `${sizeText(f.size)}${f.createdAt ? ` · caricato il ${dateOf(f.createdAt)}` : ''}${wait}`, usedIn: u ? [...u.projects] : [], triangles: knownTris(f.path) };
      });
      ui.setLibrary(items, note);
      // Look inside the used files whose triangles are not known yet (one after the other, a few bytes each) and update the list.
      for (const it of items) {
        if (token !== libraryLoad) return;
        if (it.triangles !== undefined || !it.usedIn.length || it.path.startsWith('local:')) continue;
        try {
          it.triangles = await glbTrianglesAt(await modelUrl(it.path));
          try {
            localStorage.setItem(trisKey(it.path), String(it.triangles));
          } catch {
            /* no storage: asked again next time */
          }
          if (token === libraryLoad) ui.setLibrary(items, note);
        } catch {
          /* unreadable: the button stays on and the check is made when it is pressed */
        }
      }
    } catch (e) {
      ui.setLibrary([], `Errore: ${errText(e)}`);
    }
  }

  // Deletes the files in the cloud that no project uses any more (silent, best effort, files under a day old are kept).
  async function prune(): Promise<PruneReport | null> {
    try {
      const used = new Set<string>();
      for (const p of await backend.listProjects()) for (const m of p.models) used.add(m.path);
      for (const m of project?.models ?? []) used.add(m.path);
      return await pruneModels(used);
    } catch {
      return null; // cleanup is optional
    }
  }

  // Files that are about to go up: the ones above the headset's triangle budget are offered for simplification (a dialog with
  // the choice per model); what comes back is what must be uploaded. null = the user cancelled.
  const simplifiedKeys = new Set<string>(); // files that went through the simplifier (for the size message)
  async function lighten(entries: { key: string; name: string; file: File }[]): Promise<Map<string, File> | null> {
    const heavy: { id: string; name: string; triangles: number }[] = [];
    await withLoading('Controllo i modelli', undefined, async () => {
      for (const e of entries) {
        // From the file's header (no parsing). If even that fails, or the file is simply too big for the cloud, it counts as heavy.
        const triangles = await glbTrianglesOfFile(e.file).catch(() => 0);
        if (triangles > HEAVY_TRIANGLES || e.file.size > MAX_FILE_BYTES) heavy.push({ id: e.key, name: e.name, triangles: Math.max(triangles, HEAVY_TRIANGLES + 1) });
      }
    });
    const out = new Map(entries.map((e) => [e.key, e.file]));
    if (!heavy.length) return out;
    const choice = await ui.askSimplify(heavy, HEAVY_TRIANGLES);
    if (!choice) return null;
    for (const h of heavy) {
      if (!choice.get(h.id)) continue; // kept as it is
      const entry = entries.find((e) => e.key === h.id)!;
      const res = await withLoading('Semplifico il modello', h.name, (progress) => simplifyGlb(entry.file, HEAVY_TRIANGLES, progress));
      out.set(h.id, res.file);
      simplifiedKeys.add(h.id);
      ui.setStatus(`${h.name}: semplificato del ${Math.round((1 - res.after / res.before) * 100)}% (${res.after.toLocaleString('it-IT')} triangoli, ${(res.file.size / 1048576).toFixed(1)} MB).`);
    }
    return out;
  }

  // Models imported since the last save are uploaded now. `uploaded` remembers where each went, so that undoing back to a
  // model that is already up does not ask again.
  const uploaded = new Map<string, string>();
  async function uploadPending(): Promise<boolean> {
    if (!project) return true;
    const waiting = [...new Set(project.models.map((m) => m.path).filter(isPendingModel))];
    const toSend = waiting.filter((p) => !uploaded.has(p) && pendingModelFile(p));
    if (toSend.length) {
      const entries = toSend.map((p) => ({ key: p, name: project!.models.find((m) => m.path === p)!.name, file: pendingModelFile(p)! }));
      const files = await lighten(entries);
      if (!files) return false;
      for (const e of entries) {
        const f = files.get(e.key)!;
        if (f.size > MAX_FILE_BYTES + 5 * 1048576) {
          // Over the cloud's limit: say what is in the file, instead of sending hundreds of MB for nothing.
          throw new Error(`${e.name}: il file da caricare (${simplifiedKeys.has(e.key) ? 'semplificato' : 'originale, non semplificato'}) pesa ${(f.size / 1048576).toFixed(0)} MB, il cloud accetta 50 MB per file. Contiene ${await describeGlb(f).catch(() => 'dati che non so leggere')}`);
        }
        const { path } = await withLoading('Carico il modello', e.name, () => upload(f));
        uploaded.set(e.key, path);
      }
    }
    for (const m of project.models) {
      const to = uploaded.get(m.path);
      if (to) m.path = to;
    }
    layer.sync(models()); // the models now come from the cloud (simplified, if so chosen)
    return true;
  }

  async function save() {
    if (!project) return;
    ui.setStatus('Salvo...');
    try {
      if (!(await uploadPending())) return ui.setStatus('Salvataggio annullato.');
      const res = await withLoading('Salvo il progetto', project.name, () => backend.saveProject(project!.id, { models: project!.models, roomIds: project!.roomIds, structures: project!.structures, annotations: project!.annotations }));
      markDirty(false);
      // An older cloud schema cannot keep the notes and rulers: say so instead of letting them vanish silently.
      if (res?.skipped?.includes('annotations') && project.annotations.length) ui.setStatus(`Salvato, ma le annotazioni NON si salvano: riesegui supabase/schema.sql nel pannello di Supabase (SQL Editor).`);
      else ui.setStatus(`Progetto "${project.name}" salvato`);
      void prune();
    } catch (e) {
      ui.setStatus(`Salvataggio FALLITO: ${errText(e)}`);
    }
  }

  function deleteSelection() {
    if (project && selAnnotId) {
      project.annotations = project.annotations.filter((a) => a.id !== selAnnotId);
      selectAnnot(null);
      markDirty();
      commit();
      return;
    }
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

  // Importing models: a .glb goes straight up; anything else is read, asked about (unit, up axis) and converted to GLB first.
  // Names are unique in the project: a second "scatola" becomes "scatola_1", then "scatola_2".
  const nameTaken = (n: string, exceptId?: string) => !!project?.models.some((m) => m.id !== exceptId && m.name.toLowerCase() === n.toLowerCase());
  function uniqueModelName(base: string): string {
    if (!nameTaken(base)) return base;
    for (let i = 1; ; i++) if (!nameTaken(`${base}_${i}`)) return `${base}_${i}`;
  }

  // Reads any supported file(s) into a GLB ready to upload: a .glb goes as it is, anything else is read, asked about (unit, up
  // axis) and converted. null = the user cancelled.
  async function prepareGlb(files: File[]): Promise<{ file: File; source: string; base: string } | null> {
    let file = files[0];
    let source = files[0].name;
    let base = files[0].name.replace(/\.[^.]+$/, '');
    if (!isSimpleGlb(files)) {
      const parsed = await withLoading('Leggo il modello', files[0].name, () => parseModel(files));
      const choice = await ui.askImport({
        name: parsed.name,
        format: parsed.format,
        triangles: parsed.triangles,
        fixedUnit: parsed.fixedUnit,
        unit: parsed.guessUnit,
        zUp: parsed.guessZUp,
        dims: (unit, zUp) => sizeFor(parsed, { unit, zUp }).map((v) => v.toFixed(2)).join(' × ') + ' m (larghezza × altezza × profondità)',
      });
      if (!choice) return null;
      source = parsed.source;
      base = parsed.name;
      if (parsed.flipped) ui.setStatus(`Ho girato le facce di ${parsed.flipped} ${parsed.flipped === 1 ? 'parte' : 'parti'} rivolte all'interno.`);
      file = await withLoading('Converto in GLB', parsed.name, () => exportGlb(parsed, choice));
    }
    return { file, source, base };
  }

  async function importFiles(files: File[]) {
    if (!project) return ui.setStatus('Apri o crea un progetto prima di caricare un modello');
    ui.setStatus(`Carico ${files[0].name}...`);
    try {
      const prepared = await prepareGlb(files);
      if (!prepared) return ui.setStatus('Importazione annullata.');
      const { file, source, base } = prepared;
      const path = registerPendingModel(file); // goes up when the project is saved
      const name = uniqueModelName(base);
      const id = newId();
      // In a room: its floor centre. Without one: in a row along x, so that several do not overlap.
      const free = models().length;
      if (!room) frameWhenLoaded = true;
      project.models.push({ id, roomId: spaceId(), name, source, path, pos: room ? floorCentre(room.scan.planes) : [free * 1.2, 0, 0], yaw: 0, scale: 1 });
      layer.sync(models());
      setSelection([`m:${id}`]);
      markDirty();
      commit();
      ui.setStatus('Aggiunto. Ricorda di salvare: il modello va sul cloud al salvataggio.');
    } catch (e) {
      ui.setStatus(`Importazione FALLITA: ${errText(e)}`);
    }
  }

  // Library: every model that uses the file `oldPath`, in every project, now uses `newPath` with the same position, rotation,
  // tilt, scale and name. Colours and edited components are dropped (they point at materials / nodes of the old file).
  async function replaceModel(oldPath: string, newPath: string, newSource?: string, keepLook = false) {
    if (oldPath === newPath) return ui.setStatus('È già lo stesso modello.');
    if (dirty) return ui.setStatus('Salva (o scarta) prima le modifiche al progetto aperto, poi sostituisci.');
    const fresh = await backend.listProjects();
    const hit = fresh.filter((p) => p.models.some((m) => m.path === oldPath));
    if (!hit.length) return ui.setStatus('Nessun progetto usa questo modello: niente da sostituire.');
    const count = hit.reduce((n, p) => n + p.models.filter((m) => m.path === oldPath).length, 0);
    const list = hit.map((p) => `${p.name} (${p.models.filter((m) => m.path === oldPath).length})`).join(', ');
    if (!(await ui.askConfirm(`Sostituire il modello in ${count} posizioni, in questi progetti: ${list}?\nPosizione, rotazione, scala e nome restano; ${keepLook ? 'colori e componenti restano.' : 'colori e componenti modificati si azzerano.'}`, 'Sostituisci', 'Sostituisci il modello'))) return;
    const swap = (m: RoomModel) => {
      if (m.path !== oldPath) return;
      m.path = newPath;
      if (keepLook) return; // the same model, lighter: source, colours and edited components still fit
      if (newSource) m.source = newSource;
      else delete m.source;
      delete m.color;
      delete m.materialColors;
      delete m.finish;
      delete m.materialFinish;
      delete m.parts;
    };
    for (const p of hit) {
      p.models.forEach(swap);
      await backend.saveProject(p.id, { models: p.models });
    }
    for (const p of projects) if (hit.some((h) => h.id === p.id)) p.models.forEach(swap); // the copies the editor holds
    for (const p of hit) for (const m of p.models) broken.delete(m.id);
    ui.setDetails(detailsInfo());
    layer.sync(models());
    resetHistory();
    // The old file is no longer needed (unless some project still uses it): remove it from the cloud right away.
    try {
      if (!oldPath.startsWith('local:') && !(await usage()).has(oldPath)) await library.remove([oldPath]);
    } catch {
      /* the automatic cleanup will take it later */
    }
  }

  // Project names are unique (caps and spaces at the ends do not count): '' when free, else what to tell the user.
  const projectNameError = (name: string, exceptId?: string) =>
    projects.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === name.trim().toLowerCase()) ? `Esiste già un progetto "${name.trim()}": scegli un altro nome.` : '';

  // A CAD plan (DXF) becomes the walls and floors of a project without scanned rooms (its free space).
  async function importPlan(file: File) {
    if (!project) return ui.setStatus('Apri o crea un progetto prima di importare una pianta');
    if (project.roomIds.length) return ui.setStatus('Il progetto ha già stanze scansionate: la pianta CAD va importata in un progetto senza stanze (una cosa o l\'altra).');
    try {
      const info = await withLoading('Leggo la pianta', file.name, async () => parsePlan(await file.text()));
      const names = info.layers.map((l) => l.name);
      const walls = guessWallLayers(names);
      const start: PlanOptions = {
        unit: info.unit,
        wallLayers: walls.length ? walls : names.slice(0, 1),
        floorLayers: guessFloorLayers(names),
        mode: 'double',
        thickness: 0.2,
        height: 2.7,
        boxFloor: true,
      };
      const preview = (o: PlanOptions) => {
        const st = planToStructures(info, o);
        const w = st.filter((x) => x.kind === 'wall').length;
        const f = st.filter((x) => x.kind === 'floor').length;
        return w || f ? `Verranno create ${w} pareti e ${f} pavimenti.` : 'Con queste scelte non viene creato niente: scegli i livelli delle pareti.';
      };
      const o = await ui.askPlan(info, start, preview);
      if (!o) return ui.setStatus('Importazione annullata.');
      const made = planToStructures(info, o);
      if (!made.length) return ui.setStatus('Nessuna parete o pavimento creati.');
      project.structures.push(...made);
      structLayer.sync(structures());
      frameWhenLoaded = true;
      setSelection([]); // also refreshes the outline of the scene
      markDirty();
      commit();
      ui.setStatus(`Pianta importata: ${made.filter((x) => x.kind === 'wall').length} pareti, ${made.filter((x) => x.kind === 'floor').length} pavimenti. Ricorda di salvare.`);
    } catch (e) {
      ui.setStatus(`Importazione della pianta FALLITA: ${errText(e)}`);
    }
  }

  // ---- the UI ----
  const ui = createEditorUi({
    async onOpenProject(id) {
      if (!(await confirmLeave())) return;
      showProject(projects.find((p) => p.id === id) ?? null);
      ui.setView('project');
    },
    projectNameError,
    onCreateProject: (name, roomIds) =>
      run(async () => {
        const chosen = roomIds.map((id) => rooms.find((r) => r.id === id)).filter((r): r is Room => !!r);
        const bad = chosen.map((r, i) => addRoomError(chosen.slice(0, i), r)).find((m) => m);
        if (bad) return ui.setStatus(bad);
        if (!(await confirmLeave())) return;
        const p = await backend.createProject(name, roomIds, [], [], newTone(projects));
        projects.unshift(p);
        showProject(p);
        ui.setView('project');
        ui.setStatus(`Progetto "${name}" creato${p.roomIds.length ? '' : ' senza stanza: carica un modello'}`);
      }),
    async onCloseProject() {
      if (!(await confirmLeave())) return;
      showProject(null);
      ui.setView('home');
    },
    onRenameProject: () =>
      run(async () => {
        if (!project) return;
        const pid = project.id;
        const current = project.name;
        const name = await ui.askText('Nome del progetto', current, { ok: 'Rinomina', validate: (v) => (!v ? 'Scrivi un nome.' : v === current ? '' : projectNameError(v, pid)) });
        if (!name || name === current) return;
        await backend.saveProject(project.id, { name });
        project.name = name;
        refreshLists();
      }),
    // A copy of the project as it is saved in the cloud: the same rooms, models (the same files, nothing is uploaded again) and
    // walls / floors, each with a new id. The copy opens, unless there are unsaved edits here: then it only appears in the list.
    onDuplicateProject: () =>
      run(async () => {
        if (!project) return;
        const saved = (await backend.listProjects()).find((x) => x.id === project!.id);
        if (!saved) return ui.setStatus('Salva prima il progetto: non è ancora sul cloud.');
        if (dirty && !(await ui.askConfirm("Ci sono modifiche non salvate: la copia parte dall'ultima versione salvata.", 'Duplica', 'Duplica progetto'))) return;
        let text = `${saved.name} (copia)`;
        for (let i = 2; projectNameError(text); i++) text = `${saved.name} (copia ${i})`;
        const name = await ui.askText('Nome della copia', text, { ok: 'Duplica', validate: (v) => (!v ? 'Scrivi un nome.' : projectNameError(v)) });
        if (!name) return;
        const models = saved.models.map((m, i) => ({ ...structuredClone(m), id: `${newId()}${i}` }));
        const structs = saved.structures.map((x, i) => ({ ...structuredClone(x), id: `${newId()}s${i}` }));
        const notes = saved.annotations.map((a, i) => copyAnnotation(a, i));
        const copy = await withLoading('Duplico il progetto', saved.name, () => backend.createProject(name, [...saved.roomIds], models, structs, newTone(projects), notes));
        projects.unshift(copy);
        if (dirty) {
          refreshLists();
          return ui.setStatus(`Copia creata: "${name}". La trovi in Apri progetto.`);
        }
        showProject(copy);
        ui.setView('project');
        ui.setStatus(`Copia "${name}" creata: ${copy.models.length} modelli, ${copy.structures.length} pareti/pavimenti.`);
      }),
    onDeleteProject: () =>
      run(async () => {
        if (!project || !(await ui.askConfirm(`Eliminare il progetto "${project.name}"?`, 'Elimina', 'Elimina progetto'))) return;
        await backend.deleteProject(project.id);
        void prune();
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
      const why = addRoomError(projectRoomsList(), r);
      if (why) return ui.setStatus(why);
      project.roomIds.push(id);
      markDirty();
      showRoom(r);
      resetHistory();
    },
    async onRemoveRoom() {
      if (!project || !room || !(await ui.askConfirm(`Togliere la stanza "${room.name}" dal progetto?\nAnche i suoi modelli, pareti e pavimenti vengono tolti.`, 'Togli', 'Togli la stanza'))) return;
      if (!project || !room) return;
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
      else refreshOthers(); // another room: its outline and its models go (or come back)
      refreshLists();
    },
    onUpload: (files) => importFiles(files),
    onImportPlan: (file) => void importPlan(file),
    onRenameRoom: (id) =>
      run(async () => {
        const r = rooms.find((x) => x.id === id);
        if (!r) return;
        const taken = (v: string) => rooms.some((x) => x.id !== id && x.name.trim().toLowerCase() === v.toLowerCase());
        const name = await ui.askText('Nome della stanza', r.name, { ok: 'Rinomina', validate: (v) => (!v ? 'Scrivi un nome.' : v !== r.name && taken(v) ? `Esiste già una stanza chiamata "${v}": scegli un altro nome.` : '') });
        if (!name || name === r.name) return;
        await backend.renameRoom(id, name);
        r.name = name;
        refreshLists();
      }),
    onRoomPlace: (id) =>
      run(async () => {
        const r = rooms.find((x) => x.id === id);
        if (!r) return;
        let why = '';
        const place = await ui.askText('Luogo della stanza', r.place ?? '', {
          ok: 'Salva',
          placeholder: 'Es. Casa mia, Capannone Rossi (vuoto: nessun luogo)',
          text: 'Un progetto usa stanze di un solo luogo. Le stanze dello stesso luogo si ritrovano tra loro e si allineano insieme.',
          suggestions: knownPlaces(rooms),
          validate: (v) => {
            why = placeChangeConflict(id, v || null, rooms, projects);
            return why ? `Il progetto "${why}" usa questa stanza insieme a stanze di un altro luogo.` : '';
          },
        });
        if (place === null || place === (r.place ?? '')) return;
        const spelled = knownPlaces(rooms.filter((x) => x.id !== id)).find((p) => normPlace(p) === normPlace(place)) ?? place; // an existing place under another spelling is the same one
        await backend.setRoomPlace(id, spelled || null);
        r.place = spelled || undefined;
        refreshLists();
      }),
    listVisors: async () => (await backend.pendingDeviceLinks?.()) ?? [],
    onLinkVisor: (code) =>
      run(async () => {
        const res = (await backend.approveDeviceLink?.(code)) ?? { ok: false as const, message: 'Collegamento non disponibile.' };
        ui.setLinkResult(res.ok ? 'Fatto: il visore sta entrando nel tuo account.' : res.message, res.ok);
      }),
    onOpenModels: () =>
      void run(async () => {
        ui.setLibrary(null);
        const r = await prune(); // clean first, so the list is already tidy
        const note = !r
          ? ''
          : r.error
            ? `Pulizia automatica non riuscita: ${r.error}`
            : `Pulizia automatica: ${r.removed} eliminati${r.recent ? `, ${r.recent} non usati ma troppo recenti (restano 24 ore)` : ''}.`;
        await loadLibrary(note);
      }),
    onMissingFromFile: (files) =>
      run(async () => {
        const m = selModels()[0];
        if (!m) return;
        const prepared = await prepareGlb(files);
        if (!prepared) return ui.setStatus('Sostituzione annullata.');
        const file = await lighten([{ key: 'f', name: prepared.base, file: prepared.file }]);
        if (!file) return ui.setStatus('Sostituzione annullata.');
        const { path } = await withLoading('Carico il modello', prepared.file.name, () => upload(file.get('f')!));
        await replaceModel(m.path, path, prepared.source);
        await refreshLibOptions();
      }),
    onMissingFromLibrary: (path) =>
      run(async () => {
        const m = selModels()[0];
        if (!m) return;
        await replaceModel(m.path, path);
      }),
    onReplaceFromFile: (oldPath, files) =>
      run(async () => {
        ui.setStatus(`Preparo ${files[0].name}...`);
        const prepared = await prepareGlb(files);
        if (!prepared) return ui.setStatus('Sostituzione annullata.');
        const file = await lighten([{ key: 'f', name: prepared.base, file: prepared.file }]);
        if (!file) return ui.setStatus('Sostituzione annullata.');
        const { path } = await withLoading('Carico il modello', prepared.file.name, () => upload(file.get('f')!));
        await replaceModel(oldPath, path, prepared.source);
        await loadLibrary('Modello sostituito.');
      }),
    onSimplifyModel: (path) =>
      run(async () => {
        if (dirty) return ui.setStatus('Salva (o scarta) prima le modifiche al progetto aperto, poi semplifica.');
        const used = (await usage()).get(path);
        const name = used ? [...used.names].join(' / ') : path;
        const file = await withLoading('Scarico il modello', name, async () => new File([await (await fetch(await modelUrl(path))).blob()], `${name}.glb`));
        const triangles = await withLoading('Controllo il modello', name, () => glbTrianglesOfFile(file).catch(() => countTriangles(file)));
        if (triangles <= HEAVY_TRIANGLES) return ui.setStatus(`${name} è già abbastanza leggero per il visore.`);
        const choice = await ui.askSimplify([{ id: path, name, triangles }], HEAVY_TRIANGLES, {
          title: 'Semplifica il modello',
          text: `Il modello sarà sostituito, in tutti i progetti che lo usano, dalla versione semplificata (che pesa anche meno): posizione, rotazione, scala, nome e colori restano. L'originale non si conserva.`,
          ok: 'Semplifica',
        });
        if (!choice) return ui.setStatus('Semplificazione annullata.');
        const res = await withLoading('Semplifico il modello', name, (progress) => simplifyGlb(file, HEAVY_TRIANGLES, progress));
        const { path: newPath } = await withLoading('Carico il modello', name, () => upload(res.file));
        await replaceModel(path, newPath, undefined, true);
        await loadLibrary(`${name}: semplificato del ${Math.round((1 - res.after / res.before) * 100)}% (${res.after.toLocaleString('it-IT')} triangoli, ${(res.file.size / 1048576).toFixed(1)} MB).`);
      }),
    onReplaceFromLibrary: (oldPath, newPath) =>
      run(async () => {
        await replaceModel(oldPath, newPath);
        await loadLibrary('Modello sostituito.');
      }),
    onDeleteModel: (path) =>
      run(async () => {
        if (!(await ui.askConfirm('Eliminare questo modello dal cloud? Non si può annullare.', 'Elimina', 'Elimina modello'))) return;
        await library.remove([path]);
        await loadLibrary('Modello eliminato.');
      }),
    onPruneModels: () =>
      run(async () => {
        const used = await usage();
        const files = (await library.list()).filter((f) => !used.has(f.path));
        if (!files.length || !(await ui.askConfirm(`Eliminare ${files.length} modelli non usati da nessun progetto (${sizeText(files.reduce((a, f) => a + f.size, 0))})?\nNon si può annullare.`, 'Elimina', 'Elimina i non usati'))) return;
        await library.remove(files.map((f) => f.path));
        await loadLibrary(`${files.length} modelli eliminati.`);
      }),
    onDeleteRoom: (id) =>
      run(async () => {
        const r = rooms.find((x) => x.id === id);
        const users = projects.filter((p) => p.roomIds.includes(id));
        const note = users.length ? ` Sarà tolta anche dai progetti: ${users.map((p) => p.name).join(', ')} (con i suoi modelli).` : '';
        if (!r || !(await ui.askConfirm(`Eliminare la stanza "${r.name}"?${note}`, 'Elimina', 'Elimina stanza'))) return;
        await backend.deleteRoom(id);
        rooms = rooms.filter((x) => x !== r);
        for (const p of users) {
          p.roomIds = p.roomIds.filter((x) => x !== id);
          p.models = p.models.filter((m) => m.roomId !== id);
          p.structures = p.structures.filter((x) => x.roomId !== id);
          await backend.saveProject(p.id, { roomIds: p.roomIds, models: p.models.filter((m) => !isPendingModel(m.path)), structures: p.structures, annotations: p.annotations }); // models not uploaded yet stay out of the cloud
        }
        void prune();
        if (room === r) showRoom(projectRoomsList()[0] ?? null);
        refreshLists();
        resetHistory();
        ui.setStatus('Stanza eliminata.');
      }),
    onSave: save,
    onBuild(kind) {
      build = kind;
      if (kind) {
        annotMode = null;
        annotFirst = null;
      }
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
    onMeasures(mode) {
      measureMode = mode;
      refreshToolbar();
      ui.setStatus(mode === 'off' ? 'Misure spente.' : 'Misure: dimensioni dell\'oggetto selezionato.');
    },
    onGaps(on) {
      gapsOn = on;
      refreshToolbar();
      ui.setStatus(on ? 'Distanze: dell\'oggetto selezionato dalle pareti.' : 'Distanze spente.');
    },
    // The annotation tools: a note (one click, then its text) or a ruler (two clicks). Clicking the tool again, or Esc, leaves it.
    onAnnot(mode) {
      annotMode = mode;
      annotFirst = null;
      annotCursor = null;
      build = null;
      if (mode) {
        setSelection([]);
        transform.detach();
      }
      refreshToolbar();
    },
    onAnnotText(text, doCommit) {
      const a = findAnnot(selAnnotId);
      if (!a) return;
      a.text = text;
      markDirty();
      if (doCommit) {
        commit();
        refreshOutline();
      }
    },
    onAnnotColor(color) {
      const a = findAnnot(selAnnotId);
      if (!a) return;
      a.color = color;
      markDirty();
      commit();
      refreshAll();
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
    onModelName(name) {
      const m = selModels()[0];
      const n = name.trim();
      if (!m || !n || n === m.name) return refreshAll();
      if (nameTaken(n, m.id)) {
        ui.setStatus(`Esiste già un modello chiamato "${n}" in questo progetto: scegli un altro nome.`);
        return refreshAll();
      }
      m.name = n;
      changed(true);
    },
    onModelTilt(axis, deg, doCommit) {
      const m = selModels()[0];
      if (!m) return;
      const r = (deg * Math.PI) / 180;
      const t: [number, number] = [m.tilt?.[0] ?? 0, m.tilt?.[1] ?? 0];
      t[axis === 'x' ? 0 : 1] = Math.atan2(Math.sin(r), Math.cos(r));
      if (t[0] || t[1]) m.tilt = t;
      else delete m.tilt;
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
        if (edit.align && s.kind === 'wall') s.align = edit.align;
        if (edit.roughness !== undefined || edit.metalness !== undefined) {
          s.finish = { ...s.finish, ...(edit.roughness !== undefined && { roughness: edit.roughness }), ...(edit.metalness !== undefined && { metalness: edit.metalness }) };
        }
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
  // Files dropped on the window are imported like the ones chosen with the button.
  window.addEventListener('dragover', (e) => e.dataTransfer?.types.includes('Files') && e.preventDefault());
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    void importFiles([...e.dataTransfer.files]);
  });

  // ---- annotations: where a click lands, creating them with a click or two, dragging their points ----
  // The point of a model / wall / floor under the pointer (a vertex of the face when one is near), else of the floor plane.
  const SNAP_VERT = 0.06; // m
  function surfacePoint(e: PointerEvent): Vector3 | null {
    ray.setFromCamera(ndcOf(e), camera);
    const firstMesh = (objs: Object3D[]) => ray.intersectObjects(objs, true).find((h) => (h.object as Mesh).isMesh && h.object.visible);
    const hit = firstMesh([...layer.holders.values(), ...structLayer.meshes.values()]) ?? firstMesh([planesGroup]);
    if (hit) {
      const p = hit.point.clone();
      const mesh = hit.object as Mesh;
      const pos = mesh.geometry.getAttribute('position');
      if (snapVertex && hit.face && pos) {
        let best: Vector3 | null = null;
        let bd = SNAP_VERT;
        for (const i of [hit.face.a, hit.face.b, hit.face.c]) {
          const v = new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          const d = v.distanceTo(p);
          if (d < bd) {
            bd = d;
            best = v;
          }
        }
        if (best) return best;
      }
      return p;
    }
    const f = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -floorY()), new Vector3());
    if (!f) return null;
    return snapGrid ? new Vector3(Math.round(f.x / GRID_STEP) * GRID_STEP, f.y, Math.round(f.z / GRID_STEP) * GRID_STEP) : f;
  }
  const toVec3 = (v: Vector3): Vec3 => [v.x, v.y, v.z];

  async function annotClick(e: PointerEvent) {
    const p = surfacePoint(e);
    if (!p || !project || !annotMode) return;
    const keep = e.shiftKey; // Shift: stay in the tool for the next one
    let made: Annotation | null = null;
    if (annotMode === 'note') {
      const text = await ui.askText('Testo della nota', '', { ok: 'Aggiungi', placeholder: 'Scrivi la nota', multiline: true });
      if (text === null) return; // cancelled: nothing is put down
      made = newAnnotation('note', spaceId(), toVec3(p), undefined, text);
    } else if (!annotFirst) {
      annotFirst = toVec3(p);
      refreshToolbar();
      return;
    } else {
      const from = annotFirst;
      if (p.distanceTo(new Vector3(...from)) < 0.01) return ui.setStatus('I due punti coincidono: scegli un altro punto.');
      made = newAnnotation('ruler', spaceId(), from, toVec3(p));
    }
    project.annotations.push(made);
    annotFirst = null;
    annotCursor = null;
    if (!keep) annotMode = null;
    selectAnnot(made.id);
    markDirty();
    commit();
    refreshToolbar();
    ui.setStatus(made.kind === 'note' ? 'Nota aggiunta. Ricorda di salvare.' : `Metro: ${formatLength(annotationLength(made) ?? 0)}. Ricorda di salvare.`);
  }

  renderer.domElement.addEventListener('pointermove', (e) => {
    if (annotMode) {
      const c = surfacePoint(e);
      annotCursor = c ? toVec3(c) : null;
      return;
    }
    if (!annotDrag) return;
    const a = findAnnot(annotDrag.id);
    const p = surfacePoint(e);
    if (!a || !p) return;
    a[annotDrag.pt] = toVec3(p);
    refreshPivot();
    markDirty();
  });
  let annotDrag: { id: string; pt: 'a' | 'b' } | null = null;
  // Dragging one of the selected annotation's points (capture phase, so that the camera does not take the click).
  renderer.domElement.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || annotMode || build || !selAnnotId) return;
      ray.setFromCamera(ndcOf(e), camera);
      const hit = ray.intersectObjects(annotSpheres.filter((m) => m.visible && m.userData.annotId === selAnnotId), false)[0];
      if (!hit) return;
      annotDrag = { id: selAnnotId, pt: hit.object.userData.pt as 'a' | 'b' };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
      e.stopImmediatePropagation();
    },
    true,
  );
  renderer.domElement.addEventListener(
    'pointerup',
    (e) => {
      if (!annotDrag) return;
      annotDrag = null;
      controls.enabled = true;
      commit();
      refreshAll();
      e.stopImmediatePropagation();
    },
    true,
  );

  // ---- 3D view: left click selects (Shift adds); with a Build button on, a drag on the floor draws ----
  const ray = new Raycaster();
  let down: { x: number; y: number } | null = null;
  let drag: { start: Vector3; mesh: Mesh } | null = null;
  const ndcOf = (e: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    return new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  };
  // Point of the room's floor plane under the mouse, snapped to the grid / to the vertices of other structures.
  const floorPoint = (e: PointerEvent, exclude = new Set<string>()) => {
    ray.setFromCamera(ndcOf(e), camera);
    const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -floorY()), new Vector3());
    if (!hit) return null;
    let x = snapGrid ? Math.round(hit.x / GRID_STEP) * GRID_STEP : hit.x;
    let z = snapGrid ? Math.round(hit.z / GRID_STEP) * GRID_STEP : hit.z;
    if (snapVertex) {
      const v = snapToVertex(hit.x, hit.z, exclude);
      if (v) [x, z] = v;
    }
    return new Vector3(x, floorY(), z);
  };
  const draftOf = (a: Vector3, b: Vector3, kind: BuildKind): Pick<Structure, 'kind' | 'a' | 'b' | 'y' | 'height' | 'thickness' | 'align' | 'pts'> => ({
    kind,
    a: [a.x, a.z],
    b: [b.x, b.z],
    y: floorY(),
    height: WALL_HEIGHT,
    thickness: kind === 'wall' ? WALL_THICKNESS : FLOOR_THICKNESS,
    // A wall stands on the left of the line you draw (so drawing along a floor's edge puts its face on the edge); a floor starts as a rectangle.
    ...(kind === 'wall' ? { align: 'left' as const } : { pts: [[a.x, a.z], [b.x, a.z], [b.x, b.z], [a.x, b.z]] as [number, number][] }),
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
    if (handleDrag) return; // the end of a corner drag is handled below
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
    if (annotMode) {
      if (e.button === 0 && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 5) void annotClick(e);
      return;
    }
    if (build) return;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    if (Date.now() - lastDrag < 300 || transform.axis) return;
    ray.setFromCamera(ndcOf(e), camera);
    const annotHit = ray.intersectObjects(annotSpheres.filter((m) => m.visible), false)[0];
    if (annotHit) return pick(`a:${annotHit.object.userData.annotId}`, false);
    const targets: Object3D[] = [...layer.holders.values(), ...structLayer.meshes.values()];
    const hit = ray.intersectObjects(targets, true)[0];
    let o: Object3D | null = hit?.object ?? null;
    while (o && !o.userData.modelId && !o.userData.structureId) o = o.parent;
    pick(o ? (o.userData.modelId ? `m:${o.userData.modelId}` : `s:${o.userData.structureId}`) : null, e.shiftKey || e.ctrlKey || e.metaKey);
  });

  // ---- handles on the corners of the selected wall (its two ends) or floor (every corner; the small ones on the edges add a corner) ----
  const handleGroup = new Group();
  scene.add(handleGroup);
  const handleGeo = new SphereGeometry(1, 16, 12);
  const vertexMat = new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
  const midMat = new MeshBasicMaterial({ color: 0x2ec4ff, depthTest: false, transparent: true, opacity: 0.85 });
  // Colours by state: white / azure at rest, the other one when the pointer is over it, yellow while it is dragged.
  const hoverVertexMat = new MeshBasicMaterial({ color: 0x2ec4ff, depthTest: false, transparent: true });
  const hoverMidMat = new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
  const activeMat = new MeshBasicMaterial({ color: 0xfacc15, depthTest: false, transparent: true });
  let hoverHandle: Mesh | null = null;
  interface Handle {
    mesh: Mesh;
    kind: 'vertex' | 'mid';
    index: number;
  }
  let handles: Handle[] = [];
  let handleSig = '';
  let handleDrag: { id: string; index: number } | null = null;
  const handleTarget = () => (!build && !partSel && sel.length === 1 && sel[0][0] === 's' ? findStructure(sel[0].slice(2)) : null);
  function syncHandles() {
    const s = handleTarget();
    const want: { kind: 'vertex' | 'mid'; index: number; x: number; y: number; z: number }[] = [];
    if (s) {
      const y = s.y + (s.kind === 'wall' ? 0.03 : s.thickness + 0.02);
      if (s.kind === 'wall') want.push({ kind: 'vertex', index: 0, x: s.a[0], y, z: s.a[1] }, { kind: 'vertex', index: 1, x: s.b[0], y, z: s.b[1] });
      else {
        const pts = floorPoints(s);
        pts.forEach((p, index) => want.push({ kind: 'vertex', index, x: p[0], y, z: p[1] }));
        pts.forEach((p, index) => {
          const q = pts[(index + 1) % pts.length];
          want.push({ kind: 'mid', index, x: (p[0] + q[0]) / 2, y, z: (p[1] + q[1]) / 2 });
        });
      }
    }
    const sig = want.map((w) => w.kind[0]).join('');
    if (sig !== handleSig) {
      handleGroup.clear();
      handles = want.map((w) => {
        const mesh = new Mesh(handleGeo, w.kind === 'vertex' ? vertexMat : midMat);
        mesh.renderOrder = 999;
        handleGroup.add(mesh);
        return { mesh, kind: w.kind, index: w.index };
      });
      handleSig = sig;
    }
    // The same size on screen at any distance and for the orthographic view too.
    const k = Math.tan(MathUtils.degToRad(persp.fov / 2));
    want.forEach((w, i) => {
      const h = handles[i];
      const m = h.mesh;
      const active = !!handleDrag && handleDrag.index === h.index && h.kind === 'vertex';
      const hover = hoverHandle === m && !handleDrag;
      m.material = active ? activeMat : hover ? (h.kind === 'vertex' ? hoverVertexMat : hoverMidMat) : h.kind === 'vertex' ? vertexMat : midMat;
      m.position.set(w.x, w.y, w.z);
      m.scale.setScalar(camera.position.distanceTo(m.position) * k * (w.kind === 'vertex' ? 0.017 : 0.011) * (active || hover ? 1.3 : 1));
    });
  }
  const setCorner = (s: Structure, index: number, x: number, z: number) => {
    if (s.kind === 'wall') {
      if (index === 0) s.a = [x, z];
      else s.b = [x, z];
    } else {
      const pts = floorPoints(s).map(([px, pz]) => [px, pz] as [number, number]);
      pts[index] = [x, z];
      s.pts = pts;
      s.a = pts[0];
      s.b = pts[2] ?? pts[pts.length - 1];
    }
  };
  // In the capture phase and stopping the event: where a handle and the gizmo overlap, the handle wins.
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (build || partSel || e.button !== 0) return;
    const s = handleTarget();
    if (!s || !handles.length) return;
    ray.setFromCamera(ndcOf(e), camera);
    const hit = ray.intersectObjects(handles.map((h) => h.mesh), false)[0];
    const h = hit && handles.find((x) => x.mesh === hit.object);
    if (!h) return;
    e.stopImmediatePropagation(); // neither the gizmo nor the orbit start
    let index = h.index;
    if (s.kind === 'floor') {
      const pts = floorPoints(s).map(([px, pz]) => [px, pz] as [number, number]);
      if (h.kind === 'mid') {
        // A new corner in the middle of the edge, dragged at once.
        pts.splice(index + 1, 0, [hit!.object.position.x, hit!.object.position.z]);
        index += 1;
      } else if (e.altKey) {
        if (pts.length > 3) {
          pts.splice(index, 1); // Alt + click on a corner removes it
          s.pts = pts;
          s.a = pts[0];
          s.b = pts[2] ?? pts[pts.length - 1];
          handleDrag = { id: s.id, index: -1 };
          refreshPivot();
          return;
        }
        return ui.setStatus('Un pavimento ha almeno tre spigoli.');
      }
      s.pts = pts;
      s.a = pts[0];
      s.b = pts[2] ?? pts[pts.length - 1];
    } else if (e.altKey) return;
    handleDrag = { id: s.id, index };
    controls.enabled = false;
    renderer.domElement.setPointerCapture(e.pointerId);
  }, true);
  // Hover: the handle under the pointer lights up.
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (handleDrag || drag) return;
    let over: Mesh | null = null;
    if (handles.length && !build && !partSel && e.buttons === 0) {
      ray.setFromCamera(ndcOf(e), camera);
      over = (ray.intersectObjects(handles.map((x) => x.mesh), false)[0]?.object as Mesh | undefined) ?? null;
    }
    hoverHandle = over;
    renderer.domElement.style.cursor = over ? 'pointer' : '';
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!handleDrag || handleDrag.index < 0) return;
    const s = findStructure(handleDrag.id);
    const p = s && floorPoint(e, new Set([s.id])); // snaps to the grid and to the corners of the others
    if (!s || !p) return;
    setCorner(s, handleDrag.index, p.x, p.z);
    structLayer.sync(structures());
    refreshPivot();
    markDirty();
    ui.setDetails(detailsInfo());
  });
  renderer.domElement.addEventListener('pointerup', () => {
    if (!handleDrag) return;
    handleDrag = null;
    controls.enabled = true;
    lastDrag = Date.now();
    structLayer.sync(structures());
    markDirty();
    commit();
    refreshAll();
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
      annotMode = null;
      annotFirst = null;
      annotCursor = null;
      refreshToolbar();
      if (partSel) setPart(partSel.modelId, null); // leave the component, keep the model
      else setSelection([]);
    } else if (!mod && k === 'f' && project) {
      frameSpace(); // F: bring everything into view
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
    if (!(await backend.email())) {
      ui.askLogin({ signIn: (e, p, up) => backend.signIn(e, p, up), signInWith: backend.signInWith?.bind(backend), notice: takeAuthError() });
      return ui.setStatus('Accedi per iniziare.');
    }
    [rooms, projects] = await withLoading('Carico i progetti', undefined, () => Promise.all([backend.listRooms(), backend.listProjects()]));
  } catch (e) {
    return ui.setStatus(`Caricamento FALLITO: ${errText(e)}`);
  }
  for (const p of projects) {
    adoptOrphans(p, rooms); // models of a room that no longer exists stay reachable
    for (const s of p.structures ?? []) bakeXf(s); // what was moved / turned / scaled in the headset is now the shape
  }
  // Projects without a colour yet get a free one and keep it (saved once, without touching "last modified").
  const tones = projectTones(projects);
  for (const p of projects) {
    if (p.tone !== undefined) continue;
    p.tone = tones.get(p.id);
    if (p.tone !== undefined) void backend.saveProject(p.id, { tone: p.tone }).catch(() => undefined);
  }
  refreshLists();
  void prune().then(() => refreshLibOptions()); // at every start: files nobody uses any more (older than a day) go
  ui.setStatus(
    !rooms.length
      ? 'Nessuna stanza salvata: scansionala e salvala dal visore (tab Scan).'
      : projects.length
        ? 'Apri un progetto, o creane uno nuovo.'
        : 'Nessun progetto: creane uno con "Nuovo progetto".',
  );
  return {
    select: (id: string | null) => pick(id ? `m:${id}` : null, false),
    // For the tests: where the gizmo is on screen, which handle the pointer is on, and the yaw of the models.
    debug: () => {
      const v = pivot.position.clone().project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { pivot: [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height], axis: transform.axis, yaws: (project?.models ?? []).map((m) => m.yaw) };
    },
  };
}
