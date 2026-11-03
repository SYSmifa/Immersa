import { Box3, Group, Matrix4, Scene, Vector3 } from 'three';
import type { Backend } from '../cloud/backend';
import { alignPlanes, planeNormal, type Alignment } from '../room/align';
import { drawBoxes, drawPlanes } from '../room/draw';
import { buildOccluders, createOccluderMaterial, showOccluders } from '../room/occluders';
import { createModelLayer, modelsPending, preloadModels, type ModelLayer } from '../room/modelLayer';
import { floorCentre } from '../room/floor';
import { applySelectionLook, clearSelectionLook, listMaterials, modelSize, pickDistance, surfaceUnder, worldTop } from '../room/selection';
import { roomAround, roomClusters } from '../room/around';
import { isGoodFit, isInside, recognizeRoom, type Recognised } from '../room/recognize';
import type { Project, Room, RoomBox, RoomModel, RoomPlane } from '../room/types';
import { UiHost } from '../ui3d/host';
import { createKeyboard } from '../ui3d/keyboard';
import { theme } from '../ui3d/theme';
import { layersPreferred } from '../ui3d/layers';
import { hexToHsv, hsvToHex, type Hsv } from '../ui3d/color';
import { buildMenu, MENU_H, MENU_W, type MenuActions, type MenuView, type Tab } from '../ui3d/menu';
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
export function createAppCore({ scene, backend, signOut, onLayers }: Options) {
  const host = new UiHost();
  scene.add(host.root);
  const rig = new Group(); // menu + keyboard, follows the head
  rig.visible = false;
  host.root.add(rig);
  const menu = new Panel(MENU_W / 1200, MENU_H / 1200, 1200);
  rig.add(menu.mesh);
  host.add(menu);
  const keyboard = createKeyboard(host, rig);
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
    roomName: null,
    candidate: null,
    info: '',
    resid: null,
    liveReady: false,
    captureAvailable: false,
    projectName: null,
    fits: [],
    events: [],
    projects: null,
    currentProjectId: null,
    object: null,
    unsaved: false,
    page: 0,
    outline: true,
    snap: readSnap(),
    layers: layersPreferred(),
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
  let autoTab = true;
  let splash: { since: number; endAt: number | null; placed: boolean } | null = null; // the start-up screen with the logo
  let lastHead: Head | null = null;
  let messageTimer: ReturnType<typeof setTimeout> | undefined;

  const pendingName = () => sessionStorage.getItem(PENDING_KEY) === '1';
  const setPendingName = (on: boolean) => (on ? sessionStorage.setItem(PENDING_KEY, '1') : sessionStorage.removeItem(PENDING_KEY));

  function render() {
    menu.set(buildMenu(view, actions));
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
    const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? '?';
    const here = (p: Project) => !!recognised && p.roomIds.includes(recognised.room.id);
    view.projects = projectsLoaded
      ? [...allProjects]
          .sort((a, b) => Number(here(b)) - Number(here(a)) || b.updatedAt.localeCompare(a.updatedAt))
          .map((p) => ({ id: p.id, name: p.name, models: p.models.length, rooms: p.roomIds.map(roomName).join(', ') || '(nessuna stanza)', here: here(p) }))
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
  function objectView() {
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
    if (splash) return; // the splash screen is up: the menu opens when it goes
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
      h = { root, layer: createModelLayer(root, (t) => say(`Modello: ${t}`)), occluder };
      houses.set(roomId, h);
    }
    return h;
  }

  function closeCurrent() {
    current = null;
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

  // Bring the scene in line with the open project and the alignments found so far.
  function syncHouses() {
    if (!current) return;
    const ids = current.roomIds.filter((id) => rooms.some((r) => r.id === id));
    for (const id of [...houses.keys()]) {
      if (!ids.includes(id)) {
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
      if (wasGap) say('Rooms found again', 4000);
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
        say(`Ora sei in: ${found.room.name}`);
        openMenu();
      }
    } else {
      switching = 0;
      if (++lost >= 3) {
        lost = 0;
        const name = recognised!.room.name;
        setRecognised(null);
        say(`Sei uscito da: ${name}`);
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

  async function saveRoom() {
    const planes = live; // the scan as it is now, even if the list changes while typing
    const boxes = liveBoxes;
    if (planes.length < MIN_PLANES) return say('Nessuna scansione da salvare');
    const name = await ask('Nome della stanza');
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
    const name = await ask('Nome della stanza', room.name);
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
    say('Room scan updated');
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
    current = p;
    // Align every room of the project now (the headset reports them all), so it opens in the right places.
    for (const id of p.roomIds) {
      const room = rooms.find((r) => r.id === id);
      if (!room || aligns.has(id)) continue;
      const fit = bestFit(room);
      if (fit) aligns.set(id, fit);
    }
    foreignMode = !p.roomIds.some((id) => aligns.has(id));
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
    say(foreign ? `Aperto: ${p.name} (nessuna sua stanza è qui: posizione e orientamento approssimativi)` : `Aperto: ${p.name}`, foreign ? 9000 : 7000);
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
    async signIn(signUp: boolean) {
      say(signUp ? 'Creating account...' : 'Signing in...', 8000);
      const res = await backend.signIn(view.loginEmail, loginPassword, signUp);
      if (!res.ok) return say(res.message, 9000);
      loginPassword = '';
      view.loginPassLen = 0;
      await reloadRooms();
      loadProjects();
      view.tab = 'load';
      say('Signed in');
    },
    setTab(tab: Tab) {
      view.tab = tab;
      autoTab = false;
      render();
    },
    // Always reads the project again from the account: edits made on the PC since the list was loaded show up, and
    // moves that were never saved are dropped.
    async selectProject(id) {
      say('Carico il progetto...', 4000);
      try {
        allProjects = await backend.listProjects();
      } catch (e) {
        say(`Aggiornamento fallito, uso la copia che ho: ${errText(e)}`, 6000);
      }
      const p = allProjects.find((x) => x.id === id);
      if (p) openProject(p);
    },
    saveChanges,
    turnPage(delta) {
      view.page = Math.max(0, view.page + delta);
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
      say('Rileggo la stanza...', 3000);
    },
    async objRotation() {
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
      const m = selectedModel();
      if (!m) return;
      if (hex) pick = hexToHsv(hex);
      setColor(m, hex);
    },
    objOpenColor() {
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
      const m = selectedModel();
      if (m) setFinish(m, key, value);
    },
    // Wheel (hue, saturation) and brightness bar: a null part stays as it is.
    objPick(h: number | null, sat: number | null, v: number | null) {
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
    objDeleteYes() {
      const m = selectedModel();
      if (!m || !current) return;
      current.models = current.models.filter((x) => x.id !== m.id);
      selectedId = null;
      objectOpen = false;
      confirmDelete = false;
      houses.get(m.roomId)?.layer.sync(modelsOf(m.roomId)); // removes it from the scene
      markUnsaved();
      refreshView();
      say(`Eliminato: ${m.name} (non salvato)`, 4000);
    },
    objClose() {
      objectOpen = false;
      confirmDelete = false;
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
      unsaved = false;
      lastProject.clear();
      closeCurrent();
      refreshView();
    },
    signOut,
    close: closeMenu,
  };

  async function saveChanges() {
    if (!current || !unsaved) return;
    const p = current;
    try {
      await backend.saveProject(p.id, { models: p.models });
      if (current === p) unsaved = false;
      refreshView();
      say('Modifiche salvate', 3000);
    } catch (e) {
      say(`Salvataggio fallito: ${errText(e)}`);
    }
  }

  // Model selection: a pointing hand (ray) hovers the model it points at; a pinch selects it (azure outline).
  const hovered = new Map<string, string>(); // pointer id -> model id
  let looked: { id: string; holder: Group } | null = null;

  const deg = (r: number) => Math.round((r * 180) / Math.PI);
  function selectModel(id: string | null) {
    if (id === selectedId) return;
    selectedId = id;
    if (!id && objectOpen) closeMenu(); // nothing selected any more: the object's menu goes away
    const m = id ? current?.models.find((x) => x.id === id) : null;
    say(m ? `Selezionato: ${m.name} · yaw ${deg(m.yaw)}° (stanza ${deg(aligns.get(m.roomId)?.yaw ?? 0)}°)` : 'Selezione annullata', 2500);
  }

  // Keeps the outline on the selected model's holder (and only there); the model may still be loading.
  function syncOutline() {
    if (selectedId && !current?.models.some((m) => m.id === selectedId)) selectedId = null;
    // While the object menu is open the model shows its real colours (the azure look would hide a colour change).
    const lookId = objectOpen ? null : selectedId;
    if (looked && looked.id !== lookId) {
      clearSelectionLook(looked.holder);
      looked = null;
    }
    if (!lookId || looked) return;
    const m = current?.models.find((x) => x.id === lookId);
    const holder = m && houses.get(m.roomId)?.layer.holders.get(m.id);
    if (holder && applySelectionLook(holder)) looked = { id: lookId, holder };
  }

  // Per frame and per pointer: UI first (the nearest panel wins), else the nearest model in front of it.
  // Returns where the laser ends and what it points at.
  function aim(id: string, origin: Vector3, dir: Vector3): { length: number; target: 'panel' | 'model' | 'none' } {
    const panelDist = host.setRay(id, origin, dir);
    hovered.delete(id);
    rays.set(id, { origin: origin.clone(), dir: dir.clone() });
    if (grab && grab.pointer === id) {
      grab.seen = true;
      if (grab.phase !== 'pending') return { length: grabLaser, target: 'model' }; // the laser ends on the model's base
    }
    let best: { id: string; d: number } | null = null;
    if (current) {
      const limit = panelDist ?? 5;
      for (const m of current.models) {
        const house = houses.get(m.roomId);
        const holder = house?.layer.holders.get(m.id);
        if (!house?.root.visible || !holder) continue;
        const d = pickDistance(holder, origin, dir, best ? Math.min(limit, best.d) : limit);
        if (d !== null && d <= limit && (!best || d < best.d)) best = { id: m.id, d };
      }
    }
    if (panelDist !== null && (!best || panelDist <= best.d)) return { length: panelDist, target: 'panel' };
    if (best) {
      hovered.set(id, best.id);
      return { length: best.d, target: 'model' };
    }
    return { length: 3, target: 'none' };
  }

  // A pinch that the UI did not take: select what the pointer aims at, or clear the selection.
  function pressModel(id: string) {
    const target = hovered.get(id) ?? null;
    selectModel(target);
    // Holding the pinch drags the model (see updateGrab); a quick pinch only selects it.
    if (target) grab = { pointer: id, modelId: target, phase: 'pending', seen: true, t0: null, last: null, offset: new Vector3(), decay: true, two: null };
  }

  // ---- Grab: hold the right pinch on a model to drag it; add the left pinch to turn and scale it ----
  const DEADZONE = 0.03; // m the laser tip must travel before a pinch becomes a drag
  const REACH = 8; // m, farthest floor point a ray may drag to
  const GLIDE = 0.25; // s, the model slides from where it was under the laser to the laser tip, so it never jumps
  const SMOOTH = 14; // 1/s, low-pass on scale and turn against hand tracking noise
  const SCALE_START = 0.16; // change of the hands' distance (log ratio, about 17 %) before scaling starts
  const TURN_START = 0.3; // rad (about 17 degrees) before turning starts
  const CROSS = 3; // the other gesture needs this many times its threshold
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
    two: { dist0: number; prevAng: number; acc: number; yaw0: number; scale0: number; yaw: number; scale: number; scaleFrom: number; turnFrom: number } | null;
  }
  let grab: Grab | null = null;
  // Readout above the model during the two-hand gesture: the angle and size now, and what they were before.
  const hud = new Panel(0.4, 0.13, 1000, 'surface');
  hud.mesh.visible = false;
  host.root.add(hud.mesh);
  // Floating "Oggetto" button above the selected model: pointed at with the laser and pinched, it opens the model's menu.
  const objButton = new Panel(0.2, 0.07, 1000, 'surface');
  objButton.set([{ rect: { x: 6, y: 6, w: 188, h: 58 }, text: 'Oggetto', size: 34, primary: true, onClick: () => openObjectMenu() }]);
  objButton.mesh.visible = false;
  host.root.add(objButton.mesh);
  host.add(objButton);
  function openObjectMenu() {
    if (!selectedModel()) return;
    objectOpen = true;
    confirmDelete = false;
    colorPage = false;
    openMenu();
    refreshView();
  }
  function placeObjectButton(head: Head) {
    const m = selectedModel();
    const holder = m && houses.get(m.roomId)?.layer.holders.get(m.id);
    const top = holder && houses.get(m!.roomId)?.root.visible ? worldTop(holder) : null;
    objButton.mesh.visible = !!top && !grab && !rig.visible;
    if (!top) return;
    objButton.mesh.position.copy(top).y += 0.14;
    objButton.mesh.rotation.set(0, Math.atan2(head.pos.x - top.x, head.pos.z - top.z), 0);
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
  function showHud(m: RoomModel, holder: Group, yaw0: number, scale0: number) {
    const deg = (r: number) => ((Math.round((r * 180) / Math.PI) % 360) + 360) % 360;
    const dim = modelSize(holder);
    const size = dim ? `${(dim.x * m.scale).toFixed(2)} × ${(dim.y * m.scale).toFixed(2)} × ${(dim.z * m.scale).toFixed(2)} m` : '';
    const l1 = `Rotazione ${deg(m.yaw)}°   (era ${deg(yaw0)}°)${snapNote.includes('r') ? '  ⟂' : ''}`;
    const l2 = `Scala ×${m.scale.toFixed(2)}   (era ×${scale0.toFixed(2)})${snapNote.includes('s') ? '  ⟂' : ''}`;
    const text = `${l1}|${l2}|${size}`;
    if (text !== hudText) {
      hudText = text;
      const row = (t: string, y: number, h: number, size: number, color?: string) => ({ kind: 'label' as const, rect: { x: 10, y, w: hud.pxW - 20, h }, text: t, size, align: 'center' as const, color });
      hud.set([row(l1, 8, 40, 32), row(l2, 48, 40, 32), row(size, 88, 36, 26, theme().muted)]);
    }
    const top = new Box3().setFromObject(holder);
    hud.mesh.position.set((top.min.x + top.max.x) / 2, top.max.y + 0.18, (top.min.z + top.max.z) / 2);
    if (lastHead) hud.mesh.rotation.set(0, Math.atan2(lastHead.pos.x - hud.mesh.position.x, lastHead.pos.z - hud.mesh.position.z), 0);
    hud.mesh.visible = true;
    hud.draw();
  }
  let grabLaser = 1;
  let leftHeld = false;
  let pinchL: Vector3 | null = null;
  let pinchR: Vector3 | null = null;
  const rays = new Map<string, { origin: Vector3; dir: Vector3 }>();

  function pinchDown(hand: 'left' | 'right', id: string, consumedByUi: boolean) {
    if (hand === 'left') leftHeld = !consumedByUi;
    else if (!consumedByUi) pressModel(id);
  }
  function pinchUp(hand: 'left' | 'right', id: string) {
    if (hand === 'left') leftHeld = false;
    else if (grab?.pointer === id) endGrab();
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
    if (grab && grab.phase !== 'pending') say('Modello modificato (non salvato)', 2500);
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
      g.two = { dist0: L.distanceTo(R), prevAng: angleOf(L, R), acc: 0, yaw0: m.yaw, scale0: m.scale, yaw: m.yaw, scale: m.scale, scaleFrom: 0, turnFrom: 0 };
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
      // Turning the hands changes their distance a little and the other way round: one gesture engages first, the other
      // only if it is clearly intended (CROSS times its threshold). Past its threshold a gesture follows from zero.
      const ratio = Math.log(L.distanceTo(R) / t.dist0);
      const sNeed = SCALE_START * (t.turnFrom ? CROSS : 1);
      const tNeed = TURN_START * (t.scaleFrom ? CROSS : 1);
      if (!t.scaleFrom && Math.abs(ratio) > sNeed) t.scaleFrom = sNeed;
      if (!t.turnFrom && Math.abs(t.acc) > tNeed) t.turnFrom = tNeed;
      const past = (x: number, start: number) => Math.sign(x) * Math.max(0, Math.abs(x) - start);
      const wantScale = t.scaleFrom ? Math.min(t.scale0 * MAX_SCALE, Math.max(t.scale0 * MIN_SCALE, t.scale0 * Math.exp(past(ratio, t.scaleFrom)))) : t.scale0;
      const wantYaw = t.turnFrom ? t.yaw0 + past(t.acc, t.turnFrom) : t.yaw0;
      const snapped = view.snap ? snapTwo(m, t.yaw0, wantYaw, wantScale, t.turnFrom > 0, t.scaleFrom > 0) : { yaw: wantYaw, scale: wantScale, note: '' };
      t.yaw += (snapped.yaw - t.yaw) * k;
      t.scale += (snapped.scale - t.scale) * k;
      snapNote = snapped.note;
      m.yaw = t.yaw;
      m.scale = t.scale;
      house.layer.sync(modelsOf(m.roomId)); // position untouched: the model turns and grows on the spot
      showHud(m, holder, t.yaw0, t.scale0);
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
    refreshView();
  }

  render();
  return {
    host,
    roomRoot,
    houses: () => houses, // test hook
    // Test hook: every model's scene object, whichever room it is in.
    holders: () => new Map([...houses.values()].flatMap((h) => [...h.layer.holders])),
    // Every panel that should be shown as a WebXR layer (the wrist button is added by xrApp).
    layerPanels: () => [menu, keyboard.panel, listLoader, loading, splashPanel, hud, objButton],
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
    // The app is about to restart: say so (menu away, floating label) instead of just going black.
    showRestarting() {
      closeMenu();
      setLoadingText('Riavvio di Immersa');
      loading.mesh.visible = true;
    },
    planesGap(on: boolean) {
      if (on) closeMenu(); // no glimpse of the menu while the rooms are gone (the app is about to restart)
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
      if (loading.mesh.visible) {
        loading.mesh.position.set(head.pos.x + Math.sin(yawOf(head.fwd)) * 0.9, head.pos.y - 0.05, head.pos.z + Math.cos(yawOf(head.fwd)) * 0.9);
        loading.mesh.rotation.set(0, Math.atan2(head.pos.x - loading.mesh.position.x, head.pos.z - loading.mesh.position.z), 0);
        loading.draw();
      }
      if (splash) {
        if (splash.endAt === null && now - splash.since > SPLASH_MS && view.authKnown) splash.endAt = now;
        const gone = splash.endAt === null ? 0 : (now - splash.endAt) / 500; // half a second of fade-out
        if (gone >= 1) {
          splash = null;
          splashPanel.mesh.visible = false;
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
      }
      checkPending();
      followHead(head, dt);
      updateGrab(dt);
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
      say('Il visore ha cambiato riferimento: rileggo la stanza...', 5000);
    },
    aim,
    pinchDown,
    pinchUp,
    setPinchPoints(left: Vector3 | null, right: Vector3 | null) {
      pinchL = left;
      pinchR = right;
    },
    selected: () => selectedId,
    say,
    // Test hook.
    debug: () => ({ loading: loading.mesh.visible, rooms, recognised, projects: allProjects, current, aligned: [...aligns.keys()], foreign: foreign?.roomId ?? null, view, live: live.length, raw: rawLive.length, pending: pendingName() }),
  };
}

export type AppCore = ReturnType<typeof createAppCore>;
