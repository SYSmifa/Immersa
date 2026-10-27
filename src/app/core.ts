import { Box3, Group, Matrix4, Scene, Vector3 } from 'three';
import type { Backend } from '../cloud/backend';
import type { Alignment } from '../room/align';
import { drawBoxes, drawPlanes } from '../room/draw';
import { floorCentre } from '../room/floor';
import { createModelLayer } from '../room/modelLayer';
import { roomAround } from '../room/around';
import { isInside, recognizeRoom, type Recognised } from '../room/recognize';
import type { Project, Room, RoomBox, RoomPlane } from '../room/types';
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

  // The recognised room's frame (only its outline lives here); the alignment maps it onto the session.
  const roomRoot = new Group();
  roomRoot.matrixAutoUpdate = false;
  roomRoot.visible = false;
  scene.add(roomRoot);
  const outline = new Group();
  outline.visible = true;
  roomRoot.add(outline);
  // The open project's frame: the project's own room frame, placed by `placement()`.
  const projectRoot = new Group();
  projectRoot.matrixAutoUpdate = false;
  scene.add(projectRoot);
  const layer = createModelLayer(projectRoot, (t) => say(`Modello: ${t}`));

  const view: MenuView = {
    tab: 'scan',
    email: null,
    roomName: null,
    candidate: null,
    info: '',
    resid: null,
    liveReady: false,
    captureAvailable: false,
    projects: null,
    currentProjectId: null,
    page: 0,
    outline: true,
    message: '',
  };
  let rooms: Room[] = [];
  let roomsLoaded = false;
  let recognised: Recognised | null = null;
  let candidate: Recognised | null = null; // matches the live scan but the user is not inside
  const ignored = new Set<string>(); // rooms the user said are not the one they are in
  let allProjects: Project[] = []; // every project of the account, in any room
  let projectsLoaded = false;
  let current: Project | null = null;
  let nativeRoomId: string | null = null; // set when the open project sits in its own, recognised room
  let rawLive: RoomPlane[] = []; // everything the headset reports (may include other rooms)
  let rawBoxes: RoomBox[] = [];
  let live: RoomPlane[] = []; // only the room you are standing in
  let liveBoxes: RoomBox[] = [];
  let lastHere = 0;
  let capture: Capture | null = null;
  let lastTry = 0;
  let switching = 0; // consecutive checks that found another saved room under the head
  let lost = 0; // consecutive checks that found none
  let resume: { roomId: string; projectId: string } | null = null; // project to reopen if we come back
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
    const here = (p: Project) => p.roomId === recognised?.room.id;
    view.projects = projectsLoaded
      ? [...allProjects]
          .sort((a, b) => Number(here(b)) - Number(here(a)) || b.updatedAt.localeCompare(a.updatedAt))
          .map((p) => ({ id: p.id, name: p.name, models: p.models.length, room: roomName(p.roomId), here: here(p) }))
      : null;
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
  function closeCurrent() {
    current = null;
    nativeRoomId = null;
    layer.sync([]);
  }

  // Where the project's own frame goes. In its own room: exactly as laid out on the PC.
  // In another room (or none): its floor centre goes to this room's floor centre (or under
  // your feet), orientation as saved, so the models keep their layout relative to each other.
  function placement(p: Project): { matrix: Matrix4; native: boolean } {
    const align = (a: Alignment) => new Matrix4().makeRotationY(-a.yaw).setPosition(a.tx, a.ty, a.tz);
    if (recognised && recognised.room.id === p.roomId) return { matrix: align(recognised.alignment), native: true };
    const home = rooms.find((r) => r.id === p.roomId);
    const pivot = home ? floorCentre(home.scan.planes) : ([0, 0, 0] as const);
    if (recognised) {
      const t = floorCentre(recognised.room.scan.planes);
      const shift = new Matrix4().makeTranslation(t[0] - pivot[0], t[1] - pivot[1], t[2] - pivot[2]);
      return { matrix: align(recognised.alignment).multiply(shift), native: false };
    }
    const h = lastHead?.pos;
    const floorY = live.find((x) => x.label === 'floor')?.pos[1] ?? (h ? h.y - 1.5 : 0);
    return { matrix: new Matrix4().makeTranslation((h?.x ?? 0) - pivot[0], floorY - pivot[1], (h?.z ?? 0) - pivot[2]), native: false };
  }

  function placeProject(p: Project) {
    const { matrix, native } = placement(p);
    current = p;
    nativeRoomId = native ? p.roomId : null;
    projectRoot.matrix.copy(matrix);
    layer.sync(p.models);
  }

  function loadProjects() {
    backend
      .listProjects()
      .then((list) => {
        allProjects = list;
        projectsLoaded = true;
        // We left this project's room and came back: reopen it.
        const back = !current && recognised && resume?.roomId === recognised.room.id ? list.find((p) => p.id === resume!.projectId) : undefined;
        if (back) placeProject(back);
        refreshView();
      })
      .catch((e) => say(`Errore: ${errText(e)}`));
  }

  function setRecognised(r: Recognised | null) {
    // A project laid out in the old room's frame stays behind with that room; one placed
    // freely (opened from another room) goes with you.
    if (current && nativeRoomId) {
      resume = { roomId: nativeRoomId, projectId: current.id };
      closeCurrent();
    }
    recognised = r;
    outline.clear();
    roomRoot.visible = !!r;
    if (r) {
      const a = r.alignment;
      // three's Y rotation is the opposite sense of our xz yaw.
      roomRoot.matrix.makeRotationY(-a.yaw).setPosition(a.tx, a.ty, a.tz);
      drawPlanes(r.room.scan.planes, outline);
      drawBoxes(r.room.scan.boxes ?? [], outline);
      outline.visible = view.outline;
      if (autoTab) view.tab = 'load';
    }
    loadProjects();
    refreshView();
  }

  // Walking into another room changes which room we are in: leave the old one after a few
  // consecutive checks (no flicker in doorways), switch to the new saved one, remember the project.
  function reconsider(found: Recognised | null) {
    if (found && found.room.id === recognised!.room.id) {
      switching = lost = 0;
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
    const found = live.length >= MIN_PLANES ? recognizeRoom(live, rooms.filter((x) => !ignored.has(x.id))) : null;
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
    placeProject(p);
    closeMenu();
    refreshView();
    const away = !recognised || recognised.room.id !== p.roomId;
    say(away ? `Aperto: ${p.name} (di un'altra stanza, posizione e orientamento approssimativi)` : `Aperto: ${p.name}`, away ? 9000 : 7000);
  }

  const actions: MenuActions = {
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
      outline.visible = view.outline;
      render();
    },
    closeProject() {
      closeCurrent();
      resume = null;
      refreshView();
    },
    signOut,
    close: closeMenu,
  };

  // Left pinch: move the model the user is looking at to the pinch point.
  function moveGazedModel(point: Vector3, head: Head) {
    if (!current) return say('Apri un progetto dal menu (Load)');
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
    projectRoot.updateWorldMatrix(true, false);
    const local = projectRoot.worldToLocal(point.clone());
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

  // Keep `live` = the planes of the room around the head; re-run when planes or head change.
  function recompute() {
    const h = lastHead?.pos;
    const here = h ? roomAround(rawLive, rawBoxes, [h.x, h.y, h.z]) : { planes: rawLive, boxes: rawBoxes };
    live = here.planes;
    liveBoxes = here.boxes;
    const info = `Piani qui ${live.length} / visti ${rawLive.length}`;
    if (info !== view.info || live.length >= MIN_PLANES !== view.liveReady) refreshView();
  }

  render();
  return {
    host,
    layer,
    roomRoot,
    projectRoot,
    keyboard,
    panels: { menu, keyboard: keyboard.panel },
    menu: { open: openMenu, close: closeMenu, toggle: () => (rig.visible ? closeMenu() : openMenu()), isOpen: () => rig.visible },
    // A new XR session has a new origin: forget the old alignment and start over.
    sessionStarted(cap: Capture | null) {
      capture = cap;
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
      resume = null;
      ignored.clear();
      closeCurrent();
      setRecognised(null);
      void reloadRooms();
      openMenu();
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
      checkPending();
      followHead(head, dt);
      host.update();
    },
    moveGazedModel,
    say,
    // Test hook.
    debug: () => ({ rooms, recognised, projects: allProjects, current, nativeRoomId, view, live: live.length, raw: rawLive.length, pending: pendingName() }),
  };
}

export type AppCore = ReturnType<typeof createAppCore>;
