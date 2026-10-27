import { Box3, Group, Scene, Vector3 } from 'three';
import type { Backend } from '../cloud/backend';
import type { Alignment } from '../room/align';
import { drawPlanes } from '../room/draw';
import { createModelLayer } from '../room/modelLayer';
import { isInside, recognizeRoom, type Recognised } from '../room/recognize';
import type { Project, Room, RoomPlane } from '../room/types';
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
const MIN_PLANES = 4; // fewer than this is not a usable room scan
const PENDING_KEY = 'immersa.pendingScanName';

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

  // The room's frame: saved rooms/projects live in it, the alignment maps it onto the session.
  const roomRoot = new Group();
  roomRoot.matrixAutoUpdate = false;
  roomRoot.visible = false;
  scene.add(roomRoot);
  const outline = new Group();
  outline.visible = false;
  roomRoot.add(outline);
  const layer = createModelLayer(roomRoot, (t) => say(`Modello: ${t}`));

  const view: MenuView = {
    tab: 'scan',
    email: null,
    roomName: null,
    candidate: null,
    resid: null,
    liveReady: false,
    captureAvailable: false,
    projects: null,
    currentProjectId: null,
    page: 0,
    outline: false,
    message: '',
  };
  let rooms: Room[] = [];
  let roomsLoaded = false;
  let recognised: Recognised | null = null;
  let candidate: Recognised | null = null; // matches the live scan but the user is not inside
  const ignored = new Set<string>(); // rooms the user said are not the one they are in
  let projects: Project[] = [];
  let projectsLoaded = false;
  let current: Project | null = null;
  let live: RoomPlane[] = [];
  let capture: Capture | null = null;
  let lastTry = 0;
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
    view.captureAvailable = !!capture?.available;
    view.projects = recognised && projectsLoaded ? projects.map((p) => ({ id: p.id, name: p.name, models: p.models.length })) : null;
    view.currentProjectId = current?.id ?? null;
    render();
  }

  const ask = (title: string, initial = '') =>
    new Promise<string | null>((resolve) => keyboard.open({ title, initial, onDone: resolve, onCancel: () => resolve(null) }));

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
  function setRecognised(r: Recognised | null) {
    recognised = r;
    projects = [];
    projectsLoaded = false;
    current = null;
    layer.sync([]);
    outline.clear();
    roomRoot.visible = !!r;
    if (r) {
      const a = r.alignment;
      // three's Y rotation is the opposite sense of our xz yaw.
      roomRoot.matrix.makeRotationY(-a.yaw).setPosition(a.tx, a.ty, a.tz);
      drawPlanes(r.room.scan.planes, outline);
      outline.visible = view.outline;
      if (autoTab) view.tab = 'load';
      backend
        .listProjects(r.room.id)
        .then((list) => {
          if (recognised !== r) return;
          projects = list;
          projectsLoaded = true;
          refreshView();
        })
        .catch((e) => say(`Errore: ${errText(e)}`));
    }
    refreshView();
  }

  function tryRecognise(now: number) {
    if (recognised || !roomsLoaded || !lastHead || live.length < MIN_PLANES || now < readyAt || now - lastTry < 2500) return;
    lastTry = now;
    const r = recognizeRoom(live, rooms.filter((x) => !ignored.has(x.id)));
    if (!r) {
      candidate = null;
      failedTries++;
      return refreshView();
    }
    const h = lastHead.pos;
    if (isInside(r, [h.x, h.y, h.z])) {
      candidate = null;
      return setRecognised(r);
    }
    // The headset reports this room's planes, but you are not in it: ask instead of assuming.
    const first = !candidate;
    candidate = r;
    failedTries++;
    if (first && autoTab) view.tab = 'scan';
    refreshView();
  }

  const identity = (n: number): Alignment => ({ yaw: 0, tx: 0, ty: 0, tz: 0, resid: 0, matched: n, total: n });

  async function saveRoom() {
    const planes = live; // the scan as it is now, even if the list changes while typing
    if (planes.length < MIN_PLANES) return say('Nessuna scansione da salvare');
    const name = await ask('Nome della stanza');
    if (!name) return;
    say('Salvo la stanza...');
    try {
      const room = await backend.createRoom(name, { version: 1, savedAt: Date.now(), planes });
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

  async function startScan() {
    if (!capture?.available) return say('Scansione non disponibile in questo browser');
    setPendingName(true); // after the scan (even if the session restarts) ask for a name
    say('Scansione in corso...', 60000);
    closeMenu();
    try {
      await capture.start();
    } catch (e) {
      setPendingName(false);
      openMenu();
      return say(`Scansione non riuscita: ${errText(e)}`);
    }
    lastTry = 0;
    failedTries = 0;
    readyAt = performance.now() + 2500; // let the new planes arrive
    openMenu();
    say('Scansione finita, leggo la stanza...');
  }

  // After a scan: once the new planes arrive, offer to name and save the room.
  function checkPending() {
    if (!pendingName() || !roomsLoaded || live.length < MIN_PLANES || keyboard.isOpen()) return;
    if (recognised) return setPendingName(false); // scanned again a room we already know
    if (failedTries < 1) return; // recognition has not had its chance yet
    setPendingName(false);
    view.tab = 'scan';
    openMenu();
    void saveRoom();
  }

  function openProject(p: Project) {
    current = p;
    layer.sync(p.models);
    closeMenu();
    refreshView();
    say(`Aperto: ${p.name}`);
  }

  const actions: MenuActions = {
    setTab(tab: Tab) {
      view.tab = tab;
      autoTab = false;
      render();
    },
    selectProject(id) {
      const p = projects.find((x) => x.id === id);
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
      outline.visible = view.outline;
      render();
    },
    signOut,
    close: closeMenu,
  };

  // Left pinch: move the model the user is looking at to the pinch point.
  function moveGazedModel(point: Vector3, head: Head) {
    if (!current || !recognised) return say('Apri un progetto dal menu (Load)');
    let best: Project['models'][number] | null = null;
    let bestDot = -2;
    for (const m of current.models) {
      const holder = layer.holders.get(m.id);
      if (!holder) continue;
      holder.updateWorldMatrix(true, true);
      const box = new Box3().setFromObject(holder);
      const c = box.isEmpty() ? holder.getWorldPosition(new Vector3()) : box.getCenter(new Vector3());
      const dot = head.fwd.dot(c.sub(head.pos).normalize());
      if (dot > bestDot) {
        bestDot = dot;
        best = m;
      }
    }
    if (!best) return say('Il progetto non ha modelli');
    roomRoot.updateWorldMatrix(true, false);
    const local = roomRoot.worldToLocal(point.clone());
    best.pos = [local.x, local.y, local.z];
    layer.sync(current.models);
    const target = best;
    backend
      .saveProject(current.id, { models: current.models })
      .then(() => say(`Spostato: ${target.name}`, 3000))
      .catch((e) => say(`Salvataggio fallito: ${errText(e)}`));
  }

  async function reloadRooms() {
    try {
      view.email = await backend.email();
      rooms = await backend.listRooms();
      roomsLoaded = true;
    } catch (e) {
      say(`Errore: ${errText(e)}`);
    }
    refreshView();
  }

  render();
  return {
    host,
    layer,
    roomRoot,
    keyboard,
    panels: { menu, keyboard: keyboard.panel },
    menu: { open: openMenu, close: closeMenu, toggle: () => (rig.visible ? closeMenu() : openMenu()), isOpen: () => rig.visible },
    // A new XR session has a new origin: forget the old alignment and start over.
    sessionStarted(cap: Capture | null) {
      capture = cap;
      autoTab = true;
      view.tab = 'scan';
      live = [];
      lastTry = 0;
      failedTries = 0;
      readyAt = 0;
      candidate = null;
      ignored.clear();
      setRecognised(null);
      void reloadRooms();
      openMenu();
    },
    setLivePlanes(planes: RoomPlane[]) {
      const ready = planes.length >= MIN_PLANES;
      live = planes;
      if (ready !== view.liveReady) refreshView();
    },
    tick(now: number, head: Head, dt: number) {
      lastHead = head;
      tryRecognise(now);
      checkPending();
      followHead(head, dt);
      host.update();
    },
    moveGazedModel,
    say,
    // Test hook.
    debug: () => ({ rooms, recognised, projects, current, view, live: live.length, pending: pendingName() }),
  };
}

export type AppCore = ReturnType<typeof createAppCore>;
