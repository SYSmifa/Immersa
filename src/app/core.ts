import { BackSide, Box3, CircleGeometry, Color, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, Plane, RingGeometry, Raycaster, Scene, ShaderMaterial, SphereGeometry, Vector3, type Object3D } from 'three';
import type { Backend } from '../cloud/backend';
import { alignPlanes, planeNormal, type Alignment } from '../room/align';
import { drawBoxes, drawPlanes } from '../room/draw';
import { buildOccluders, createOccluderMaterial, showOccluders } from '../room/occluders';
import { createStructureLayer, effective, hasXf, structMeasure, type StructureLayer } from '../room/structures';
import { adoptOrphans } from '../room/free';
import { TEXTURES, textureAverage, textureCanvas } from '../room/textures';
import { nodeByPath, partFromMesh, partName, pivotWorld } from '../room/parts';
import { createModelLayer, modelsPending, preloadModels, type ModelLayer } from '../room/modelLayer';
import { floorCentre } from '../room/floor';
import { applySelectionLook, clearSelectionLook, listMaterials, modelSize, pickDistance, surfaceUnder, worldTop } from '../room/selection';
import { roomAround, roomClusters } from '../room/around';
import { isGoodFit, isInside, recognizeRoom, type Recognised } from '../room/recognize';
import type { PartEdit, Project, Room, RoomBox, RoomModel, RoomPlane, Structure } from '../room/types';
import { UiHost } from '../ui3d/host';
import { createKeyboard } from '../ui3d/keyboard';
import { createPoke } from '../ui3d/poke';
import { projectTones, theme } from '../ui3d/theme';
import { layersPreferred } from '../ui3d/layers';
import { hexToHsv, hsvToHex, type Hsv } from '../ui3d/color';
import { buildMenu, fold, MENU_H, MENU_W, PER_PAGE, type MenuActions, type MenuView, type ObjectView, type Tab } from '../ui3d/menu';
import { Panel } from '../ui3d/panel';

export interface Capture {
  available: boolean;
  start(): Promise<void>; // system room scan; resolves when it is over
}
export interface Head {
  pos: Vector3;
  fwd: Vector3;
}
interface Options {
  onLayers?(on: boolean): void; // the Options switch for panels as WebXR layers
  onFps?(on: boolean): void; // the Options switch for the fps readout
  onHand?(hand: 'left' | 'right'): void; // the Options switch for the dominant hand
  scene: Scene;
  backend: Backend;
  signOut(): void;
}

const SPLASH_MS = 2400; // at least this long on screen, to be seen
const MENU_DISTANCE = 0.85;
const OUTLINE_WIDTH = 0.015; // m: thickness of the room outline in the headset
const STALE_RESID = 0.03; // m: a recognised room whose planes fit worse than this has a stale saved scan
const MIN_PLANES = 4; // fewer than this is not a usable room scan
const PENDING_KEY = 'immersa.pendingScanName';
const RESUME_KEY = 'immersa.resumeProject'; // set when the session is restarted after standby
// The model paths of the project open now: after a standby restart their download starts at once (see sessionStarted).
export const LAST_PROJECT_KEY = 'immersa.lastProject';
const LAST_PROJECT_MS = 60 * 60 * 1000;
// Set when we restart the app ourselves (after a standby): the next start shows "Loading…" instead of opening the menu.
const RESTART_KEY = 'immersa.restartedAt';
const restartMark = {
  // `project` = the project that was open when we restarted (null: none, so none must be reopened).
  set(project: string | null) {
    try {
      localStorage.setItem(RESTART_KEY, JSON.stringify({ at: Date.now(), project }));
    } catch {
      /* storage can be unavailable */
    }
  },
  consume(): { project: string | null } | null {
    try {
      const v = JSON.parse(localStorage.getItem(RESTART_KEY) ?? 'null') as { at: number; project: string | null } | null;
      localStorage.removeItem(RESTART_KEY);
      return v && Date.now() - v.at < 180000 ? { project: v.project } : null;
    } catch {
      return null;
    }
  },
};
const HAND_KEY = 'immersa.hand';
export const handPreferred = (): 'left' | 'right' => {
  try {
    return localStorage.getItem(HAND_KEY) === 'left' ? 'left' : 'right';
  } catch {
    return 'right';
  }
};
// Events kept across app restarts (a standby ends the session and restarts the app): what happened, in order.
const LOG_KEY = 'immersa.log';
const readLog = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};
const FPS_KEY = 'immersa.fps';
export const fpsPreferred = () => {
  try {
    return localStorage.getItem(FPS_KEY) === '1';
  } catch {
    return false;
  }
};
const SNAP_KEY = 'immersa.snap';
const readSnap = () => {
  try {
    return localStorage.getItem(SNAP_KEY) !== '0';
  } catch {
    return true;
  }
};
const lastProject = {
  // The model paths are kept too, so their download can start before the project list is back.
  save(id: string, paths: string[] = []) {
    try {
      localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({ id, at: Date.now(), paths }));
    } catch {
      /* storage can be unavailable */
    }
  },
  clear() {
    try {
      localStorage.removeItem(LAST_PROJECT_KEY);
    } catch {
      /* storage can be unavailable */
    }
  },
  recent(): { id: string; paths: string[] } | null {
    try {
      const v = JSON.parse(localStorage.getItem(LAST_PROJECT_KEY) ?? 'null') as { id: string; at: number; paths?: string[] } | null;
      return v && Date.now() - v.at < LAST_PROJECT_MS ? { id: v.id, paths: v.paths ?? [] } : null;
    } catch {
      return null;
    }
  },
};

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const yawOf = (f: Vector3) => Math.atan2(f.x, f.z); // horizontal direction (sin a, cos a)
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Everything the headset app does, independent of how rays and planes arrive
// (WebXR in xrApp.ts, a mouse and fake planes in the UI test harness).
export function createAppCore({ scene, backend, signOut, onLayers, onFps, onHand }: Options) {
  const host = new UiHost();
  scene.add(host.root);
  const rig = new Group(); // menu + keyboard, follows the head
  rig.visible = false;
  host.root.add(rig);
  const menu = new Panel(MENU_W / 1200, MENU_H / 1200, 1200);
  rig.add(menu.mesh);
  host.add(menu);
  const keyboard = createKeyboard(host, host.root, () => lastHead);
  const poke = createPoke(host, keyboard.panel); // typing with the fingers
  // Floating loading card in front of you (not interactive): the animated logo, what is loading and, for a project, how
  // many of its models are in.
  const loading = new Panel(0.56, 0.34, 1200, 'ink');
  loading.animated = true;
  let loadingKey = '';
  const setLoadingText = (text: string, sub?: string, value?: number) => {
    const key = `${text}|${sub ?? ''}|${value ?? ''}`;
    if (key === loadingKey) return;
    loadingKey = key;
    loading.set([{ kind: 'loader', rect: { x: 20, y: 14, w: loading.pxW - 40, h: loading.pxH - 28 }, text, sub, value, size: 30 }]);
  };
  setLoadingText('Carico il progetto');
  loading.mesh.visible = false;
  host.root.add(loading.mesh);
  // Messages while the menu is open sit just under it, so they never cover its widgets (the keyboard is lower still).
  const menuToast = new Panel(0.62, 0.05, 1200, 'clear');
  menuToast.mesh.position.set(0, -MENU_H / 2400 - 0.04, 0.02);
  menuToast.animated = true; // redrawn every frame while shown (it is not in the pointer host)
  menuToast.mesh.visible = false;
  rig.add(menuToast.mesh);
  let toastShown = '';
  function showMenuToast() {
    const on = !!view.message;
    menuToast.mesh.visible = on;
    if (on && toastShown !== view.message) {
      toastShown = view.message;
      menuToast.set([{ kind: 'chip', rect: { x: 0, y: 0, w: menuToast.pxW, h: menuToast.pxH }, text: view.message, size: 22, fill: 'rgba(11,18,32,0.9)', color: '#ffffff' }]);
    }
    if (!on) toastShown = '';
  }
  // Short notice in front of you, shown even with the menu closed (deleted, project loaded / closed).
  const notice = new Panel(0.46, 0.075, 1200, 'clear');
  notice.mesh.visible = false;
  host.root.add(notice.mesh);
  let noticeUntil = 0;
  let noticePlace = false;
  function notify(text: string, ms = 1200) {
    notice.set([{ kind: 'chip', rect: { x: 0, y: 0, w: notice.pxW, h: notice.pxH }, text, size: 30, fill: 'rgba(11,18,32,0.9)', color: '#ffffff' }]);
    noticeUntil = performance.now() + ms;
    noticePlace = true;
    notice.mesh.visible = true;
  }
  // Start-up screen: the cube drawing itself with the Immersa logo in front, nothing behind it (the room shows through).
  const splashPanel = new Panel(0.74, 0.46, 1200, 'clear');
  splashPanel.animated = true;
  splashPanel.mesh.visible = false;
  host.root.add(splashPanel.mesh);
  const showSplash = (since: number, fade: number) =>
    splashPanel.set([{ kind: 'splash', rect: { x: 0, y: 0, w: splashPanel.pxW, h: splashPanel.pxH }, text: '', since, value: fade }]);
  // The same logo over the menu while the list of projects is being fetched.
  const listLoader = new Panel(0.34, 0.3, 1200, 'clear');
  listLoader.animated = true;
  listLoader.set([{ kind: 'loader', rect: { x: 10, y: 4, w: listLoader.pxW - 20, h: listLoader.pxH - 8 }, text: 'Cerco i tuoi progetti', sub: 'Un attimo…', size: 28 }]);
  listLoader.mesh.position.set(0, 0, 0.004);
  listLoader.mesh.visible = false;
  rig.add(listLoader.mesh);

  // The recognised room's frame (only its outline lives here); the alignment maps it onto the session.
  const roomRoot = new Group();
  roomRoot.matrixAutoUpdate = false;
  roomRoot.visible = false;
  scene.add(roomRoot);
  const outline = new Group();
  outline.visible = true;
  roomRoot.add(outline);
  // The open project: one group per room, each in that room's own frame. A room is placed
  // by the alignment of its saved planes to what the headset reports now; rooms that cannot be
  // aligned are hidden (better than showing their models in the wrong place).
  interface House {
    root: Group;
    layer: ModelLayer;
    structs: StructureLayer; // walls and floors built in the PC editor
    occluder: Group; // the room's walls, floor and ceiling as depth-only surfaces
  }
  const occluderMaterial = createOccluderMaterial();
  const houses = new Map<string, House>();

  const view: MenuView = {
    tab: 'scan',
    email: null,
    startup: '',
    authKnown: false,
    loginEmail: '',
    loginPassLen: 0,
    canLink: !!backend.deviceLogin, // the sign-in with a code approved on the PC
    canEmailCode: !!backend.emailCode,
    codeFor: null,
    loginCode: '',
    canGoogle: false, // Google's page ends the AR session: hidden in the headset (a code from the PC / phone does the job); `!!backend.signInWith` would show it again
    linkCode: null,
    roomName: null,
    candidate: null,
    info: '',
    resid: null,
    liveReady: false,
    captureAvailable: false,
    projectName: null,
    fits: [],
    events: [],
    log: readLog(),
    projects: null,
    currentProjectId: null,
    object: null,
    unsaved: false,
    canVisit: false,
    visit: false,
    showLog: false,
    search: '',
    scroll: 0,
    outline: true,
    snap: readSnap(),
    layers: layersPreferred(),
    fps: fpsPreferred(),
    dominant: handPreferred(),
    showOccluders: false,
    message: '',
  };
  let rooms: Room[] = [];
  let roomsLoaded = false;
  let recognised: Recognised | null = null;
  let candidate: Recognised | null = null; // matches the live scan but the user is not inside
  const ignored = new Set<string>(); // rooms the user said are not the one they are in
  let allProjects: Project[] = []; // every project of the account
  let projectsLoaded = false;
  let current: Project | null = null;
  const aligns = new Map<string, Alignment>(); // rooms aligned in this session (stays valid while the session lasts)
  let foreign: { key: string; roomId: string; matrix: Matrix4 } | null = null; // project shown away from its rooms
  let foreignMode = false; // the project was opened with none of its rooms found: shown away from them
  let lastFar = 0;
  let farIndex = 0;
  let resumePending: { id: string; since: number } | null = null; // reopen this project once the rooms are found
  const fits = new Map<string, { resid: number; matched: number; total: number; good: boolean }>(); // last attempt per room, for the Options diagnostics
  const events: string[] = []; // what happened to the XR session (standby, resume, resets), newest last
  const misses = new Map<string, number>(); // consecutive checks that could not find an aligned room any more
  let rawLive: RoomPlane[] = []; // everything the headset reports (may include other rooms)
  let rawBoxes: RoomBox[] = [];
  let live: RoomPlane[] = []; // only the room you are standing in
  let liveBoxes: RoomBox[] = [];
  let lastHere = 0;
  let capture: Capture | null = null;
  let lastTry = 0;
  let switching = 0; // consecutive checks that found another saved room under the head
  let lost = 0; // consecutive checks that found none
  const refreshed = new Set<string>(); // rooms whose saved scan was already renewed in this session
  let stale = 0; // consecutive checks where the recognised room fits poorly
  let scanning = false; // the system room scan is running (the session must not be restarted meanwhile)
  let failedTries = 0; // recognition attempts that found nothing since the last scan / session start
  let readyAt = 0; // don't trust the live planes before this time (a scan just ended)
  let searching = false; // the "looking for the room" card is up
  let autoTab = true;
  let splash: { since: number; endAt: number | null; placed: boolean } | null = null; // the start-up screen with the logo
  let lastHead: Head | null = null;
  let messageTimer: ReturnType<typeof setTimeout> | undefined;

  const pendingName = () => sessionStorage.getItem(PENDING_KEY) === '1';
  const setPendingName = (on: boolean) => (on ? sessionStorage.setItem(PENDING_KEY, '1') : sessionStorage.removeItem(PENDING_KEY));

  function render() {
    menu.set(buildMenu(view, actions));
    showMenuToast();
  }

  function say(text: string, ms = 7000) {
    view.message = text;
    render();
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      if (view.message === text) {
        view.message = '';
        render();
      }
    }, ms);
  }

  function refreshView() {
    view.roomName = recognised?.room.name ?? null;
    view.candidate = candidate?.room.name ?? null;
    view.resid = recognised?.alignment.resid ?? null;
    view.liveReady = live.length >= MIN_PLANES;
    view.info = `Piani qui ${live.length} / visti ${rawLive.length}`;
    view.captureAvailable = !!capture?.available;
    view.canVisit = canVisit(current);
    view.visit = visit;
    const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? '?';
    const here = (p: Project) => !!recognised && p.roomIds.includes(recognised.room.id);
    const tones = projectTones(allProjects);
    view.projects = projectsLoaded
      ? [...allProjects]
          .sort((a, b) => Number(here(b)) - Number(here(a)) || b.updatedAt.localeCompare(a.updatedAt))
          .map((p) => ({ id: p.id, name: p.name, models: p.models.length, rooms: p.roomIds.map(roomName).join(', ') || '(nessuna stanza)', here: here(p), tone: tones.get(p.id) ?? 0 }))
      : null;
    view.projectName = current?.name ?? null;
    view.events = events.slice(-4);
    const listed = current ? rooms.filter((r) => current!.roomIds.includes(r.id)) : rooms;
    view.fits = listed
      .filter((r) => fits.has(r.id))
      .slice(0, 4)
      .map((r) => {
        const f = fits.get(r.id)!;
        return `${r.name}: ${f.good ? 'ok' : 'NO'} ${(f.resid * 100).toFixed(1)} cm ${f.matched}/${f.total}`;
      });
    view.currentProjectId = current?.id ?? null;
    view.unsaved = unsaved && !!current;
    view.object = objectView();
    outline.visible = view.outline && !current; // with a project open the models are the point
    render();
  }

  // ---- the selected model's own menu (floating button above the model) ----
  let selectedId: string | null = null;
  let objectOpen = false;
  let confirmDelete = false;
  const selectedModel = () => (selectedId ? (current?.models.find((x) => x.id === selectedId) ?? null) : null);
  // A wall or floor can be selected too (built in the PC editor): same floating button and object menu.
  let selectedStructId: string | null = null;
  const selectedStruct = () => (selectedStructId ? (current?.structures?.find((x) => x.id === selectedStructId) ?? null) : null);
  const structsOf = (roomId: string) => current?.structures?.filter((x) => x.roomId === roomId) ?? [];
  const structMesh = (st: Structure) => houses.get(st.roomId)?.structs.meshes.get(st.id) ?? null;
  const structName = (st: Structure) => `${st.kind === 'wall' ? 'Parete' : 'Pavimento'} ${structsOf(st.roomId).filter((x) => x.kind === st.kind).indexOf(st) + 1}`;
  const DEFAULT_TINT = { wall: '#e9ecf2', floor: '#c7cdd9' };
  // A component of the selected model (double pinch): moved, turned, scaled and coloured on its own.
  let selectedPart: { modelId: string; path: string } | null = null;
  const partModelOf = () => (selectedPart ? (current?.models.find((x) => x.id === selectedPart!.modelId) ?? null) : null);
  const partHolderOf = () => {
    const m = partModelOf();
    return m ? (houses.get(m.roomId)?.layer.holders.get(m.id) ?? null) : null;
  };
  const partNodeOf = (): Object3D | null => {
    const h = partHolderOf();
    return h && selectedPart ? nodeByPath(h, selectedPart.path) : null;
  };
  const partEditOf = (create = false): PartEdit | undefined => {
    const m = partModelOf();
    if (!m || !selectedPart) return undefined;
    if (create) {
      m.parts ??= {};
      return (m.parts[selectedPart.path] ??= {});
    }
    return m.parts?.[selectedPart.path];
  };
  let colorPage = false; // the object menu shows the colour page
  let colorTarget: 'all' | number = 'all'; // what the colour page changes: every material, or one (index in the list)
  let matPage = 0;
  let pick: Hsv = [0, 0, 1]; // the colour in the picker
  const holderOf = (m: RoomModel) => houses.get(m.roomId)?.layer.holders.get(m.id) ?? null;
  // The colour a material (or everything) shows now: its own override, else the model's tint, else the file's colour.
  function shownColor(m: RoomModel, t: 'all' | number, mats: { color: string }[]): string {
    if (t === 'all') return m.color ?? mats[0]?.color ?? '#ffffff';
    return m.materialColors?.[String(t)] ?? m.color ?? mats[t]?.color ?? '#ffffff';
  }
  function shownFinish(m: RoomModel, t: 'all' | number, mats: { roughness: number; metalness: number }[]) {
    const own = t === 'all' ? undefined : m.materialFinish?.[String(t)];
    const base = t === 'all' ? mats[0] : mats[t];
    return {
      roughness: own?.roughness ?? m.finish?.roughness ?? base?.roughness ?? 0.5,
      metalness: own?.metalness ?? m.finish?.metalness ?? base?.metalness ?? 0,
    };
  }
  function structureView(st: Structure): ObjectView {
    return {
      name: structName(st),
      yawDeg: 0,
      scale: 1,
      size: structMeasure(effective(st)),
      color: st.color ?? null,
      confirmDelete,
      colorPage,
      materials: [],
      target: 'all',
      matPage,
      hsv: pick,
      finish: { roughness: st.finish?.roughness ?? (st.texture ? 1 : 0.9), metalness: st.finish?.metalness ?? 0 },
      structure: {
        kind: st.kind,
        height: st.height,
        thickness: st.thickness,
        texture: st.texture ?? null,
        moved: hasXf(st),
        textures: [{ id: null, name: 'Nessuna', color: st.color ?? DEFAULT_TINT[st.kind] }, ...TEXTURES.map((t) => ({ id: t.id, name: t.name, color: textureAverage(t.id), image: textureCanvas(t.id) ?? undefined }))],
      },
    };
  }
  function partView(): ObjectView | null {
    const m = partModelOf();
    const node = partNodeOf();
    if (!m || !node) return null;
    const e = partEditOf();
    const info = listMaterials(node)[0];
    const color = e?.color ?? m.color ?? info?.color ?? '#ffffff';
    return {
      name: partName(node),
      yawDeg: ((Math.round(((e?.yaw ?? 0) * 180) / Math.PI) % 360) + 360) % 360,
      scale: e?.scale ?? 1,
      size: '',
      color: e?.color ?? null,
      confirmDelete: false,
      colorPage,
      materials: [{ name: 'Tutto il componente', color }],
      target: 'all',
      matPage: 0,
      hsv: pick,
      finish: { roughness: e?.finish?.roughness ?? m.finish?.roughness ?? info?.roughness ?? 0.5, metalness: e?.finish?.metalness ?? m.finish?.metalness ?? info?.metalness ?? 0 },
      part: { model: m.name, moved: !!(e?.d || e?.yaw || (e?.scale && e.scale !== 1)) },
    };
  }
  function objectView(): ObjectView | null {
    if (objectOpen && selectedPart) {
      const v = partView();
      if (v) return v;
    }
    const st = objectOpen ? selectedStruct() : null;
    if (st) return structureView(st);
    const m = objectOpen ? selectedModel() : null;
    if (!m) {
      objectOpen = false;
      confirmDelete = false;
      colorPage = false;
      return null;
    }
    const holder = holderOf(m);
    const dim = holder ? modelSize(holder) : null;
    const mats = holder ? listMaterials(holder) : [];
    if (typeof colorTarget === 'number' && colorTarget >= mats.length) colorTarget = 'all';
    return {
      name: m.name,
      yawDeg: ((Math.round((m.yaw * 180) / Math.PI) % 360) + 360) % 360,
      scale: m.scale,
      size: dim ? `${(dim.x * m.scale).toFixed(2)} × ${(dim.y * m.scale).toFixed(2)} × ${(dim.z * m.scale).toFixed(2)} m` : '',
      color: m.color ?? null,
      confirmDelete,
      colorPage,
      materials: mats.map((x, i) => ({ name: x.name, color: shownColor(m, i, mats) })),
      target: colorTarget,
      matPage,
      hsv: pick,
      finish: shownFinish(m, colorTarget, mats),
    };
  }
  const ask = (title: string, initial = '', opts: { max?: number; secret?: boolean; capital?: boolean } = {}) =>
    new Promise<string | null>((resolve) => keyboard.open({ title, initial, ...opts, onDone: resolve, onCancel: () => resolve(null) }));
  // Start-up timeline (seconds since the page loaded), shown in the Account tab to see where the time goes.
  const marks = new Map<string, number>();
  function mark(name: string) {
    if (marks.has(name)) return;
    marks.set(name, performance.now());
    view.startup = [...marks].map(([k, t]) => `${k} ${(t / 1000).toFixed(1)}s`).join(' · ');
  }
  let awaitingModels: number | null = null; // the project is open and its models are still loading (label stays)
  let gap = false; // after a standby the session's frame and planes are not to be trusted: rooms and models are hidden
  let loginPassword = '';

  // ---- menu placement: in front of you when opened, then eases round when you turn away
  let yaw = 0;
  let height = 0;
  let following = false;
  function placeMenu(head: Head) {
    rig.position.set(head.pos.x + Math.sin(yaw) * MENU_DISTANCE, height, head.pos.z + Math.cos(yaw) * MENU_DISTANCE);
    rig.rotation.set(0, Math.atan2(head.pos.x - rig.position.x, head.pos.z - rig.position.z), 0);
  }
  function openMenu() {
    if (splash || warnOpen) return; // the splash screen is up: the menu opens when it goes
    rig.visible = true;
    if (lastHead) {
      yaw = yawOf(lastHead.fwd);
      height = lastHead.pos.y - 0.12;
      placeMenu(lastHead);
    }
  }
  function closeMenu() {
    keyboard.close();
    rig.visible = false;
    objectOpen = false;
    confirmDelete = false;
    colorPage = false;
    view.object = null;
  }
  function followHead(head: Head, dt: number) {
    if (!rig.visible) return;
    if (Math.hypot(head.fwd.x, head.fwd.z) > 0.3) {
      const d = wrap(yawOf(head.fwd) - yaw);
      if (Math.abs(d) > 0.75) following = true;
      if (following) {
        yaw += d * Math.min(1, dt * 3);
        if (Math.abs(wrap(yawOf(head.fwd) - yaw)) < 0.12) following = false;
      }
    }
    height += (head.pos.y - 0.12 - height) * Math.min(1, dt * 2);
    placeMenu(head);
  }

  // ---- rooms and projects
  // Did a room's alignment really change? Compared where it puts the room's floor centre
  // and in yaw, so that noise of a centimetre or two does not make the room tremble.
  function moved(a: Alignment, b: Alignment, roomId: string): boolean {
    const planes = rooms.find((r) => r.id === roomId)?.scan.planes ?? [];
    const [x, , z] = floorCentre(planes);
    const at = (m: Alignment) => [Math.cos(m.yaw) * x - Math.sin(m.yaw) * z + m.tx, Math.sin(m.yaw) * x + Math.cos(m.yaw) * z + m.tz];
    const [ax, az] = at(a);
    const [bx, bz] = at(b);
    return Math.hypot(ax - bx, az - bz) > 0.02 || Math.abs(wrap(a.yaw - b.yaw)) > 0.0087;
  }

  const alignMatrix = (a: Alignment) => new Matrix4().makeRotationY(-a.yaw).setPosition(a.tx, a.ty, a.tz);
  const modelsOf = (roomId: string) => current?.models.filter((m) => m.roomId === roomId) ?? [];

  function houseFor(roomId: string): House {
    let h = houses.get(roomId);
    if (!h) {
      const root = new Group();
      root.matrixAutoUpdate = false;
      root.visible = false;
      scene.add(root);
      const occluder = buildOccluders(rooms.find((r) => r.id === roomId)?.scan.planes ?? [], occluderMaterial);
      root.add(occluder);
      h = { root, layer: createModelLayer(root, (t) => say(`Modello: ${t}`)), structs: createStructureLayer(root), occluder };
      houses.set(roomId, h);
    }
    return h;
  }

  function closeCurrent() {
    pendingTp = null;
    warnOpen = false;
    warn.mesh.visible = false;
    visit = false;
    view.visit = false;
    sky.visible = ground.visible = tpMarker.visible = false;
    current = null;
    freeFrame = null;
    grab = null;
    wallAngles.clear();
    foreign = null;
    foreignMode = false;
    for (const h of houses.values()) {
      h.layer.sync([]);
      scene.remove(h.root);
    }
    houses.clear();
  }

  // The project's floor centre goes to the recognised room's floor centre (or under your feet),
  // orientation as saved, so the models keep their layout relative to each other.
  function foreignMatrix(roomId: string): Matrix4 {
    const home = rooms.find((r) => r.id === roomId);
    const pivot = home ? floorCentre(home.scan.planes) : ([0, 0, 0] as const);
    if (recognised) {
      const t = floorCentre(recognised.room.scan.planes);
      const shift = new Matrix4().makeTranslation(t[0] - pivot[0], t[1] - pivot[1], t[2] - pivot[2]);
      return alignMatrix(recognised.alignment).multiply(shift);
    }
    const h = lastHead?.pos;
    const floorY = live.find((x) => x.label === 'floor')?.pos[1] ?? (h ? h.y - 1.5 : 0);
    return new Matrix4().makeTranslation((h?.x ?? 0) - pivot[0], floorY - pivot[1], (h?.z ?? 0) - pivot[2]);
  }

  // ---- virtual visit: a plan without scanned rooms (built from a CAD drawing) can be walked through. An opaque sky and ground hide
  // the passthrough (the session stays an AR session), and a pinch on the floor moves the plan under your feet (teleport).
  let visit = false;
  let visitYaw = 0; // how the plan is turned: kept while you teleport
  const sky = new Mesh(
    new SphereGeometry(150, 24, 12),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: { top: { value: new Color(0x6fa8d8) }, horizon: { value: new Color(0xdbe9f3) }, bottom: { value: new Color(0x8f989f) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, min(1.0, -h * 4.0));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  sky.visible = false;
  const ground = new Mesh(new CircleGeometry(120, 48), new MeshBasicMaterial({ color: 0x9aa3a8, side: DoubleSide }));
  ground.rotation.x = -Math.PI / 2;
  ground.visible = false;
  const tpMarker = new Mesh(new RingGeometry(0.16, 0.22, 40), new MeshBasicMaterial({ color: 0x2dd4bf, side: DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
  tpMarker.rotation.x = -Math.PI / 2;
  tpMarker.renderOrder = 999;
  tpMarker.visible = false;
  scene.add(sky, ground, tpMarker);
  let tpSeen = 0; // when the pointer last rested on a floor (the marker hides soon after)
  const canVisit = (p: Project | null) => !!p && p.roomIds.length === 0 && (p.structures ?? []).some((x) => x.roomId === '');
  // Where you start: the middle of the biggest floor (else of the walls), in the plan's own coordinates.
  function visitStart(p: Project): [number, number] {
    const floors = (p.structures ?? []).filter((x) => x.roomId === '' && x.kind === 'floor');
    const list = floors.length ? floors : (p.structures ?? []).filter((x) => x.roomId === '');
    let best: Structure | null = null;
    let area = -1;
    for (const st of list) {
      const a = Math.abs((st.b[0] - st.a[0]) * (st.b[1] - st.a[1]));
      if (a > area) (best = st, area = a);
    }
    return best ? [(best.a[0] + best.b[0]) / 2, (best.a[1] + best.b[1]) / 2] : [0, 0];
  }
  // The plan's frame so that the plan point `at` is under you now, the plan turned by visitYaw.
  function visitFrame(at: [number, number]): Matrix4 {
    const h = lastHead;
    const m = new Matrix4().makeRotationY(visitYaw);
    const v = new Vector3(at[0], 0, at[1]).applyMatrix4(m);
    const floorY = freeFrame ? freeFrame.elements[13] : h ? h.pos.y - 1.6 : 0;
    return m.setPosition((h?.pos.x ?? 0) - v.x, floorY, (h?.pos.z ?? 0) - v.z);
  }
  function setVisit(on: boolean) {
    if (!current || visit === on) return;
    visit = on;
    view.visit = on;
    if (on) {
      const f = new Vector3(lastHead?.fwd.x ?? 0, 0, lastHead?.fwd.z ?? -1);
      if (f.length() < 0.2) f.set(0, 0, -1);
      visitYaw = Math.atan2(-f.x, -f.z); // the plan's "north" (-z) is where you look
      const y = lastHead ? (rawLive.filter((q) => q.label === 'floor' && q.pos[1] < lastHead!.pos.y - 0.3).map((q) => q.pos[1]).sort((a, b) => b - a)[0] ?? lastHead.pos.y - 1.6) : 0;
      freeFrame = new Matrix4().setPosition(0, y, 0);
      freeFrame = visitFrame(visitStart(current));
    } else {
      freeFrame = makeFreeFrame();
      tpMarker.visible = false;
    }
    sky.visible = ground.visible = on;
    syncHouses();
    refreshView();
    closeMenu();
    notify(on ? 'Visita virtuale: punta il pavimento e pizzica per spostarti' : 'Visita virtuale finita', on ? 2600 : 1200);
  }
  // Before the visit starts, a warning card in front of you (the real room is still in view): nothing else works until "Ho capito".
  const warn = new Panel(0.62, 0.4, 1200, 'ink');
  warn.mesh.visible = false;
  host.root.add(warn.mesh);
  host.add(warn);
  let warnOpen = false;
  function closeWarning() {
    warnOpen = false;
    warn.mesh.visible = false;
  }
  function openVisitWarning() {
    if (!current || visit || warnOpen) return;
    warnOpen = true;
    closeMenu();
    selectModel(null);
    selectStruct(null);
    const w = warn.pxW;
    const T = theme();
    warn.set([
      { kind: 'label', rect: { x: 36, y: 30, w: w - 72, h: 50 }, text: 'ATTENZIONE', size: 40, bold: true, color: '#fbbf24' },
      { kind: 'label', rect: { x: 36, y: 96, w: w - 72, h: 170 }, text: 'Durante la visita virtuale non vedi la stanza reale. Resta fermo dove sei e muoviti solo con il laser: se cammini davvero potresti urtare qualcosa o inciampare.', size: 27, color: '#ffffff', wrap: true },
      { kind: 'pill', primary: true, icon: 'check', rect: { x: 36, y: warn.pxH - 112, w: w - 72, h: 70 }, text: 'Ho capito', size: 30, onClick: () => { closeWarning(); setVisit(true); } },
    ]);
    void T;
    if (lastHead) {
      const f = new Vector3(lastHead.fwd.x, 0, lastHead.fwd.z);
      if (f.length() < 0.2) f.set(0, 0, -1);
      f.normalize();
      warn.mesh.position.set(lastHead.pos.x + f.x * 0.9, lastHead.pos.y - 0.05, lastHead.pos.z + f.z * 0.9);
      warn.mesh.rotation.set(0, Math.atan2(lastHead.pos.x - warn.mesh.position.x, lastHead.pos.z - warn.mesh.position.z), 0);
    }
    warn.mesh.visible = true;
  }

  // A pinch on the floor in the visit: it is moved so that the pointed place is under you.
  function teleportTo(world: Vector3) {
    if (!freeFrame || !lastHead) return;
    const local = world.clone().applyMatrix4(freeFrame.clone().invert());
    freeFrame = visitFrame([local.x, local.z]);
    syncHouses();
  }

  // A project without a room (or models placed without one: roomId ''): its "free space" is a frame set where you stand when
  // the project opens, 1.5 m in front of you on the floor, turned like your head. The models appear there.
  let freeFrame: Matrix4 | null = null;
  function makeFreeFrame(): Matrix4 {
    const h = lastHead;
    if (!h) return new Matrix4();
    const f = new Vector3(h.fwd.x, 0, h.fwd.z);
    if (f.length() < 0.2) f.set(0, 0, -1);
    f.normalize();
    // Floor: the highest floor the headset reports below your head, else about a head's height down.
    const below = rawLive.filter((q) => q.label === 'floor' && q.pos[1] < h.pos.y - 0.3).map((q) => q.pos[1]);
    const y = below.length ? Math.max(...below) : h.pos.y - 1.5;
    return new Matrix4().makeRotationY(yawOf(h.fwd)).setPosition(h.pos.x + f.x * 1.5, y, h.pos.z + f.z * 1.5);
  }
  const needsFreeSpace = (p: Project) => p.roomIds.length === 0 || p.models.some((m) => m.roomId === '') || (p.structures ?? []).some((x) => x.roomId === '');

  // Bring the scene in line with the open project and the alignments found so far.
  function syncHouses() {
    if (!current) return;
    const ids = current.roomIds.filter((id) => rooms.some((r) => r.id === id));
    const free = needsFreeSpace(current);
    for (const id of [...houses.keys()]) {
      if (!ids.includes(id) && !(free && id === '')) {
        houses.get(id)!.layer.sync([]);
        scene.remove(houses.get(id)!.root);
        houses.delete(id);
      }
    }
    const aligned = ids.filter((id) => aligns.has(id));
    // Opened with none of its rooms found: show its first room with models anywhere sensible,
    // so the project can still be looked at. Once a room is found, models go to the real places.
    if (aligned.length) foreignMode = false;
    const away = foreignMode ? (ids.find((id) => modelsOf(id).length) ?? ids[0] ?? null) : null;
    const key = away ? `${away}|${recognised?.room.id ?? ''}` : '';
    if (!away) foreign = null;
    else if (foreign?.key !== key) foreign = { key, roomId: away, matrix: foreignMatrix(away) };
    for (const id of ids) {
      const h = houseFor(id);
      const a = aligns.get(id);
      if (a) h.root.matrix.copy(alignMatrix(a));
      else if (foreign?.roomId === id) h.root.matrix.copy(foreign.matrix);
      h.root.visible = !gap && (!!a || foreign?.roomId === id);
      h.occluder.visible = foreign?.roomId !== id; // a room shown away from its place must not hide its own models
      h.layer.sync(modelsOf(id));
      h.structs.sync(current.structures?.filter((x) => x.roomId === id) ?? []);
    }
    if (free) {
      freeFrame ??= makeFreeFrame();
      const h = houseFor('');
      h.root.matrix.copy(freeFrame);
      h.root.visible = !gap;
      h.occluder.visible = false;
      h.layer.sync(modelsOf(''));
      h.structs.sync(current.structures?.filter((x) => x.roomId === '') ?? []);
    }
  }

  // Where the headset reports this room now, if anywhere. Each reported room is tried on its
  // own, so another room's planes cannot confuse the fit.
  function bestFit(room: Room): Alignment | null {
    let fit: Alignment | null = null;
    let any: Alignment | null = null;
    for (const group of roomClusters(rawLive)) {
      if (group.length < MIN_PLANES) continue;
      const a = alignPlanes(room.scan.planes, group);
      if (a && (!any || a.matched / a.total - a.resid > any.matched / any.total - any.resid)) any = a;
      if (isGoodFit(a) && (!fit || a.matched / a.total - a.resid > fit.matched / fit.total - fit.resid)) fit = a;
    }
    if (any) fits.set(room.id, { resid: any.resid, matched: any.matched, total: any.total, good: isGoodFit(any) });
    return fit;
  }

  // Rooms of the open project other than the one under your head: keep them aligned to the planes
  // the headset reports for them (it reports every stored room), one room per call. The headset
  // can move its frame (new boundary, relocalisation), so every alignment is re-checked: updated
  // when the room is found elsewhere, dropped (room hidden) when it cannot be found at all.
  function alignFar(now: number) {
    if (!current || now - lastFar < 1200 || rawLive.length < MIN_PLANES) return;
    lastFar = now;
    const ids = current.roomIds.filter((id) => id !== recognised?.room.id && rooms.some((r) => r.id === id));
    if (!ids.length) return;
    const room = rooms.find((r) => r.id === ids[farIndex++ % ids.length])!;
    const fit = bestFit(room);
    const old = aligns.get(room.id);
    if (fit) {
      misses.delete(room.id);
      if (!old || moved(old, fit, room.id)) {
        aligns.set(room.id, fit);
        syncHouses();
        refreshView();
      }
    } else if (old) {
      const n = (misses.get(room.id) ?? 0) + 1;
      misses.set(room.id, n);
      if (n >= 2) {
        aligns.delete(room.id); // not where we left it and not found anywhere: do not show it misplaced
        misses.delete(room.id);
        syncHouses();
        refreshView();
      }
    }
  }

  function failResume() {
    loading.mesh.visible = false;
    openMenu();
    say('Project reload failed', 10000);
  }

  let closeWarnedAt = 0;
  let unsaved = false; // models moved in the headset, not yet saved to the account

  function loadProjects() {
    backend
      .listProjects()
      .then((list) => {
        allProjects = list;
        projectsLoaded = true;
        if (current) current = list.find((p) => p.id === current!.id) ?? current;
        const resuming = resumePending && list.find((p) => p.id === resumePending!.id);
        if (resuming) preloadModels(resuming.models.map((m) => m.path)); // first launch: no cached paths yet
        refreshView();
      })
      .catch((e) => say(`Errore: ${errText(e)}`));
  }

  function setRecognised(r: Recognised | null) {
    recognised = r;
    outline.clear();
    if (r) {
      gap = false; // found again: trust the session
      mark('stanza');
    }
    roomRoot.visible = !!r;
    if (r) {
      const a = r.alignment;
      aligns.set(r.room.id, a); // stays valid after we walk out of the room
      // three's Y rotation is the opposite sense of our xz yaw.
      roomRoot.matrix.makeRotationY(-a.yaw).setPosition(a.tx, a.ty, a.tz);
      drawPlanes(r.room.scan.planes, outline, false, r.room.scan.boxes ?? [], false, OUTLINE_WIDTH); // no floor outline: it only confuses
      drawBoxes(r.room.scan.boxes ?? [], outline, false, OUTLINE_WIDTH);
      if (autoTab) view.tab = 'load';
    }
    syncHouses();
    loadProjects();
    refreshView();
  }

  // Walking into another room changes which room we are in: leave the old one after a few
  // consecutive checks (no flicker in doorways), switch to the new saved one, remember the project.
  function reconsider(found: Recognised | null) {
    if (found && found.room.id === recognised!.room.id) {
      switching = lost = 0;
      stale = found.alignment.resid > STALE_RESID ? stale + 1 : 0;
      if (stale >= 3 && !refreshed.has(found.room.id)) {
        stale = 0;
        return void refreshRoomScan(found);
      }
      const wasGap = gap;
      gap = false;
      roomRoot.visible = true;
      if (wasGap || moved(recognised!.alignment, found.alignment, found.room.id)) {
        // The headset moved the room: follow it.
        recognised!.alignment = found.alignment;
        aligns.set(found.room.id, found.alignment);
        roomRoot.matrix.copy(alignMatrix(found.alignment));
        syncHouses();
      }
    } else if (found) {
      lost = 0;
      if (++switching >= 2) {
        switching = 0;
        setRecognised(found);
        openMenu();
      }
    } else {
      switching = 0;
      if (++lost >= 3) {
        lost = 0;
        setRecognised(null);
      }
    }
  }

  function tryRecognise(now: number) {
    if (!roomsLoaded || !lastHead || now < readyAt || now - lastTry < 2500) return;
    lastTry = now;
    // The session reports no planes at all (e.g. after a standby): that is a gap in the data, not you leaving the
    // room, so the recognised room and its alignment stay as they are until the planes come back.
    if (recognised && rawLive.length === 0) return;
    const h = lastHead.pos;
    const found =
      live.length >= MIN_PLANES
        ? recognizeRoom(live, rooms.filter((x) => !ignored.has(x.id)), (room, a) => {
            if (a) fits.set(room.id, { resid: a.resid, matched: a.matched, total: a.total, good: isGoodFit(a) });
          })
        : null;
    const inside = !!found && isInside(found, [h.x, h.y, h.z]);
    if (recognised) return reconsider(found && inside ? found : null);
    if (live.length < MIN_PLANES) return;
    if (!found) {
      candidate = null;
      failedTries++;
      return refreshView();
    }
    if (inside) {
      candidate = null;
      return setRecognised(found);
    }
    // The headset reports this room's planes, but you are not in it: ask instead of assuming.
    const first = !candidate;
    candidate = found;
    failedTries++;
    if (first && autoTab) view.tab = 'scan';
    refreshView();
  }

  const identity = (n: number): Alignment => ({ yaw: 0, tx: 0, ty: 0, tz: 0, resid: 0, matched: n, total: n });

  // Room names are unique (compared without caps or spaces at the ends): a name already in use asks for another one.
  const nameTaken = (name: string, exceptId?: string) => rooms.some((r) => r.id !== exceptId && r.name.trim().toLowerCase() === name.trim().toLowerCase());
  async function askRoomName(title: string, initial: string, exceptId?: string): Promise<string | null> {
    let text = initial;
    let t = title;
    for (;;) {
      const name = (await ask(t, text))?.trim();
      if (!name) return null;
      if (!nameTaken(name, exceptId)) return name;
      text = name;
      t = `"${name}" esiste già: scegli un altro nome`;
    }
  }

  async function saveRoom() {
    const planes = live; // the scan as it is now, even if the list changes while typing
    const boxes = liveBoxes;
    if (planes.length < MIN_PLANES) return say('Nessuna scansione da salvare');
    const name = await askRoomName('Nome della stanza', '');
    if (!name) return;
    say('Salvo la stanza...');
    try {
      const room = await backend.createRoom(name, { version: 1, savedAt: Date.now(), planes, boxes });
      rooms.unshift(room);
      setRecognised({ room, alignment: identity(planes.length) });
      say(`Stanza "${name}" salvata`);
    } catch (e) {
      say(`Salvataggio fallito: ${errText(e)}`);
    }
  }

  async function renameRoom() {
    if (!recognised) return;
    const room = recognised.room;
    const name = await askRoomName('Nome della stanza', room.name, room.id);
    if (!name || name === room.name) return;
    try {
      await backend.renameRoom(room.id, name);
      room.name = name;
      refreshView();
      say('Stanza rinominata');
    } catch (e) {
      say(`Errore: ${errText(e)}`);
    }
  }

  // The saved scan no longer matches what the headset reports (the room was scanned again, or the
  // headset's copy moved): the live planes are the truth, so store them as the room's scan (same id and
  // name; the old scan is kept as a backup) and move the models so they stay put relative to the room.
  async function refreshRoomScan(r: Recognised) {
    const { room, alignment: a } = r;
    const planes = live;
    const boxes = liveBoxes;
    if (planes.length < MIN_PLANES) return;
    refreshed.add(room.id);
    const m = alignMatrix(a);
    const convert = (x: RoomModel): RoomModel => {
      if (x.roomId !== room.id) return x;
      const v = new Vector3(...x.pos).applyMatrix4(m);
      return { ...x, pos: [v.x, v.y, v.z], yaw: x.yaw - a.yaw };
    };
    const scan = { version: 1 as const, savedAt: Date.now(), planes, boxes };
    const affected = allProjects.filter((p) => p.models.some((x) => x.roomId === room.id));
    try {
      await backend.updateRoomScan(room.id, scan, room.scan);
      for (const p of affected) await backend.saveProject(p.id, { models: p.models.map(convert) });
    } catch (e) {
      refreshed.delete(room.id);
      return say(`Room update failed: ${errText(e)}`);
    }
    room.scan = scan;
    for (const p of affected) p.models = p.models.map(convert);
    const h = houses.get(room.id); // its invisible walls were built from the old scan
    if (h) {
      h.layer.sync([]);
      scene.remove(h.root);
      houses.delete(room.id);
    }
    setRecognised({ room, alignment: identity(planes.length) });
  }

  async function startScan() {
    if (!capture?.available) return say('Scansione non disponibile in questo browser');
    setPendingName(true); // after the scan (even if the session restarts) ask for a name
    say('Scansione in corso...', 60000);
    closeMenu();
    scanning = true;
    try {
      await capture.start();
    } catch (e) {
      scanning = false;
      setPendingName(false);
      openMenu();
      return say(`Scansione non riuscita: ${errText(e)}`);
    }
    scanning = false;
    lastTry = 0;
    failedTries = 0;
    readyAt = performance.now() + 2500; // let the new planes arrive
    openMenu();
    say('Scansione finita, leggo la stanza...');
  }

  // After a scan: once the new planes arrive, offer to name and save the room.
  function checkPending() {
    if (!pendingName() || !roomsLoaded || live.length < MIN_PLANES || keyboard.isOpen()) return;
    if (recognised) {
      // Scanned again a room we already know: wait for the new planes, then renew its saved scan.
      if (performance.now() < readyAt + 1500 || lastTry < readyAt) return;
      setPendingName(false);
      return void refreshRoomScan(recognised);
    }
    if (failedTries < 1) return; // recognition has not had its chance yet
    setPendingName(false);
    view.tab = 'scan';
    openMenu();
    void saveRoom();
  }

  function openProject(p: Project) {
    closeCurrent();
    unsaved = false;
    adoptOrphans(p, rooms); // models of a room that no longer exists go to the free space
    current = p;
    // Align every room of the project now (the headset reports them all), so it opens in the right places.
    for (const id of p.roomIds) {
      const room = rooms.find((r) => r.id === id);
      if (!room || aligns.has(id)) continue;
      const fit = bestFit(room);
      if (fit) aligns.set(id, fit);
    }
    foreignMode = !p.roomIds.some((id) => aligns.has(id));
    freeFrame = needsFreeSpace(p) ? makeFreeFrame() : null;
    lastProject.save(p.id, p.models.map((x) => x.path));
    mark('progetto');
    syncHouses();
    closeMenu();
    refreshView();
    if (p.models.length) {
      awaitingModels = performance.now(); // the card stays until every model is in
      setLoadingText('Carico il progetto', `Modelli 0 / ${p.models.length}`, 0);
      loading.mesh.visible = true;
    }
    if (p.roomIds.length === 0) say(`Aperto: ${p.name} · senza stanza: ${p.models.length} ${p.models.length === 1 ? 'modello' : 'modelli'} davanti a te`, 9000);
    else if (foreign) say(`Aperto: ${p.name} (nessuna sua stanza è qui: posizione e orientamento approssimativi)`, 9000);
  }

  const actions: MenuActions = {
    async askEmail() {
      const v = await ask('Email', view.loginEmail, { max: 64, capital: false });
      if (v !== null) view.loginEmail = v;
      render();
    },
    async askPassword() {
      const v = await ask('Password', '', { max: 64, secret: true, capital: false });
      if (v !== null) {
        loginPassword = v;
        view.loginPassLen = v.length;
      }
      render();
    },
    async startEmailCode() {
      const email = (view.codeFor ?? view.loginEmail).trim();
      if (!email) return say('Scrivi prima la tua email, qui sopra.', 5000);
      const res = await backend.emailCode!.send(email);
      if (!res.ok) return say(res.message, 9000);
      view.codeFor = email;
      view.loginCode = '';
      render();
      say(`Codice inviato a ${email}`, 5000);
    },
    async askCode() {
      const v = await ask('Codice dall\'email', view.loginCode, { max: 10, capital: false });
      if (v !== null) view.loginCode = v.replace(/\s/g, '');
      render();
    },
    async submitCode() {
      if (!view.codeFor) return;
      const res = await backend.emailCode!.verify(view.codeFor, view.loginCode);
      if (!res.ok) return say(res.message, 9000);
      view.codeFor = null;
      view.loginCode = '';
      await reloadRooms();
      loadProjects();
      view.tab = 'load';
      render();
    },
    backFromCode() {
      view.codeFor = null;
      view.loginCode = '';
      render();
    },
    signInGoogle() {
      // Google's page is a normal web page: the immersive session ends and the app must be opened again once signed in.
      say('Ti porto su Google. Finito l\'accesso, riapri Immersa dalla Libreria.', 6000);
      setTimeout(() => void backend.signInWith?.('google').then((r) => !r.ok && say(r.message, 9000)), 1500);
    },
    async startLink() {
      const res = await backend.deviceLogin!.start();
      if (!res.ok) return say(res.message, 9000);
      view.linkCode = res.code;
      linkPolledAt = 0;
      render();
    },
    cancelLink() {
      backend.deviceLogin?.cancel();
      view.linkCode = null;
      render();
    },
    async signIn(signUp: boolean) {
      if (!view.loginEmail.trim() || !loginPassword) return say('Scrivi email e password.', 5000);
      const res = await backend.signIn(view.loginEmail, loginPassword, signUp);
      if (!res.ok) return say(res.message, 9000);
      loginPassword = '';
      view.loginPassLen = 0;
      await reloadRooms();
      loadProjects();
      view.tab = 'load';
    },
    setTab(tab: Tab) {
      view.tab = tab;
      view.showLog = false;
      autoTab = false;
      render();
    },
    // Always reads the project again from the account: edits made on the PC since the list was loaded show up, and
    // moves that were never saved are dropped.
    async selectProject(id) {
      if (current?.id === id) return; // already open: reloading it would drop the unsaved changes
      try {
        allProjects = await backend.listProjects();
      } catch (e) {
        say(`Aggiornamento fallito, uso la copia che ho: ${errText(e)}`, 6000);
      }
      const p = allProjects.find((x) => x.id === id);
      if (p) openProject(p);
    },
    saveChanges,
    toggleVisit() {
      if (visit) setVisit(false);
      else openVisitWarning();
    },
    toggleLog() {
      view.showLog = !view.showLog;
      render();
    },
    askSearch() {
      // The list is filtered after every key; OK or closing the keyboard keeps the filter.
      const apply = (text: string) => {
        view.search = text.trim();
        view.scroll = 0;
        render();
      };
      keyboard.open({ title: 'Cerca un progetto', initial: view.search, max: 30, capital: false, allowEmpty: true, onChange: apply, onDone: apply, onCancel: () => undefined });
    },
    clearSearch() {
      view.search = '';
      view.scroll = 0;
      render();
    },
    setScroll(fraction) {
      // The thumb follows the pointer: the pointed height, centred on the thumb, gives the position in the list.
      const list = view.projects?.filter((p) => !view.search || fold(p.name).includes(fold(view.search))) ?? [];
      if (list.length <= PER_PAGE) return;
      const span = PER_PAGE / list.length;
      view.scroll = Math.min(1, Math.max(0, (fraction - span / 2) / (1 - span)));
      render();
    },
    confirmCandidate() {
      if (!candidate) return;
      const r = candidate;
      candidate = null;
      setRecognised(r);
    },
    notThisRoom() {
      const id = recognised?.room.id ?? candidate?.room.id;
      if (id) ignored.add(id);
      candidate = null;
      setRecognised(null); // keeps recognising the other rooms, but not this one again
      say('Ok. Scansiona o salva la stanza in cui sei.');
    },
    saveRoom: () => void saveRoom(),
    renameRoom: () => void renameRoom(),
    scan: () => void startScan(),
    reread() {
      lastTry = 0;
      failedTries = 0;
    },
    async objRotation() {
      if (selectedPart) {
        const text = await ask('Rotazione del componente (gradi)', String(view.object?.yawDeg ?? 0), { max: 7, capital: false });
        const n = parseNumber(text);
        if (n === null) return text === null ? undefined : say('Numero non valido', 4000);
        partEditOf(true)!.yaw = wrap((n * Math.PI) / 180);
        return applyPartChange();
      }
      const m = selectedModel();
      if (!m) return;
      const text = await ask('Rotazione (gradi)', String(view.object?.yawDeg ?? 0), { max: 7, capital: false });
      if (text === null) return;
      const n = parseNumber(text);
      if (n === null) return say('Numero non valido', 4000);
      m.yaw = wrap((n * Math.PI) / 180);
      applyModelChange(m);
    },
    async objScale() {
      if (selectedPart) {
        const text = await ask('Scala del componente (1 = come nel file)', String(Number((partEditOf()?.scale ?? 1).toFixed(3))), { max: 8, capital: false });
        const n = parseNumber(text);
        if (n === null || n <= 0) return text === null ? undefined : say('Scala non valida (deve essere maggiore di 0)', 4000);
        partEditOf(true)!.scale = Math.min(20, Math.max(0.05, n));
        return applyPartChange();
      }
      const m = selectedModel();
      if (!m) return;
      const text = await ask('Scala (1 = dimensione reale)', String(Number(m.scale.toFixed(3))), { max: 8, capital: false });
      if (text === null) return;
      const n = parseNumber(text);
      if (n === null || n <= 0) return say('Scala non valida (deve essere maggiore di 0)', 4000);
      m.scale = Math.min(100, Math.max(0.01, n));
      applyModelChange(m);
    },
    // Colour: preset or "Orig." (null) for the chosen target.
    objColor(hex: string | null) {
      if (selectedPart) {
        if (hex) pick = hexToHsv(hex);
        return setPartColor(hex);
      }
      const st = selectedStruct();
      if (st) {
        if (hex) pick = hexToHsv(hex);
        return setStructColor(st, hex);
      }
      const m = selectedModel();
      if (!m) return;
      if (hex) pick = hexToHsv(hex);
      setColor(m, hex);
    },
    objOpenColor() {
      if (selectedPart) {
        colorPage = true;
        colorTarget = 'all';
        matPage = 0;
        const node = partNodeOf();
        const m = partModelOf();
        pick = hexToHsv(partEditOf()?.color ?? m?.color ?? (node ? listMaterials(node)[0]?.color : undefined) ?? '#ffffff');
        return refreshView();
      }
      const st = selectedStruct();
      if (st) {
        colorPage = true;
        matPage = 0;
        pick = hexToHsv(st.color ?? DEFAULT_TINT[st.kind]);
        return refreshView();
      }
      const m = selectedModel();
      if (!m) return;
      colorPage = true;
      colorTarget = 'all';
      matPage = 0;
      const h = holderOf(m);
      pick = hexToHsv(shownColor(m, 'all', h ? listMaterials(h) : []));
      refreshView();
    },
    objColorBack() {
      colorPage = false;
      refreshView();
    },
    objColorTarget(t: 'all' | number) {
      const m = selectedModel();
      if (!m) return;
      colorTarget = t;
      const h = holderOf(m);
      pick = hexToHsv(shownColor(m, t, h ? listMaterials(h) : []));
      refreshView();
    },
    objMatPage(delta: number) {
      matPage = Math.max(0, matPage + delta);
      refreshView();
    },
    objFinish(key: 'roughness' | 'metalness', value: number) {
      const sel = selectedStruct();
      if (sel && !selectedPart) {
        sel.finish = { ...sel.finish, [key]: value };
        return applyStructChange(sel);
      }
      if (selectedPart) {
        const e = partEditOf(true)!;
        e.finish = { ...e.finish, [key]: value };
        return applyPartChange();
      }
      const m = selectedModel();
      if (m) setFinish(m, key, value);
    },
    // Wheel (hue, saturation) and brightness bar: a null part stays as it is.
    objPick(h: number | null, sat: number | null, v: number | null) {
      if (selectedPart) {
        pick = [h ?? pick[0], sat ?? pick[1], v ?? pick[2]];
        return setPartColor(hsvToHex(...pick));
      }
      const st = selectedStruct();
      if (st) {
        pick = [h ?? pick[0], sat ?? pick[1], v ?? pick[2]];
        return setStructColor(st, hsvToHex(...pick));
      }
      const m = selectedModel();
      if (!m) return;
      pick = [h ?? pick[0], sat ?? pick[1], v ?? pick[2]];
      setColor(m, hsvToHex(...pick));
    },
    objDelete() {
      confirmDelete = true;
      refreshView();
    },
    objDeleteNo() {
      confirmDelete = false;
      refreshView();
    },
    async objHeight() {
      const st = selectedStruct();
      if (!st) return;
      const n = parseNumber(await ask('Altezza (metri)', String(Number(st.height.toFixed(3))), { max: 6, capital: false }));
      if (n === null || n <= 0) return say('Altezza non valida (deve essere maggiore di 0)', 4000);
      st.height = Math.min(20, Math.max(0.05, n));
      applyStructChange(st);
    },
    async objThickness() {
      const st = selectedStruct();
      if (!st) return;
      const n = parseNumber(await ask('Spessore (centimetri)', String(Number((st.thickness * 100).toFixed(1))), { max: 6, capital: false }));
      if (n === null || n <= 0) return say('Spessore non valido (deve essere maggiore di 0)', 4000);
      st.thickness = Math.min(2, Math.max(0.005, n / 100));
      applyStructChange(st);
    },
    objTexture(id: string | null) {
      const st = selectedStruct();
      if (!st) return;
      if (id) st.texture = id;
      else delete st.texture;
      applyStructChange(st);
    },
    objReset() {
      const sel = selectedStruct();
      if (sel && !selectedPart) {
        delete sel.xf; // back to the shape it has in the project
        applyStructChange(sel);
        return;
      }
      const m = partModelOf();
      const e = partEditOf();
      if (!m?.parts || !e || !selectedPart) return;
      delete e.d;
      delete e.yaw;
      delete e.scale;
      if (!Object.keys(e).length) delete m.parts[selectedPart.path];
      if (!Object.keys(m.parts).length) delete m.parts;
      applyPartChange();
    },
    objExitPart() {
      selectedPart = null;
      if (objectOpen) closeMenu();
      refreshView();
    },
    objDeleteYes() {
      const st = selectedStruct();
      if (st && current) {
        current.structures = current.structures.filter((x) => x.id !== st.id);
        const name = structName(st);
        selectedStructId = null;
        objectOpen = false;
        confirmDelete = false;
        houses.get(st.roomId)?.structs.sync(structsOf(st.roomId));
        markUnsaved();
        closeMenu(); // deleted: the menu goes away altogether, it does not fall back to the main one
        refreshView();
        return notify(`Eliminato: ${name}`);
      }
      const m = selectedModel();
      if (!m || !current) return;
      current.models = current.models.filter((x) => x.id !== m.id);
      selectedId = null;
      objectOpen = false;
      confirmDelete = false;
      selectedPart = null;
      houses.get(m.roomId)?.layer.sync(modelsOf(m.roomId)); // removes it from the scene
      markUnsaved();
      closeMenu(); // deleted: the menu goes away altogether, it does not fall back to the main one
      refreshView();
      notify(`Eliminato: ${m.name}`);
    },
    objClose() {
      objectOpen = false;
      confirmDelete = false;
      refreshView();
    },
    toggleHand() {
      view.dominant = view.dominant === 'right' ? 'left' : 'right';
      try {
        localStorage.setItem(HAND_KEY, view.dominant);
      } catch {
        /* storage can be unavailable */
      }
      onHand?.(view.dominant);
      refreshView();
    },
    toggleFps() {
      view.fps = !view.fps;
      try {
        localStorage.setItem(FPS_KEY, view.fps ? '1' : '0');
      } catch {
        /* storage can be unavailable */
      }
      onFps?.(view.fps);
      refreshView();
    },
    toggleLayers() {
      view.layers = !view.layers;
      onLayers?.(view.layers);
      refreshView();
    },
    toggleSnap() {
      view.snap = !view.snap;
      try {
        localStorage.setItem(SNAP_KEY, view.snap ? '1' : '0');
      } catch {
        /* storage can be unavailable */
      }
      refreshView();
    },
    toggleOutline() {
      view.outline = !view.outline;
      refreshView();
    },
    toggleOccluders() {
      view.showOccluders = !view.showOccluders;
      showOccluders(occluderMaterial, view.showOccluders);
      render();
    },
    closeProject() {
      // Moves made in the headset and not saved would be lost: the first press only warns, a second one (within a few
      // seconds) closes anyway.
      if (unsaved && performance.now() - closeWarnedAt > 4000) {
        closeWarnedAt = performance.now();
        return say('Modifiche non salvate: premi di nuovo Chiudi per scartarle', 4000);
      }
      closeWarnedAt = 0;
      unsaved = false;
      lastProject.clear();
      closeCurrent();
      refreshView();
      say('Progetto chiuso', 2500); // the menu is open here: the card under it
    },
    signOut,
    close: closeMenu,
  };

  async function saveChanges() {
    if (!current || !unsaved) return;
    const p = current;
    try {
      await backend.saveProject(p.id, { models: p.models, structures: p.structures });
      if (current === p) unsaved = false;
      refreshView();
      say('Modifiche salvate', 3000);
    } catch (e) {
      say(`Salvataggio fallito: ${errText(e)}`);
    }
  }

  // Model selection: a pointing hand (ray) hovers the model it points at; a pinch selects it (azure outline).
  const hovered = new Map<string, string>(); // pointer id -> model id ('s:<id>' for a wall / floor)
  const structRay = new Raycaster();
  const partRay = new Raycaster();
  let lastPress: { id: string; t: number } | null = null; // for the double pinch
  const hoverPoint = new Map<string, Vector3>(); // pointer id -> where its ray meets the wall / floor it hovers
  let structHit: Vector3 | null = null; // where the selected wall / floor was pinched: the "Oggetto" button floats there
  let looked: { key: string; node: Object3D } | null = null;

  function selectStruct(id: string | null) {
    if (id === selectedStructId) return;
    selectedStructId = id;
    if (id) selectedId = null;
    if (objectOpen) closeMenu(); // another one (or nothing) pinched: the menu goes, the button shows on the new one
  }
  function selectPart(modelId: string, path: string) {
    if (selectedPart?.modelId === modelId && selectedPart.path === path) return;
    if (objectOpen) closeMenu();
    selectedStructId = null;
    selectedId = modelId;
    selectedPart = { modelId, path };
  }
  function selectModel(id: string | null) {
    if (selectedPart && id !== selectedId) selectedPart = null;
    if (id && selectedStructId) selectedStructId = null;
    if (id === selectedId) return;
    if (id && objectOpen) closeMenu(); // another model pinched while a menu is open: it closes
    selectedId = id;
    if (!id && objectOpen) closeMenu(); // nothing selected any more: the object's menu goes away
  }

  // Keeps the outline on the selected model's holder (and only there); the model may still be loading.
  function syncOutline() {
    if (selectedStructId && !current?.structures?.some((x) => x.id === selectedStructId)) selectedStructId = null;
    // While the object menu is open the real colours must show, so no glow then.
    const glowId = objectOpen ? null : selectedStructId;
    for (const h of houses.values()) h.structs.highlight(glowId);
    if (selectedId && !current?.models.some((m) => m.id === selectedId)) selectedId = null;
    if (selectedPart && !partNodeOf()) selectedPart = null;
    // While the object menu is open the model shows its real colours (the azure look would hide a colour change).
    const lookKey = objectOpen ? null : selectedPart ? `p:${selectedPart.modelId}:${selectedPart.path}` : selectedId ? `m:${selectedId}` : null;
    if (looked && looked.key !== lookKey) {
      clearSelectionLook(looked.node);
      looked = null;
    }
    if (!lookKey || looked) return;
    const m = current?.models.find((x) => x.id === selectedId);
    const node = selectedPart ? partNodeOf() : m && houses.get(m.roomId)?.layer.holders.get(m.id);
    if (node && applySelectionLook(node)) looked = { key: lookKey, node };
  }

  // Per frame and per pointer: UI first (the nearest panel wins), else the nearest model in front of it.
  // Returns where the laser ends and what it points at.
  function aim(id: string, origin: Vector3, dir: Vector3): { length: number; target: 'panel' | 'model' | 'none' } {
    const panelDist = host.setRay(id, origin, dir);
    hovered.delete(id);
    hoverPoint.delete(id);
    rays.set(id, { origin: origin.clone(), dir: dir.clone() });
    if (partGrab && partGrab.pointer === id) {
      partGrab.seen = true;
      return { length: grabLaser, target: 'model' };
    }
    if (structGrab && structGrab.pointer === id) {
      structGrab.seen = true;
      return { length: grabLaser, target: 'model' };
    }
    if (grab && grab.pointer === id) {
      grab.seen = true;
      if (grab.phase !== 'pending') return { length: grabLaser, target: 'model' }; // the laser ends on the model's base
    }
    let best: { id: string; d: number } | null = null;
    if (current) {
      const limit = panelDist ?? (visit ? 30 : 5);
      for (const m of current.models) {
        const house = houses.get(m.roomId);
        const holder = house?.layer.holders.get(m.id);
        if (!house?.root.visible || !holder) continue;
        const d = pickDistance(holder, origin, dir, best ? Math.min(limit, best.d) : limit);
        if (d !== null && d <= limit && (!best || d < best.d)) best = { id: m.id, d };
      }
    }
    // Walls and floors: plain ray against their meshes; a model in front of them wins.
    if (current?.structures?.length) {
      const limit = Math.min(panelDist ?? (visit ? 30 : 5), best ? best.d : visit ? 30 : 5);
      structRay.set(origin, dir);
      structRay.far = limit;
      for (const st of current.structures) {
        const house = houses.get(st.roomId);
        const mesh = structMesh(st);
        if (!house?.root.visible || !mesh) continue;
        const hit = structRay.intersectObject(mesh, false)[0];
        if (hit && hit.distance <= limit && (!best || hit.distance < best.d)) {
          best = { id: `s:${st.id}`, d: hit.distance };
          hoverPoint.set(id, hit.point.clone());
        }
      }
    }
    if (panelDist !== null && (!best || panelDist <= best.d)) return { length: panelDist, target: 'panel' };
    if (best) {
      hovered.set(id, best.id);
      if (visit && best.id.startsWith('s:') && current?.structures.find((x) => x.id === best!.id.slice(2))?.kind === 'floor') {
        const at = hoverPoint.get(id);
        if (at) {
          tpMarker.position.set(at.x, at.y + 0.01, at.z);
          tpMarker.visible = true;
          tpSeen = performance.now();
        }
      }
      return { length: best.d, target: 'model' };
    }
    if (visit && freeFrame) {
      // Nothing pointed at: the ground of the virtual world is a place to walk to too.
      const y = freeFrame.elements[13];
      const hit = structRay.ray.set(origin, dir).intersectPlane(new Plane(new Vector3(0, 1, 0), -y), new Vector3());
      const d = hit ? hit.distanceTo(origin) : 0;
      if (hit && dir.y < -0.02 && d < 30) {
        hoverPoint.set(id, hit);
        tpMarker.position.set(hit.x, y + 0.01, hit.z);
        tpMarker.visible = true;
        tpSeen = performance.now();
        return { length: d, target: 'none' };
      }
    }
    return { length: 3, target: 'none' };
  }

  // A pinch that the UI did not take: select what the pointer aims at, or clear the selection.
  const DOUBLE_MS = 450;
  let lastFloorPress: { id: string; t: number } | null = null; // for the double pinch on a floor in the visit
  let pendingTp: { at: Vector3; t: number } | null = null; // a walk on a floor, waiting to see if a second pinch follows
  function pressModel(id: string) {
    if (warnOpen) return; // the warning must be answered first
    const target = hovered.get(id) ?? null;
    if (visit) {
      // In the visit the floor and the open ground are for walking: a pinch there deselects when something is selected and
      // walks there when nothing is. A floor is chosen for editing with a double pinch (or pinched while it is the chosen one).
      // The walk on a floor waits a moment, so that the first pinch of a double one does not move you.
      pendingTp = null;
      const floor = !!target?.startsWith('s:') && current?.structures.find((x) => x.id === target.slice(2))?.kind === 'floor';
      if (!target || floor) {
        const now = performance.now();
        const double = floor && lastFloorPress?.id === target && now - lastFloorPress.t < DOUBLE_MS;
        lastFloorPress = floor ? { id: target!, t: now } : null;
        const chosen = floor && target!.slice(2) === selectedStructId;
        if (!double && !chosen) {
          if (selectedId || selectedStructId || selectedPart) {
            selectStruct(null);
            selectedPart = null;
            selectModel(null);
          } else {
            const at = hoverPoint.get(id);
            if (at) {
              if (floor) pendingTp = { at: at.clone(), t: now };
              else teleportTo(at); // open ground: no double pinch there, go at once
            }
          }
          return;
        }
      }
    }
    if (target?.startsWith('s:')) {
      structHit = hoverPoint.get(id)?.clone() ?? null;
      selectStruct(target.slice(2));
      const st = selectedStruct();
      if (st) startStructGrab(id, st); // held: it is dragged like a model (a second hand turns and scales it)
      return;
    }
    selectStruct(null);
    // Double pinch on a model: the component under the ray. One pinch on the chosen component: drag it.
    const now = performance.now();
    const double = !!target && lastPress?.id === target && now - lastPress.t < 450;
    lastPress = target ? { id: target, t: now } : null;
    const holder = target ? current && houses.get(current.models.find((x) => x.id === target)?.roomId ?? '')?.layer.holders.get(target) : null;
    const ray = rays.get(id);
    if (target && holder && ray && (double || selectedPart?.modelId === target)) {
      partRay.set(ray.origin, ray.dir);
      partRay.far = 8;
      const hit = partRay.intersectObject(holder, true)[0];
      if (hit) {
        if (double) {
          const path = partFromMesh(holder, hit.object, selectedPart?.modelId === target ? selectedPart.path : null);
          if (path) return selectPart(target, path);
          say('Questo modello non ha componenti separati', 3000);
        } else if (selectedPart) {
          const hp = partFromMesh(holder, hit.object, null);
          if (hp && (hp === selectedPart.path || hp.startsWith(`${selectedPart.path}/`)) && startPartGrab(id)) return;
        }
      }
    }
    if (selectedPart) {
      selectedPart = null; // pinched the model elsewhere: back to the whole model
      if (objectOpen) closeMenu();
    }
    selectModel(target);
    // Holding the pinch drags the model (see updateGrab); a quick pinch only selects it.
    if (target) grab = { pointer: id, modelId: target, phase: 'pending', seen: true, t0: null, last: null, offset: new Vector3(), decay: true, two: null };
  }

  // ---- Grab: hold the right pinch on a model to drag it; add the left pinch to turn and scale it ----
  const DEADZONE = 0.03; // m the laser tip must travel before a pinch becomes a drag
  const REACH = 8; // m, farthest floor point a ray may drag to
  const GLIDE = 0.25; // s, the model slides from where it was under the laser to the laser tip, so it never jumps
  const SMOOTH = 14; // 1/s, low-pass on scale and turn against hand tracking noise
  const SCALE_START = 0.2; // change of the hands' distance (log ratio, about 22 %) before scaling starts
  const TURN_START = 0.4; // rad (about 23 degrees) before turning starts
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 10; // relative to the scale when the two-hand gesture starts
  interface Grab {
    pointer: string;
    modelId: string;
    phase: 'pending' | 'move' | 'two';
    seen: boolean; // the pointer was reported this frame (else the hand is lost)
    t0: Vector3 | null; // where the ray lands when the pinch starts
    last: Vector3 | null; // last landing point (kept while the ray points at nothing)
    offset: Vector3; // base minus landing point, horizontal: fades out so the base ends up at the laser tip
    decay: boolean;
    two: {
      // Turning and scaling never mix: the first to pass its threshold stays until the pinch is released. `ref*` is where the
      // gesture started, `dead` the distance it must travel before it follows the hands.
      refDist: number;
      refAcc: number;
      refYaw: number;
      refScale: number;
      yaw0: number;
      scale0: number;
      prevAng: number;
      acc: number;
      yaw: number;
      scale: number;
      mode: 'none' | 'turn' | 'scale';
      dead: number;
    } | null;
  }
  let grab: Grab | null = null;
  // Readout above the model during the two-hand gesture: the angle and size now, and what they were before.
  const hud = new Panel(0.58, 0.2, 1000, 'clear');
  hud.mesh.visible = false;
  host.root.add(hud.mesh);
  // Floating "Oggetto" button above the selected model: pointed at with the laser and pinched, it opens the model's menu.
  const objButton = new Panel(0.135, 0.135, 1000, 'clear'); // 50 % bigger than the first version (0.09)
  objButton.set([{ kind: 'iconbtn', icon: 'menu', primary: true, rect: { x: 18, y: 18, w: objButton.pxW - 36, h: objButton.pxH - 36 }, text: '', onClick: () => openObjectMenu() }]);
  objButton.mesh.visible = false;
  host.root.add(objButton.mesh);
  host.add(objButton);
  function openObjectMenu() {
    if (!selectedModel() && !selectedStruct()) return;
    objectOpen = true;
    confirmDelete = false;
    colorPage = false;
    openMenu();
    refreshView();
  }
  function placeObjectButton(head: Head) {
    const m = selectedModel();
    const st = selectedStruct();
    const holder = m && houses.get(m.roomId)?.layer.holders.get(m.id);
    let top: Vector3 | null = holder && houses.get(m!.roomId)?.root.visible ? worldTop(holder) : null;
    const pn = selectedPart ? partNodeOf() : null;
    if (pn && houses.get(selectedPart!.modelId ? (partModelOf()?.roomId ?? '') : '')?.root.visible) {
      const box = new Box3().setFromObject(pn);
      top = box.isEmpty() ? null : new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    }
    // A wall's top is out of reach: the button floats where it was pinched, a little towards you and up, within arm's reach.
    if (st && structHit && houses.get(st.roomId)?.root.visible) {
      const toHead = new Vector3(head.pos.x - structHit.x, 0, head.pos.z - structHit.z).normalize();
      top = structHit.clone().addScaledVector(toHead, 0.12);
      top.y -= 0.05; // the button sits 0.17 above this point
      const far = top.distanceTo(head.pos);
      if (far > 2.4) {
        const away = top.clone().sub(head.pos);
        top.copy(head.pos).addScaledVector(away, 2.4 / far);
      }
    }
    objButton.mesh.visible = !!top && !grab && !partGrab && !structGrab && !rig.visible;
    if (!top) return;
    objButton.mesh.position.copy(top).y += 0.17;
    objButton.mesh.rotation.set(0, Math.atan2(head.pos.x - top.x, head.pos.z - top.z), 0);
  }
  // ---- dragging a wall / floor: it slides on the horizontal plane through where it was pinched; with the other hand's pinch it
  // turns and scales about the middle of its footprint (the same gesture and thresholds as a model). Kept as `xf`, so one
  // button puts it back where it was. ----
  interface StructGrab {
    pointer: string;
    id: string;
    phase: 'pending' | 'move' | 'two';
    seen: boolean;
    y: number;
    l0: Vector3; // where the ray met the plane, in the room's frame
    d0: [number, number];
    p0: Vector3; // the same, in the world, and where the button was: the button goes along with the move
    hit0: Vector3 | null;
    two: { refDist: number; refAcc: number; refYaw: number; refScale: number; yaw0: number; scale0: number; prevAng: number; acc: number; yaw: number; scale: number; mode: 'none' | 'turn' | 'scale'; dead: number } | null;
  }
  let structGrab: StructGrab | null = null;
  function startStructGrab(pointer: string, st: Structure) {
    const house = houses.get(st.roomId);
    if (!house || !house.root.visible) return;
    const y = structHit?.y ?? st.y;
    const p = planePoint(pointer, y);
    if (!p) return;
    house.root.updateWorldMatrix(true, false);
    structGrab = { pointer, id: st.id, phase: 'pending', seen: true, y, l0: house.root.worldToLocal(p.clone()), d0: [...(st.xf?.d ?? [0, 0])] as [number, number], p0: p.clone(), hit0: structHit?.clone() ?? null, two: null };
  }
  function endStructGrab() {
    hud.mesh.visible = false;
    hudText = '';
    structGrab = null;
  }
  function updateStructGrab(dt: number) {
    const g = structGrab;
    if (!g) return;
    const st = current?.structures?.find((x) => x.id === g.id);
    const house = st && houses.get(st.roomId);
    const mesh = st && structMesh(st);
    if (!st || !house || !mesh || !house.root.visible || !g.seen) return endStructGrab();
    g.seen = false;
    const L = pinchL;
    const R = pinchR;
    const xf = (st.xf ??= {});
    house.root.updateWorldMatrix(true, false);
    const anchor = () => {
      const p = planePoint(g.pointer, g.y);
      if (p) {
        g.l0 = house.root.worldToLocal(p.clone());
        g.d0 = [...(xf.d ?? [0, 0])] as [number, number];
        g.p0 = p.clone();
        g.hit0 = structHit?.clone() ?? null;
      }
    };
    if (g.phase !== 'two' && leftHeld && L && R && L.distanceTo(R) > 0.05) {
      g.phase = 'two';
      g.two = { refDist: L.distanceTo(R), refAcc: 0, refYaw: xf.yaw ?? 0, refScale: xf.scale ?? 1, yaw0: xf.yaw ?? 0, scale0: xf.scale ?? 1, prevAng: angleOf(L, R), acc: 0, yaw: xf.yaw ?? 0, scale: xf.scale ?? 1, mode: 'none', dead: 0 };
      markUnsaved();
    } else if (g.phase === 'two' && !(leftHeld && L && R)) {
      g.phase = 'move'; // one hand again: carry on from where it is, without a jump
      g.two = null;
      hud.mesh.visible = false;
      anchor();
    }
    if (g.phase === 'two' && g.two && L && R) {
      const t = g.two;
      const ang = angleOf(L, R);
      t.acc += wrap(ang - t.prevAng);
      t.prevAng = ang;
      const k = 1 - Math.exp(-dt * SMOOTH);
      const dist = L.distanceTo(R);
      const ratio = Math.log(dist / t.refDist);
      const turn = t.acc - t.refAcc;
      if (t.mode === 'none') {
        const rs = Math.abs(ratio) / SCALE_START;
        const rt = Math.abs(turn) / TURN_START;
        if (rs > 1 || rt > 1) {
          t.mode = rt >= rs ? 'turn' : 'scale';
          t.dead = t.mode === 'turn' ? TURN_START : SCALE_START;
        }
      } // once chosen, the gesture stays until the pinch is released: turning and scaling never mix
      const past = (x: number, start: number) => Math.sign(x) * Math.max(0, Math.abs(x) - start);
      const wantYaw = t.mode === 'turn' ? t.refYaw + past(turn, t.dead) : t.refYaw;
      const wantScale = t.mode === 'scale' ? Math.min(t.scale0 * MAX_SCALE, Math.max(t.scale0 * MIN_SCALE, t.refScale * Math.exp(past(ratio, t.dead)))) : t.refScale;
      const snapped = view.snap ? snapTwo({ roomId: st.roomId } as RoomModel, t.yaw0, wantYaw, wantScale, t.mode === 'turn', t.mode === 'scale') : { yaw: wantYaw, scale: wantScale, note: '' };
      t.yaw += (snapped.yaw - t.yaw) * k;
      t.scale += (snapped.scale - t.scale) * k;
      snapNote = snapped.note;
      xf.yaw = t.yaw;
      xf.scale = t.scale;
      houses.get(st.roomId)?.structs.sync(structsOf(st.roomId));
      showHud({ yaw: t.yaw, scale: t.scale } as RoomModel, mesh as unknown as Group, t.yaw0, t.scale0, t.mode === 'turn', t.mode === 'scale', structMeasure(effective(st)));
      return;
    }
    const p = planePoint(g.pointer, g.y);
    if (!p) return;
    const l = house.root.worldToLocal(p.clone());
    if (g.phase === 'pending') {
      if (Math.hypot(l.x - g.l0.x, l.z - g.l0.z) < DEADZONE) return;
      g.phase = 'move';
      markUnsaved();
    }
    xf.d = [g.d0[0] + l.x - g.l0.x, g.d0[1] + l.z - g.l0.z];
    if (g.hit0) structHit = g.hit0.clone().add(p.clone().sub(g.p0));
    houses.get(st.roomId)?.structs.sync(structsOf(st.roomId));
    const ray = rays.get(g.pointer);
    if (ray) grabLaser = Math.max(0.1, p.clone().sub(ray.origin).dot(ray.dir));
  }

  // ---- dragging the chosen component: it slides on the horizontal plane through its pivot ----
  type PartTwo = { refDist: number; refAcc: number; refYaw: number; refScale: number; yaw0: number; scale0: number; prevAng: number; acc: number; yaw: number; scale: number; mode: 'none' | 'turn' | 'scale'; dead: number };
  let partGrab: { pointer: string; y: number; l0: Vector3; d0: [number, number, number]; seen: boolean; two: PartTwo | null } | null = null;
  function planePoint(pointer: string, y: number): Vector3 | null {
    const ray = rays.get(pointer);
    return ray ? (partRay.ray.set(ray.origin, ray.dir).intersectPlane(new Plane(new Vector3(0, 1, 0), -y), new Vector3()) ?? null) : null;
  }
  function startPartGrab(pointer: string): boolean {
    const holder = partHolderOf();
    const node = partNodeOf();
    if (!holder || !node) return false;
    const y = pivotWorld(holder, node, partEditOf()).y;
    const p = planePoint(pointer, y);
    if (!p) return false;
    partGrab = { pointer, y, l0: holder.worldToLocal(p), d0: [...(partEditOf()?.d ?? [0, 0, 0])] as [number, number, number], seen: true, two: null };
    return true;
  }
  function endPartGrab() {
    partGrab = null;
    hud.mesh.visible = false;
    hudText = '';
  }
  function updatePartGrab(dt: number) {
    const g = partGrab;
    if (!g) return;
    const m = partModelOf();
    const holder = partHolderOf();
    if (!m || !holder || !g.seen) return endPartGrab();
    g.seen = false;
    // The other hand pinching too: turn and scale the component with the two hands, like a whole model (one gesture at a time).
    const L = pinchL;
    const R = pinchR;
    const e0 = partEditOf(true)!;
    if (!g.two && leftHeld && L && R && L.distanceTo(R) > 0.05) {
      const yaw = e0.yaw ?? 0;
      const scale = e0.scale ?? 1;
      g.two = { refDist: L.distanceTo(R), refAcc: 0, refYaw: yaw, refScale: scale, yaw0: yaw, scale0: scale, prevAng: angleOf(L, R), acc: 0, yaw, scale, mode: 'none', dead: 0 };
      markUnsaved();
    } else if (g.two && !(leftHeld && L && R)) {
      g.two = null; // one hand again: carry on from where the component is, without a jump
      hud.mesh.visible = false;
      hudText = '';
      const q = planePoint(g.pointer, g.y);
      if (q) {
        g.l0 = holder.worldToLocal(q);
        g.d0 = [...(e0.d ?? [0, 0, 0])] as [number, number, number];
      }
    }
    if (g.two && L && R) {
      const t = g.two;
      const ang = angleOf(L, R);
      t.acc += wrap(ang - t.prevAng);
      t.prevAng = ang;
      const k = 1 - Math.exp(-dt * SMOOTH);
      const dist = L.distanceTo(R);
      const ratio = Math.log(dist / t.refDist);
      const turn = t.acc - t.refAcc;
      if (t.mode === 'none') {
        const rs = Math.abs(ratio) / SCALE_START;
        const rt = Math.abs(turn) / TURN_START;
        if (rs > 1 || rt > 1) {
          t.mode = rt >= rs ? 'turn' : 'scale';
          t.dead = t.mode === 'turn' ? TURN_START : SCALE_START;
        }
      }
      const past = (x: number, start: number) => Math.sign(x) * Math.max(0, Math.abs(x) - start);
      const wantYaw = t.mode === 'turn' ? t.refYaw + past(turn, t.dead) : t.refYaw;
      const wantScale = t.mode === 'scale' ? Math.min(t.scale0 * MAX_SCALE, Math.max(t.scale0 * MIN_SCALE, t.refScale * Math.exp(past(ratio, t.dead)))) : t.refScale;
      const snapped = view.snap ? snapTwo({ roomId: '' } as RoomModel, t.yaw0, wantYaw, wantScale, t.mode === 'turn', t.mode === 'scale') : { yaw: wantYaw, scale: wantScale, note: '' };
      t.yaw += (snapped.yaw - t.yaw) * k;
      t.scale += (snapped.scale - t.scale) * k;
      snapNote = snapped.note;
      e0.yaw = t.yaw;
      e0.scale = t.scale;
      houses.get(m.roomId)?.layer.sync(modelsOf(m.roomId));
      showHud({ yaw: t.yaw, scale: t.scale } as RoomModel, holder, t.yaw0, t.scale0, t.mode === 'turn', t.mode === 'scale', '');
      return;
    }
    const p = planePoint(g.pointer, g.y);
    if (!p) return;
    const l = holder.worldToLocal(p); // the model's own frame: where `d` lives
    const e = partEditOf(true)!;
    e.d = [g.d0[0] + l.x - g.l0.x, g.d0[1], g.d0[2] + l.z - g.l0.z];
    houses.get(m.roomId)?.layer.sync(modelsOf(m.roomId));
    markUnsaved();
  }
  // Sets the colour of the chosen target (null: back to the file's own). "All" replaces every per-material colour.
  function setColor(m: RoomModel, hex: string | null) {
    if (colorTarget === 'all') {
      if (hex) m.color = hex;
      else {
        delete m.color; // "Orig.": the colour and the finish go back to the file's
        delete m.finish;
      }
      delete m.materialColors;
      if (!hex) delete m.materialFinish;
    } else {
      const key = String(colorTarget);
      m.materialColors = { ...m.materialColors };
      if (hex) m.materialColors[key] = hex;
      else {
        delete m.materialColors[key];
        if (m.materialFinish) delete m.materialFinish[key];
      }
      if (!Object.keys(m.materialColors).length) delete m.materialColors;
      if (m.materialFinish && !Object.keys(m.materialFinish).length) delete m.materialFinish;
    }
    applyModelChange(m);
  }
  // Roughness or metalness of the chosen target. "All" replaces every per-material finish.
  function setFinish(m: RoomModel, key: 'roughness' | 'metalness', value: number) {
    const v = Math.min(1, Math.max(0, value));
    if (colorTarget === 'all') {
      m.finish = { ...m.finish, [key]: v };
      delete m.materialFinish;
    } else {
      const k = String(colorTarget);
      m.materialFinish = { ...m.materialFinish, [k]: { ...m.materialFinish?.[k], [key]: v } };
    }
    applyModelChange(m);
  }
  function applyPartChange() {
    const m = partModelOf();
    if (m) houses.get(m.roomId)?.layer.sync(modelsOf(m.roomId));
    markUnsaved();
    refreshView();
  }
  function setPartColor(hex: string | null) {
    const e = partEditOf(true)!;
    if (hex) e.color = hex;
    else {
      delete e.color;
      delete e.finish;
    }
    applyPartChange();
  }
  function applyStructChange(st: Structure) {
    houses.get(st.roomId)?.structs.sync(structsOf(st.roomId));
    markUnsaved();
    refreshView();
  }
  // Tint of a wall / floor (null: back to the default colour). With a texture it multiplies the texture.
  function setStructColor(st: Structure, hex: string | null) {
    if (hex) st.color = hex;
    else delete st.color;
    applyStructChange(st);
  }
  function applyModelChange(m: RoomModel) {
    houses.get(m.roomId)?.layer.sync(modelsOf(m.roomId));
    markUnsaved();
    refreshView();
  }
  const parseNumber = (text: string | null) => {
    const n = text === null ? NaN : Number(text.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  let hudText = '';
  let snapNote = '';
  // Two separate cards while turning / scaling: rotation and scale, each with its icon, the value now and the value before.
  // The one that is being changed is lit.
  function showHud(m: RoomModel, holder: Group, yaw0: number, scale0: number, turning: boolean, scaling: boolean, sizeText?: string) {
    const deg = (r: number) => ((Math.round((r * 180) / Math.PI) % 360) + 360) % 360;
    const dim = modelSize(holder);
    const size = sizeText ?? (dim ? `${(dim.x * m.scale).toFixed(2)} × ${(dim.y * m.scale).toFixed(2)} × ${(dim.z * m.scale).toFixed(2)} m` : '');
    const rot = `${deg(m.yaw)}°`;
    const rotSub = `era ${deg(yaw0)}°${snapNote.includes('r') ? '  ⟂' : ''}`;
    const sca = `×${m.scale.toFixed(2)}`;
    const scaSub = `era ×${scale0.toFixed(2)}${snapNote.includes('s') ? '  ⟂' : ''}`;
    const text = `${rot}|${rotSub}|${sca}|${scaSub}|${size}|${turning}|${scaling}`;
    if (text !== hudText) {
      hudText = text;
      const half = (hud.pxW - 24 - 16) / 2;
      hud.set([
        { kind: 'card', icon: 'rotate', rect: { x: 12, y: 12, w: half, h: 100 }, text: rot, sub: rotSub, size: 34, active: turning },
        { kind: 'card', icon: 'scale', rect: { x: 12 + half + 16, y: 12, w: half, h: 100 }, text: sca, sub: scaSub, size: 34, active: scaling },
        ...(size ? [{ kind: 'chip' as const, rect: { x: 12 + (hud.pxW - 24 - 330) / 2, y: 128, w: 330, h: 40 }, text: size, size: 19, fill: theme().surface, color: theme().text2 }] : []),
      ]);
    }
    const top = new Box3().setFromObject(holder);
    hud.mesh.position.set((top.min.x + top.max.x) / 2, top.max.y + 0.22, (top.min.z + top.max.z) / 2);
    if (lastHead) hud.mesh.rotation.set(0, Math.atan2(lastHead.pos.x - hud.mesh.position.x, lastHead.pos.z - hud.mesh.position.z), 0);
    hud.mesh.visible = true;
    hud.draw();
  }
  let grabLaser = 1;
  let leftHeld = false;
  let pinchL: Vector3 | null = null;
  let pinchR: Vector3 | null = null;
  const rays = new Map<string, { origin: Vector3; dir: Vector3 }>();

  // 'right' is the main (dominant) hand, 'left' the other one: xrApp maps the real hands onto these two.
  // The other hand never presses on panels. Its pinch opens / closes the menu at once (a press, not a hold), unless the
  // main hand is already pinching: then it is the second hand of the turn / scale gesture.
  let mainHeld = false;
  function pinchDown(hand: 'left' | 'right', id: string, consumedByUi: boolean) {
    if (hand === 'left') {
      leftHeld = !consumedByUi;
      if (leftHeld && !mainHeld && !grab) (rig.visible ? closeMenu : openMenu)();
    } else {
      mainHeld = true;
      if (!consumedByUi) pressModel(id);
    }
  }
  function pinchUp(hand: 'left' | 'right', id: string) {
    if (hand === 'left') leftHeld = false;
    else {
      mainHeld = false;
      if (grab?.pointer === id) endGrab();
      if (partGrab?.pointer === id) endPartGrab();
      if (structGrab?.pointer === id) endStructGrab();
    }
  }
  // Magnetic snaps, only for the gesture that is engaged. Rotation: first the room's walls (the model's sides parallel
  // to a wall, a wide pull), else steps of 15 degrees from where it started (a relative step: the angles of the headset
  // session or of the scan frame mean nothing by themselves). Scale: round steps, 1.00 is the real size.
  const WALL_PULL = 0.087; // rad, about 5 degrees
  const STEP_PULL = 0.052; // about 3 degrees
  const STEP = Math.PI / 12;
  const wallAngles = new Map<string, number[]>(); // per room: wall directions modulo 90 degrees
  function wallsOf(roomId: string): number[] {
    let list = wallAngles.get(roomId);
    if (!list) {
      list = [];
      for (const p of rooms.find((r) => r.id === roomId)?.scan.planes ?? []) {
        if (p.label !== 'wall' || !p.quat) continue;
        const n = planeNormal(p.quat);
        if (Math.hypot(n[0], n[2]) < 0.7) continue; // not a vertical plane
        const a = ((Math.atan2(n[0], n[2]) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
        if (!list.some((b) => Math.abs(b - a) < 0.03)) list.push(a);
      }
      wallAngles.set(roomId, list);
    }
    return list;
  }
  function snapTwo(m: RoomModel, yaw0: number, yaw: number, scale: number, turning: boolean, scaling: boolean) {
    let note = '';
    if (turning) {
      let best: number | null = null;
      let bestD = WALL_PULL;
      for (const w of wallsOf(m.roomId)) {
        const q = Math.PI / 2;
        const c = w + Math.round((yaw - w) / q) * q;
        if (Math.abs(c - yaw) < bestD) {
          bestD = Math.abs(c - yaw);
          best = c;
        }
      }
      if (best !== null) note += 'r';
      else {
        const c = yaw0 + Math.round((yaw - yaw0) / STEP) * STEP;
        if (Math.abs(c - yaw) < STEP_PULL) {
          best = c;
          note += 'r';
        }
      }
      if (best !== null) yaw = best;
    }
    if (scaling) {
      const step = scale < 0.5 ? 0.01 : scale < 2 ? 0.05 : 0.25;
      const c = Math.round(scale / step) * step;
      if (c > 0 && Math.abs(c - scale) / c < 0.012) {
        scale = c;
        note += 's';
      }
    }
    return { yaw, scale, note };
  }

  function endGrab() {
    hud.mesh.visible = false;
    hudText = '';
    grab = null;
  }
  const angleOf = (a: Vector3, b: Vector3) => Math.atan2(b.x - a.x, b.z - a.z); // direction on the floor, as yawOf

  function markUnsaved() {
    if (unsaved) return;
    unsaved = true;
    refreshView();
  }

  // Where the dragged model's base goes: the top of another model under the ray, else the floor of its room.
  function dragTarget(m: RoomModel, house: House, origin: Vector3, dir: Vector3): Vector3 | null {
    const room = rooms.find((r) => r.id === m.roomId);
    house.root.updateWorldMatrix(true, false);
    const floorY = new Vector3(0, room ? floorCentre(room.scan.planes)[1] : 0, 0).applyMatrix4(house.root.matrixWorld).y;
    let far = REACH;
    let floor: Vector3 | null = null;
    if (dir.y < -0.02) {
      const t = (floorY - origin.y) / dir.y;
      if (t > 0 && t <= REACH) {
        far = t;
        floor = origin.clone().addScaledVector(dir, t);
      }
    }
    const others: Group[] = [];
    for (const o of current?.models ?? []) {
      const h = houses.get(o.roomId);
      const holder = o.id !== m.id && h?.root.visible ? h.layer.holders.get(o.id) : null;
      if (holder) others.push(holder);
    }
    return surfaceUnder(others, origin, dir, far) ?? floor;
  }

  // Once per frame (core.tick): moves / turns / scales the grabbed model.
  function updateGrab(dt: number) {
    const g = grab;
    if (!g) return;
    const m = current?.models.find((x) => x.id === g.modelId);
    const house = m && houses.get(m.roomId);
    const holder = m && house?.layer.holders.get(m.id);
    const ray = rays.get(g.pointer);
    if (!m || !house || !holder || !ray || !g.seen || !house.root.visible) return endGrab();
    g.seen = false;
    const L = pinchL;
    const R = pinchR;
    if (g.phase !== 'two' && leftHeld && L && R && L.distanceTo(R) > 0.05) {
      g.phase = 'two';
      g.two = { refDist: L.distanceTo(R), refAcc: 0, refYaw: m.yaw, refScale: m.scale, yaw0: m.yaw, scale0: m.scale, prevAng: angleOf(L, R), acc: 0, yaw: m.yaw, scale: m.scale, mode: 'none', dead: 0 };
      markUnsaved();
    } else if (g.phase === 'two' && !(leftHeld && L && R)) {
      g.phase = 'move'; // one hand again: carry on from where the model is, without a jump
      g.two = null;
      hud.mesh.visible = false;
      g.last = null;
      g.decay = false;
      g.offset.set(0, 0, 0);
      g.t0 = null;
    }
    if (g.phase === 'two' && g.two && L && R) {
      const t = g.two;
      const ang = angleOf(L, R);
      t.acc += wrap(ang - t.prevAng);
      t.prevAng = ang;
      const k = 1 - Math.exp(-dt * SMOOTH);
      // Turning the hands changes their distance a little and the other way round, so only one gesture works at a time:
      // the first to pass its threshold wins and the other stays frozen until the pinch is released.
      const dist = L.distanceTo(R);
      const ratio = Math.log(dist / t.refDist);
      const turn = t.acc - t.refAcc;
      if (t.mode === 'none') {
        const rs = Math.abs(ratio) / SCALE_START;
        const rt = Math.abs(turn) / TURN_START;
        if (rs > 1 || rt > 1) {
          t.mode = rt >= rs ? 'turn' : 'scale';
          t.dead = t.mode === 'turn' ? TURN_START : SCALE_START;
        }
      } // once chosen, the gesture stays until the pinch is released: turning and scaling never mix
      const past = (x: number, start: number) => Math.sign(x) * Math.max(0, Math.abs(x) - start);
      const wantYaw = t.mode === 'turn' ? t.refYaw + past(turn, t.dead) : t.refYaw;
      const wantScale = t.mode === 'scale' ? Math.min(t.scale0 * MAX_SCALE, Math.max(t.scale0 * MIN_SCALE, t.refScale * Math.exp(past(ratio, t.dead)))) : t.refScale;
      const snapped = view.snap ? snapTwo(m, t.yaw0, wantYaw, wantScale, t.mode === 'turn', t.mode === 'scale') : { yaw: wantYaw, scale: wantScale, note: '' };
      t.yaw += (snapped.yaw - t.yaw) * k;
      t.scale += (snapped.scale - t.scale) * k;
      snapNote = snapped.note;
      m.yaw = t.yaw;
      m.scale = t.scale;
      house.layer.sync(modelsOf(m.roomId)); // position untouched: the model turns and grows on the spot
      showHud(m, holder, t.yaw0, t.scale0, t.mode === 'turn', t.mode === 'scale');
      return;
    }
    const hit = dragTarget(m, house, ray.origin, ray.dir) ?? g.last;
    if (!hit) return;
    g.last = hit;
    const base = holder.getWorldPosition(new Vector3());
    if (g.phase === 'pending') {
      g.t0 ??= hit;
      if (hit.distanceTo(g.t0) < DEADZONE) return;
      g.phase = 'move';
      if (g.decay) g.offset.set(base.x - hit.x, 0, base.z - hit.z); // the drag starts exactly where the model is
      markUnsaved();
    } else if (!g.decay && g.offset.lengthSq() === 0 && g.t0 === null) {
      g.offset.set(base.x - hit.x, 0, base.z - hit.z); // back from two hands: keep the model where it is
      g.t0 = hit;
    }
    if (g.decay) g.offset.multiplyScalar(Math.exp(-dt / GLIDE));
    const world = new Vector3(hit.x + g.offset.x, hit.y, hit.z + g.offset.z);
    house.root.updateWorldMatrix(true, false);
    const local = house.root.worldToLocal(world.clone());
    m.pos = [local.x, local.y, local.z];
    house.layer.sync(modelsOf(m.roomId));
    const toBase = world.sub(ray.origin);
    grabLaser = Math.max(0.1, toBase.dot(ray.dir));
  }



  // Signing in with a code: while it waits for the PC the headset asks every 2 s whether it was approved.
  let linkPolledAt = 0;
  let linkBusy = false;
  async function pollLink(now: number) {
    if (!view.linkCode || linkBusy || now - linkPolledAt < 2000) return;
    linkPolledAt = now;
    linkBusy = true;
    try {
      const r = await backend.deviceLogin!.poll();
      if (r === 'ok') {
        view.linkCode = null;
        await reloadRooms();
        loadProjects();
        view.tab = 'load';
        render();
      } else if (r === 'expired') {
        view.linkCode = null;
        say('Il codice è scaduto: premi di nuovo per averne uno nuovo.', 7000);
      } else if (typeof r === 'object') {
        view.linkCode = null;
        say(r.error, 9000);
      }
    } finally {
      linkBusy = false;
    }
  }

  async function reloadRooms() {
    try {
      view.email = await backend.email();
      view.authKnown = true;
      if (view.email) {
        loadProjects(); // in parallel with the rooms
        rooms = await backend.listRooms();
        roomsLoaded = true;
      }
    } catch (e) {
      view.authKnown = true;
      say(`Errore: ${errText(e)}`);
    }
    refreshView();
  }

  // Keep `live` = the planes of the room around the head; re-run when planes or head change.
  function recompute() {
    const h = lastHead?.pos;
    const here = h ? roomAround(rawLive, rawBoxes, [h.x, h.y, h.z]) : { planes: rawLive, boxes: rawBoxes };
    live = here.planes;
    liveBoxes = here.boxes;
    const info = `Piani qui ${live.length} / visti ${rawLive.length}`;
    if (info !== view.info || live.length >= MIN_PLANES !== view.liveReady) refreshView();
  }

  // For the Options diagnostics: session visibility changes, resets, ...
  function logEvent(text: string) {
    const t = new Date();
    const hms = [t.getHours(), t.getMinutes(), t.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    events.push(`${hms} ${text}`);
    console.log(`[immersa] ${text}`);
    if (events.length > 8) events.shift();
    view.log = [...view.log, `${hms} ${text}`].slice(-30);
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(view.log));
    } catch {
      /* storage can be unavailable */
    }
    refreshView();
  }

  render();
  return {
    host,
    roomRoot,
    houses: () => houses, // test hook
    // Test hook: every model's scene object, whichever room it is in.
    holders: () => new Map([...houses.values()].flatMap((h) => [...h.layer.holders])),
    // Every panel that should be shown as a WebXR layer.
    layerPanels: () => [menu, menuToast, warn, listLoader, loading, splashPanel, hud, objButton, notice],
    keyboard,
    panels: { menu, keyboard: keyboard.panel },
    menu: { open: openMenu, close: closeMenu, toggle: () => (rig.visible ? closeMenu() : openMenu()), isOpen: () => rig.visible },
    // A new XR session has a new origin: forget the old alignment and start over.
    sessionStarted(cap: Capture | null) {
      capture = cap;
      scanning = false;
      marks.clear();
      mark('sessione');
      awaitingModels = null;
      // Only after our own restart (standby) the project that was open then comes back (none: just the rooms). A normal
      // launch of the app opens nothing by itself.
      const restart = restartMark.consume();
      const inPage = sessionStorage.getItem(RESUME_KEY);
      sessionStorage.removeItem(RESUME_KEY);
      const last = lastProject.recent();
      const saved = restart ? restart.project : inPage;
      // Start downloading its models now: the project list and the room come later.
      if (saved && last?.id === saved) preloadModels(last.paths);
      // With no project to reopen the id is empty: just wait for the rooms, then the menu opens.
      resumePending = saved ? { id: saved, since: performance.now() } : restart ? { id: '', since: performance.now() } : null;
      if (resumePending) setLoadingText(resumePending.id ? 'Carico il progetto' : 'Cerco le stanze');
      autoTab = true;
      view.tab = 'load'; // the menu always starts on the projects
      rawLive = [];
      rawBoxes = [];
      live = [];
      liveBoxes = [];
      lastTry = 0;
      failedTries = 0;
      readyAt = 0;
      candidate = null;
      switching = lost = 0;
      ignored.clear();
      aligns.clear(); // a new session has a new origin
      misses.clear();
      fits.clear();
      closeCurrent();
      setRecognised(null);
      void reloadRooms();
      if (resumePending) loading.mesh.visible = true;
      else {
        // The logo in front of you for a moment while the app gets its data, then the menu.
        splash = { since: performance.now(), endAt: null, placed: false };
        showSplash(splash.since, 1);
        splashPanel.mesh.visible = true;
      }
    },
    // After a standby the session's frame has moved and the planes are gone: hide the rooms and models until the planes
    // come back and the rooms are found again (a wrong wireframe is worse than none).
    // The planes are gone (after a standby): say so on the floating card, and after a while what to do.
    // stage 0: just looking; 1: after a few seconds the remedy that works (off and on again); 2: after a long time the last resort
    showSearching(stage: 0 | 1 | 2) {
      closeMenu();
      searching = true;
      setLoadingText('Cerco la stanza', stage === 0 ? 'Un attimo…' : stage === 1 ? 'Ricentra la vista: tieni premuto il tasto Meta' : 'Ancora niente? Chiudi e riapri Immersa dalla Libreria');
      loading.mesh.visible = true;
    },
    hideSearching() {
      searching = false;
      loading.mesh.visible = false;
    },
    planesGap(on: boolean) {
      if (on) closeMenu(); // no glimpse of the menu while the rooms are gone (the app is about to restart)
      if (on) {
        closeWarning();
        setVisit(false);
      } // the session lost its frame: the visit ends, the plan comes back in front of you
      gap = on;
      roomRoot.visible = !!recognised && !gap;
      syncHouses();
    },
    setLivePlanes(planes: RoomPlane[], boxes: RoomBox[] = []) {
      // The planes arrive (first time, or back after a standby): look for the room at once, not at the next 2.5 s tick.
      if (planes.length >= MIN_PLANES && (gap || rawLive.length < MIN_PLANES)) lastTry = 0;
      if (planes.length >= MIN_PLANES) mark('piani');
      rawLive = planes;
      rawBoxes = boxes;
      recompute();
    },
    tick(now: number, head: Head, dt: number) {
      void pollLink(now);
      keyboard.follow(head, dt);
      lastHead = head;
      if (now - lastHere > 1000) {
        lastHere = now;
        recompute(); // you may have walked into another room
      }
      tryRecognise(now);
      alignFar(now);
      if (awaitingModels !== null && current) {
        const total = current.models.length;
        const done = Math.max(0, total - modelsPending());
        setLoadingText('Carico il progetto', `Modelli ${done} / ${total}`, total ? done / total : 1);
      } else if (awaitingModels !== null) {
        awaitingModels = null; // the project was closed meanwhile
        loading.mesh.visible = false;
      }
      listLoader.mesh.visible = rig.visible && view.tab === 'load' && view.projects === null && !view.object && view.authKnown && !!view.email;
      if (listLoader.mesh.visible) listLoader.draw();
      if (searching) loading.mesh.visible = true;
      if (loading.mesh.visible) {
        loading.mesh.position.set(head.pos.x + Math.sin(yawOf(head.fwd)) * 0.9, head.pos.y - 0.05, head.pos.z + Math.cos(yawOf(head.fwd)) * 0.9);
        loading.mesh.rotation.set(0, Math.atan2(head.pos.x - loading.mesh.position.x, head.pos.z - loading.mesh.position.z), 0);
        loading.draw();
      }
      if (visit) {
        sky.position.copy(head.pos); // the sky and the ground follow your head: you never reach their edge
        ground.position.set(head.pos.x, (freeFrame?.elements[13] ?? 0) - 0.02, head.pos.z);
      }
      if (tpMarker.visible && performance.now() - tpSeen > 150) tpMarker.visible = false;
      if (pendingTp && performance.now() - pendingTp.t >= DOUBLE_MS) {
        const at = pendingTp.at;
        pendingTp = null;
        if (visit) teleportTo(at);
      }
      if (menuToast.mesh.visible && rig.visible) menuToast.draw();
      if (notice.mesh.visible) {
        if (performance.now() > noticeUntil) notice.mesh.visible = false;
        else {
          if (noticePlace) {
            noticePlace = false; // once, where you are looking when it appears
            notice.mesh.position.set(head.pos.x + Math.sin(yawOf(head.fwd)) * 0.8, head.pos.y - 0.22, head.pos.z + Math.cos(yawOf(head.fwd)) * 0.8);
            notice.mesh.rotation.set(0, Math.atan2(head.pos.x - notice.mesh.position.x, head.pos.z - notice.mesh.position.z), 0);
          }
          notice.draw();
        }
      }
      if (splash) {
        if (splash.endAt === null && now - splash.since > SPLASH_MS && view.authKnown) splash.endAt = now;
        const gone = splash.endAt === null ? 0 : (now - splash.endAt) / 500; // half a second of fade-out
        // Nothing of the room or the models while the logo is up: it is the first thing you see.
        roomRoot.visible = false;
        for (const h of houses.values()) h.root.visible = false;
        if (gone >= 1) {
          splash = null;
          splashPanel.mesh.visible = false;
          roomRoot.visible = !!recognised && !gap;
          syncHouses();
          openMenu();
        } else {
          if (splash.endAt !== null) showSplash(splash.since, 1 - gone);
          if (!splash.placed) {
            splash.placed = true; // once, where you are looking when it appears
            splashPanel.mesh.position.set(head.pos.x + Math.sin(yawOf(head.fwd)) * 1.0, head.pos.y - 0.02, head.pos.z + Math.cos(yawOf(head.fwd)) * 1.0);
            splashPanel.mesh.rotation.set(0, Math.atan2(head.pos.x - splashPanel.mesh.position.x, head.pos.z - splashPanel.mesh.position.z), 0);
          }
          splashPanel.draw();
        }
      }
      if (resumePending) {
        const since = now - resumePending.since;
        if (projectsLoaded && (aligns.size > 0 || since > 12000)) {
          const id = resumePending.id;
          resumePending = null;
          if (!id) {
            loading.mesh.visible = false;
            openMenu(); // restarted without a project: the rooms are back, the menu opens as in a normal start
          } else {
            const p = allProjects.find((x) => x.id === id);
            if (p) {
              openProject(p);
              awaitingModels = now; // the label stays until the models are in
            } else {
              loading.mesh.visible = false;
              failResume();
            }
          }
        } else if (since > 30000) {
          resumePending = null;
          failResume(); // the project list never arrived
        }
      }
      if (awaitingModels !== null && (modelsPending() === 0 || now - awaitingModels > 60000)) {
        awaitingModels = null;
        loading.mesh.visible = false;
        mark('modelli');
        if (current) notify('Progetto caricato');
      }
      checkPending();
      followHead(head, dt);
      updateGrab(dt);
      updatePartGrab(dt);
      updateStructGrab(dt);
      placeObjectButton(head);
      syncOutline();
      host.update();
    },
    logEvent,
    isScanning: () => scanning,
    // Called just before the session is restarted: remember which project to reopen.
    prepareResume() {
      restartMark.set(current?.id ?? null);
      if (current) sessionStorage.setItem(RESUME_KEY, current.id);
      else lastProject.clear(); // nothing was open: a later launch must not bring back an old project
    },
    // The headset moved its coordinate frame (new boundary, recentring, standby). `newOrigin` is the pose of the new
    // origin in the old frame when the browser tells us (column-major matrix): the rooms move with it. Without it,
    // and with no planes to find the rooms again, they stay where they are; otherwise they are found again.
    referenceReset(newOrigin?: ArrayLike<number> | null) {
      if (newOrigin || rawLive.length < MIN_PLANES) {
        closeWarning();
        setVisit(false); // the headset moved its frame: the visit's place is no longer valid
        if (newOrigin) {
          const inv = new Matrix4().fromArray(Array.from(newOrigin)).invert();
          const move = (a: Alignment): Alignment => {
            const e = inv.clone().multiply(alignMatrix(a)).elements;
            return { ...a, yaw: -Math.atan2(e[8], e[0]), tx: e[12], ty: e[13], tz: e[14] };
          };
          for (const [id, a] of [...aligns]) aligns.set(id, move(a));
          if (recognised) {
            recognised.alignment = aligns.get(recognised.room.id) ?? move(recognised.alignment);
            roomRoot.matrix.copy(alignMatrix(recognised.alignment));
          }
          if (foreign) foreign.matrix.premultiply(inv);
          syncHouses();
        }
        return logEvent(newOrigin ? 'reset: stanze spostate con l\'origine' : 'reset senza piani: stanze lasciate dove sono');
      }
      logEvent('reset del riferimento');
      aligns.clear();
      misses.clear();
      lastTry = 0;
      lastFar = 0;
      failedTries = 0;
      switching = lost = 0;
      candidate = null;
      setRecognised(null);
    },
    // The index fingertips of the tracked hands (for typing on the keyboard); call every frame.
    pokeTips(tips: { id: string; pos: Vector3 | null }[]) {
      poke.update(tips);
    },
    pokeActive: () => poke.active(),
    // The keyboard's panel while it is open: the virtual hands rest on it instead of going through.
    keyboardSurface: () => (keyboard.isOpen() ? keyboard.panel.mesh : null),
    aim,
    pinchDown,
    pinchUp,
    setPinchPoints(left: Vector3 | null, right: Vector3 | null) {
      pinchL = left;
      pinchR = right;
    },
    selected: () => selectedId,
    selectedStruct: () => selectedStructId,
    selectedPart: () => selectedPart,
    openObject: () => openObjectMenu(), // test hook
    say,
    // Test hook.
    debug: () => ({ loading: loading.mesh.visible, rooms, recognised, projects: allProjects, current, aligned: [...aligns.keys()], foreign: foreign?.roomId ?? null, view, live: live.length, raw: rawLive.length, pending: pendingName() }),
  };
}

export type AppCore = ReturnType<typeof createAppCore>;
