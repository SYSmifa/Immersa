import { Box3, Group, Matrix4, Scene, Vector3 } from 'three';
import type { Backend } from '../cloud/backend';
import { alignPlanes, type Alignment } from '../room/align';
import { drawBoxes, drawPlanes } from '../room/draw';
import { buildOccluders, createOccluderMaterial, showOccluders } from '../room/occluders';
import { floorCentre } from '../room/floor';
import { createModelLayer, type ModelLayer } from '../room/modelLayer';
import { roomAround, roomClusters } from '../room/around';
import { isGoodFit, isInside, recognizeRoom, type Recognised } from '../room/recognize';
import type { Project, Room, RoomBox, RoomModel, RoomPlane } from '../room/types';
import { UiHost } from '../ui3d/host';
import { createKeyboard } from '../ui3d/keyboard';
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
  scene: Scene;
  backend: Backend;
  signOut(): void;
}

const MENU_DISTANCE = 0.85;
const OUTLINE_WIDTH = 0.015; // m: thickness of the room outline in the headset
const STALE_RESID = 0.03; // m: a recognised room whose planes fit worse than this has a stale saved scan
const MIN_PLANES = 4; // fewer than this is not a usable room scan
const PENDING_KEY = 'immersa.pendingScanName';
const RESUME_KEY = 'immersa.resumeProject'; // set when the session is restarted after standby
// The installed app closes when the headset sleeps; opening it again brings back the last open project.
export const LAST_PROJECT_KEY = 'immersa.lastProject';
const LAST_PROJECT_MS = 60 * 60 * 1000;
const lastProject = {
  save(id: string) {
    try {
      localStorage.setItem(LAST_PROJECT_KEY, JSON.stringify({ id, at: Date.now() }));
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
  recent(): string | null {
    try {
      const v = JSON.parse(localStorage.getItem(LAST_PROJECT_KEY) ?? 'null') as { id: string; at: number } | null;
      return v && Date.now() - v.at < LAST_PROJECT_MS ? v.id : null;
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
export function createAppCore({ scene, backend, signOut }: Options) {
  const host = new UiHost();
  scene.add(host.root);
  const rig = new Group(); // menu + keyboard, follows the head
  rig.visible = false;
  host.root.add(rig);
  const menu = new Panel(MENU_W / 1200, MENU_H / 1200, 1200);
  rig.add(menu.mesh);
  host.add(menu);
  const keyboard = createKeyboard(host, rig);
  // Floating "Loading project…" label (not interactive) shown while a project is reopened after standby.
  const loading = new Panel(0.5, 0.1, 1200);
  loading.set([{ kind: 'label', rect: { x: 0, y: 0, w: loading.pxW, h: loading.pxH }, text: 'Loading project…', size: 44, align: 'center' }]);
  loading.mesh.visible = false;
  host.root.add(loading.mesh);

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
    page: 0,
    outline: true,
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
    outline.visible = view.outline && !current; // with a project open the models are the point
    render();
  }

  const ask = (title: string, initial = '', opts: { max?: number; secret?: boolean; capital?: boolean } = {}) =>
    new Promise<string | null>((resolve) => keyboard.open({ title, initial, ...opts, onDone: resolve, onCancel: () => resolve(null) }));
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
      h.root.visible = !!a || foreign?.roomId === id;
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

  function loadProjects() {
    backend
      .listProjects()
      .then((list) => {
        allProjects = list;
        projectsLoaded = true;
        if (current) current = list.find((p) => p.id === current!.id) ?? current;
        refreshView();
      })
      .catch((e) => say(`Errore: ${errText(e)}`));
  }

  function setRecognised(r: Recognised | null) {
    recognised = r;
    outline.clear();
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
      if (moved(recognised!.alignment, found.alignment, found.room.id)) {
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
    current = p;
    // Align every room of the project now (the headset reports them all), so it opens in the right places.
    for (const id of p.roomIds) {
      const room = rooms.find((r) => r.id === id);
      if (!room || aligns.has(id)) continue;
      const fit = bestFit(room);
      if (fit) aligns.set(id, fit);
    }
    foreignMode = !p.roomIds.some((id) => aligns.has(id));
    lastProject.save(p.id);
    syncHouses();
    closeMenu();
    refreshView();
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
      view.tab = 'scan';
      say('Signed in');
    },
    setTab(tab: Tab) {
      view.tab = tab;
      autoTab = false;
      render();
    },
    selectProject(id) {
      const p = allProjects.find((x) => x.id === id);
      if (p) openProject(p);
    },
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
      lastProject.clear();
      closeCurrent();
      refreshView();
    },
    signOut,
    close: closeMenu,
  };

  // Left pinch: move the model the user is looking at to the pinch point.
  function moveGazedModel(point: Vector3, head: Head) {
    if (!current) return say('Apri un progetto dal menu (Load)');
    let best: { model: RoomModel; house: House } | null = null;
    let bestDot = -2;
    for (const m of current.models) {
      const house = houses.get(m.roomId);
      const holder = house?.layer.holders.get(m.id);
      if (!house || !holder || !house.root.visible) continue;
      holder.updateWorldMatrix(true, true);
      const box = new Box3().setFromObject(holder);
      const c = box.isEmpty() ? holder.getWorldPosition(new Vector3()) : box.getCenter(new Vector3());
      const dot = head.fwd.dot(c.sub(head.pos).normalize());
      if (dot > bestDot) {
        bestDot = dot;
        best = { model: m, house };
      }
    }
    if (!best) return say('Il progetto non ha modelli qui');
    const { model, house } = best;
    house.root.updateWorldMatrix(true, false);
    const local = house.root.worldToLocal(point.clone());
    model.pos = [local.x, local.y, local.z];
    house.layer.sync(modelsOf(model.roomId));
    backend
      .saveProject(current.id, { models: current.models })
      .then(() => say(`Spostato: ${model.name}`, 3000))
      .catch((e) => say(`Salvataggio fallito: ${errText(e)}`));
  }

  async function reloadRooms() {
    try {
      view.email = await backend.email();
      view.authKnown = true;
      if (view.email) {
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
    keyboard,
    panels: { menu, keyboard: keyboard.panel },
    menu: { open: openMenu, close: closeMenu, toggle: () => (rig.visible ? closeMenu() : openMenu()), isOpen: () => rig.visible },
    // A new XR session has a new origin: forget the old alignment and start over.
    sessionStarted(cap: Capture | null) {
      capture = cap;
      const saved = sessionStorage.getItem(RESUME_KEY) ?? lastProject.recent();
      sessionStorage.removeItem(RESUME_KEY);
      scanning = false;
      resumePending = saved ? { id: saved, since: performance.now() } : null;
      autoTab = true;
      view.tab = 'scan';
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
      else openMenu();
    },
    // After a standby the session stays open but may see no rooms: say so and point to Scan, which reads them again.
    roomDataLost() {
      view.tab = 'scan';
      autoTab = false;
      openMenu();
      say('Room data lost in standby: tap Scan.', 20000);
    },
    setLivePlanes(planes: RoomPlane[], boxes: RoomBox[] = []) {
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
      if (resumePending) {
        loading.mesh.position.set(head.pos.x + Math.sin(yawOf(head.fwd)) * 0.9, head.pos.y - 0.05, head.pos.z + Math.cos(yawOf(head.fwd)) * 0.9);
        loading.mesh.rotation.set(0, Math.atan2(head.pos.x - loading.mesh.position.x, head.pos.z - loading.mesh.position.z), 0);
        loading.draw();
        const since = now - resumePending.since;
        if (projectsLoaded && (aligns.size > 0 || since > 12000)) {
          const p = allProjects.find((x) => x.id === resumePending!.id);
          resumePending = null;
          loading.mesh.visible = false;
          if (p) openProject(p);
          else failResume();
        } else if (since > 30000) {
          resumePending = null;
          failResume(); // the project list never arrived
        }
      }
      checkPending();
      followHead(head, dt);
      host.update();
    },
    logEvent,
    isScanning: () => scanning,
    // Called just before the session is restarted: remember which project to reopen.
    prepareResume() {
      if (current) sessionStorage.setItem(RESUME_KEY, current.id);
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
    moveGazedModel,
    say,
    // Test hook.
    debug: () => ({ rooms, recognised, projects: allProjects, current, aligned: [...aligns.keys()], foreign: foreign?.roomId ?? null, view, live: live.length, raw: rawLive.length, pending: pendingName() }),
  };
}

export type AppCore = ReturnType<typeof createAppCore>;
