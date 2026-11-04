import { theme } from './theme';
import { hsvToHex, type Hsv } from './color';
import type { IconName } from './icons';
import type { Widget } from './panel';

export type Tab = 'load' | 'scan' | 'options' | 'account';

// The selected model's own menu (opened from the floating button above it).
export interface ObjectView {
  name: string;
  yawDeg: number;
  scale: number;
  size: string; // real size in metres, '' while the file loads
  color: string | null;
  confirmDelete: boolean;
  colorPage: boolean; // the colour page instead of the main one
  materials: { name: string; color: string }[]; // each with the colour it shows now
  target: 'all' | number; // what the colour page changes
  matPage: number;
  hsv: Hsv; // the colour in the picker
  finish: { roughness: number; metalness: number }; // of the target, as shown now
}

export const OBJECT_COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#eceff1', '#424242'];

export interface MenuView {
  object: ObjectView | null; // set: the menu shows this instead of the tabs
  tab: Tab;
  email: string | null;
  startup: string; // seconds since the page loaded for each start-up step
  authKnown: boolean; // we know whether someone is signed in (else: still checking)
  loginEmail: string; // typed in the in-AR sign-in
  loginPassLen: number;
  roomName: string | null; // recognised (saved) room
  info: string; // how many planes the headset reports / belong to this room
  candidate: string | null; // saved room the headset reports, but you do not seem to be inside it
  resid: number | null; // alignment error of that room, metres
  liveReady: boolean; // the headset currently exposes a scanned room
  captureAvailable: boolean; // the page may start a scan itself
  projectName: string | null; // the open project
  events: string[]; // recent session events (standby, resume, resets)
  log: string[]; // the same events kept across app restarts (shown in Account)
  fits: string[]; // how well each room's saved planes match the live scan (diagnostics)
  projects: { id: string; name: string; models: number; rooms: string; here: boolean }[] | null; // all of them, this room's first
  currentProjectId: string | null;
  unsaved: boolean; // models moved in the headset and not saved yet
  page: number;
  outline: boolean;
  layers: boolean; // panels drawn as WebXR layers (sharper)
  fps: boolean; // fps readout in the headset
  dominant: 'left' | 'right'; // the hand that points with the laser
  snap: boolean; // magnetic snap of rotation and scale (two-hand gesture)
  showOccluders: boolean;
  message: string;
}

export interface MenuActions {
  setTab(tab: Tab): void;
  selectProject(id: string): void;
  turnPage(delta: number): void;
  saveRoom(): void;
  renameRoom(): void;
  confirmCandidate(): void;
  notThisRoom(): void;
  scan(): void;
  reread(): void;
  toggleOutline(): void;
  toggleSnap(): void;
  toggleLayers(): void;
  toggleFps(): void;
  toggleHand(): void;
  toggleOccluders(): void;
  closeProject(): void;
  objRotation(): void;
  objScale(): void;
  objColor(hex: string | null): void;
  objOpenColor(): void;
  objColorBack(): void;
  objColorTarget(t: 'all' | number): void;
  objMatPage(delta: number): void;
  objPick(h: number | null, s: number | null, v: number | null): void;
  objFinish(key: 'roughness' | 'metalness', value: number): void;
  objDelete(): void;
  objDeleteYes(): void;
  objDeleteNo(): void;
  objClose(): void;
  saveChanges(): void;
  signOut(): void;
  askEmail(): void;
  askPassword(): void;
  signIn(signUp: boolean): void;
  close(): void;
}

export const MENU_W = 864;
export const MENU_H = 624;
export const PER_PAGE = 4;
const M = 28; // outer margin
const W = MENU_W - 2 * M;
const TABS: [Tab, string, IconName][] = [
  ['load', 'Progetti', 'folder'],
  ['scan', 'Stanza', 'room_iso'],
  ['options', 'Opzioni', 'sliders'],
  ['account', 'Account', 'user'],
];
const NAV_Y = 520;
const ROWS = 5;

// Shared pieces ---------------------------------------------------------------------------------------------------
const title = (text: string, x = M): Widget => ({ kind: 'label', rect: { x, y: 22, w: 520, h: 56 }, text, size: 44, bold: true, color: theme().headerText });
const subtitle = (text: string, x = M): Widget => ({ kind: 'label', rect: { x, y: 78, w: 560, h: 30 }, text, size: 21, color: theme().headerSub });
const closeButton = (a: MenuActions): Widget => ({ kind: 'iconbtn', icon: 'close', rect: { x: MENU_W - M - 54, y: 22, w: 54, h: 54 }, text: '', onClick: a.close });
const backButton = (onClick: () => void): Widget => ({ kind: 'iconbtn', icon: 'back', rect: { x: M, y: 22, w: 54, h: 54 }, text: '', onClick });
const surface = (x: number, y: number, w: number, h: number): Widget => ({ kind: 'surface', rect: { x, y, w, h }, text: '' });
const text = (t: string, x: number, y: number, w: number, h: number, size = 24, color?: string, o: Partial<Widget> = {}): Widget => ({ kind: 'label', rect: { x, y, w, h }, text: t, size, color, ...o });
// A short message floats above the bottom bar like a toast.
const toast = (msg: string, y = 472): Widget[] => [
  { kind: 'chip', rect: { x: M + 40, y, w: W - 80, h: 42 }, text: msg, size: 21, fill: theme().surface, color: theme().text2 },
];

function navBar(v: MenuView, a: MenuActions, out: Widget[]) {
  out.push(surface(M - 4, NAV_Y, W + 8, 84));
  const tw = (W + 8) / TABS.length;
  TABS.forEach(([tab, name, icon], i) => out.push({ kind: 'nav', icon, rect: { x: M - 4 + i * tw, y: NAV_Y, w: tw, h: 84 }, text: name, active: v.tab === tab, onClick: () => a.setTab(tab) }));
}

// "Salva" pill in the header while there are unsaved changes.
function saveButton(v: MenuView, a: MenuActions, out: Widget[]) {
  if (v.currentProjectId && v.unsaved) out.push({ kind: 'pill', icon: 'check', primary: true, rect: { x: MENU_W - M - 54 - 14 - 176, y: 25, w: 176, h: 48 }, text: 'Salva', size: 24, onClick: a.saveChanges });
}

const ptTone = (name: string) => name.length;

// Object menu --------------------------------------------------------------------------------------------------
// Colour page: pick what to change (all materials or one), then the colour on a wheel, a brightness bar or presets.
function colorPage(o: ObjectView, out: Widget[], a: MenuActions): Widget[] {
  out.push(backButton(a.objColorBack), title('Colore', M + 70), subtitle(o.name, M + 70), closeButton(a));
  const items: { name: string; color: string | null; t: 'all' | number }[] = [
    { name: 'Tutti i materiali', color: o.color, t: 'all' },
    ...o.materials.map((m, i) => ({ name: m.name, color: m.color, t: i })),
  ];
  const pages = Math.max(1, Math.ceil(items.length / ROWS));
  const page = Math.min(o.matPage, pages - 1);
  // left: what to change
  out.push(surface(M, 104, 352, 322));
  items.slice(page * ROWS, (page + 1) * ROWS).forEach((it, i) =>
    out.push({ kind: 'row', rect: { x: M + 12, y: 116 + i * 56, w: 328, h: 50 }, text: it.name, size: 22, swatch: it.color ?? undefined, active: o.target === it.t, onClick: () => a.objColorTarget(it.t) }),
  );
  if (pages > 1) {
    out.push({ kind: 'iconbtn', icon: 'left', fill: theme().accentSoft, color: theme().accentText, rect: { x: M + 14, y: 382, w: 36, h: 36 }, text: '', disabled: page === 0, onClick: () => a.objMatPage(-1) });
    out.push(text(`${page + 1} / ${pages}`, M + 60, 382, 232, 36, 20, theme().dim, { align: 'center' }));
    out.push({ kind: 'iconbtn', icon: 'right', fill: theme().accentSoft, color: theme().accentText, rect: { x: M + 302, y: 382, w: 36, h: 36 }, text: '', disabled: page >= pages - 1, onClick: () => a.objMatPage(1) });
  }
  // right: the colour
  const [h, s, v] = o.hsv;
  out.push(surface(400, 104, MENU_W - M - 400, 322));
  out.push({ kind: 'wheel', rect: { x: 420, y: 118, w: 230, h: 230 }, text: '', hsv: o.hsv, onPoint: (fx, fy) => a.objPick((Math.atan2(fy - 0.5, fx - 0.5) / (2 * Math.PI) + 1) % 1, Math.min(1, Math.hypot(fx - 0.5, fy - 0.5) * 2), null) });
  out.push({ kind: 'chip', rect: { x: 684, y: 132, w: 124, h: 124 }, text: '', fill: hsvToHex(h, s, v) });
  out.push(text(hsvToHex(h, s, v).toUpperCase(), 684, 268, 124, 34, 22, theme().text2, { align: 'center', bold: true }));
  out.push({ kind: 'slider', rect: { x: 424, y: 362, w: 384, h: 32 }, text: '', hsv: o.hsv, onPoint: (fx) => a.objPick(null, null, fx) });
  out.push(text('Verso il centro: più chiaro · barra: più scuro', 424, 396, 390, 24, 17, theme().dim));
  // presets
  const n = OBJECT_COLORS.length + 1;
  const gap = 8;
  const pw = (W - (n - 1) * gap) / n;
  out.push({ rect: { x: M, y: 438, w: pw, h: 50 }, text: 'Orig.', size: 20, onClick: () => a.objColor(null) });
  OBJECT_COLORS.forEach((c, i) => out.push({ rect: { x: M + (i + 1) * (pw + gap), y: 438, w: pw, h: 50 }, text: '●', size: 38, color: c, onClick: () => a.objColor(c) }));
  // finish
  out.push(surface(M, 500, W, 108));
  const bar = (key: 'roughness' | 'metalness', name: string, y: number) => {
    out.push(text(name, M + 24, y, 200, 36, 22, theme().text2, { bold: true }));
    out.push(text(o.finish[key].toFixed(2), M + 160, y, 60, 36, 21, theme().dim));
    out.push({ kind: 'bar', rect: { x: M + 230, y, w: W - 230 - 28, h: 36 }, text: '', value: o.finish[key], onPoint: (fx) => a.objFinish(key, Math.round(fx * 100) / 100) });
  };
  bar('roughness', 'Rugosità', 512);
  bar('metalness', 'Metallico', 558);
  return out;
}

function objectPage(o: ObjectView, out: Widget[], a: MenuActions, message: string): Widget[] {
  if (o.colorPage) return colorPage(o, out, a);
  out.push(backButton(a.objClose), title('Oggetto', M + 70), subtitle(o.name, M + 70), closeButton(a));
  const half = (W - 16) / 2;
  out.push({ kind: 'card', icon: 'rotate', rect: { x: M, y: 112, w: half, h: 104 }, text: `${o.yawDeg}°`, sub: 'Rotazione', size: 34, onClick: a.objRotation });
  out.push({ kind: 'card', icon: 'scale', rect: { x: M + half + 16, y: 112, w: half, h: 104 }, text: `×${o.scale.toFixed(2)}`, sub: 'Scala', size: 34, onClick: a.objScale });
  if (o.size) out.push({ kind: 'chip', rect: { x: M, y: 230, w: 440, h: 40 }, text: `Dimensioni reali  ${o.size}`, size: 19, fill: theme().glass });
  out.push({ kind: 'card', icon: 'palette', rect: { x: M, y: 284, w: W, h: 100 }, text: 'Colore e materiali', sub: o.color ? `Tinta ${o.color.toUpperCase()}` : 'Colori originali del modello', swatch: o.color ?? undefined, onClick: a.objOpenColor });
  if (o.confirmDelete) {
    out.push(surface(M, 404, W, 176));
    out.push(text(`Eliminare "${o.name}"?`, M + 28, 420, W - 56, 44, 30, theme().bad, { bold: true }));
    out.push(text('Sparisce dal progetto; per tenerla ricordati di non salvare.', M + 28, 464, W - 56, 30, 20, theme().dim));
    const bw = (W - 28 * 2 - 14) / 2;
    out.push({ kind: 'pill', rect: { x: M + 28, y: 508, w: bw, h: 56 }, text: 'Annulla', size: 24, onClick: a.objDeleteNo });
    out.push({ kind: 'pill', icon: 'trash', primary: true, rect: { x: M + 28 + bw + 14, y: 508, w: bw, h: 56 }, text: 'Sì, elimina', size: 24, onClick: a.objDeleteYes });
  } else {
    out.push({ kind: 'pill', icon: 'trash', rect: { x: M, y: 404, w: W, h: 64 }, text: 'Elimina oggetto', size: 26, color: theme().bad, onClick: a.objDelete });
  }
  if (message) out.push(...toast(message));
  return out;
}

// Pure description of the menu for the current state; the panel just draws it.
export function buildMenu(v: MenuView, a: MenuActions): Widget[] {
  const out: Widget[] = [];
  const T = theme();

  if (!v.authKnown || !v.email) {
    // Sign in inside AR: the page has no 2D login (a store PWA must be immersive only).
    out.push(title('Immersa'));
    if (!v.authKnown) {
      out.push(subtitle('Carico...'));
    } else {
      const ready = !!v.loginEmail && v.loginPassLen > 0;
      out.push(subtitle('Accedi al tuo account'));
      out.push(surface(M, 128, W, 390));
      out.push({ kind: 'row', rect: { x: M + 24, y: 152, w: W - 48, h: 64 }, text: v.loginEmail ? v.loginEmail : 'Tocca per scrivere la email', size: 26, align: 'left', onClick: a.askEmail });
      out.push({ kind: 'row', rect: { x: M + 24, y: 232, w: W - 48, h: 64 }, text: v.loginPassLen ? '•'.repeat(Math.min(v.loginPassLen, 16)) : 'Tocca per scrivere la password', size: 26, align: 'left', onClick: a.askPassword });
      out.push({ kind: 'pill', primary: true, rect: { x: M + 24, y: 326, w: W - 48, h: 64 }, text: 'Accedi', size: 28, disabled: !ready, onClick: () => a.signIn(false) });
      out.push({ kind: 'pill', rect: { x: M + 24, y: 406, w: W - 48, h: 64 }, text: 'Crea account', size: 26, disabled: !ready, onClick: () => a.signIn(true) });
    }
    if (v.message) out.push(...toast(v.message, 540));
    return out;
  }

  if (v.object) return objectPage(v.object, out, a, v.message);

  const project = v.projectName ? ` · ${v.projectName}` : '';
  const where = v.roomName
    ? `Stanza aperta${project}`
    : v.candidate
      ? 'Stanza non confermata'
      : v.liveReady
        ? `Stanza non salvata${project}`
        : `Nessuna stanza scansionata${project}`;
  const heading: Record<Tab, string> = { load: 'Progetti', scan: 'Stanza', options: 'Opzioni', account: 'Account' };
  out.push(title(heading[v.tab]), subtitle(where), closeButton(a));
  saveButton(v, a, out);
  navBar(v, a, out);

  const top = 124;
  if (v.tab === 'load') {
    if (v.projects === null) {
      // the animated loading logo is a panel of its own (see core.ts)
    } else if (!v.projects.length) {
      out.push(surface(M, top, W, 150));
      out.push(text('Non ci sono ancora progetti.\nCreane uno dal PC e salvalo con un nome.', M + 28, top + 24, W - 56, 110, 26, T.text2, { wrap: true }));
    } else {
      const pages = Math.ceil(v.projects.length / PER_PAGE);
      const page = Math.min(v.page, pages - 1);
      v.projects.slice(page * PER_PAGE, (page + 1) * PER_PAGE).forEach((p, i) => {
        const open = p.id === v.currentProjectId;
        out.push({
          kind: 'card',
          rect: { x: M, y: top + i * 94, w: W, h: 84 },
          text: p.name,
          sub: `${p.rooms}${p.here ? '' : ' (altra stanza)'} · ${p.models} ${p.models === 1 ? 'modello' : 'modelli'}`,
          tone: ptTone(p.name),
          active: open,
          reserve: open ? 150 : undefined, // room for the "Chiudi" button drawn over the card
          onClick: () => a.selectProject(p.id),
        });
        // The open project has its own close button instead of the "Aperto" label (the one in Options stays too).
        if (open) {
          out.push({ kind: 'pill', fill: '#ffffff', hoverFill: T.bad, color: T.accentText, icon: 'close', rect: { x: M + W - 18 - 150, y: top + i * 94 + 18, w: 150, h: 48 }, text: 'Chiudi', size: 22, onClick: a.closeProject });
        }
      });
      if (pages > 1) {
        const y = top - 4 - 0;
        out.push({ kind: 'iconbtn', icon: 'left', rect: { x: MENU_W - M - 54 - 14 - 100, y: 80, w: 36, h: 36 }, text: '', disabled: page === 0, onClick: () => a.turnPage(-1) });
        out.push({ kind: 'chip', rect: { x: MENU_W - M - 54 - 14 - 100 + 42, y: 80, w: 64, h: 36 }, text: `${page + 1}/${pages}`, size: 18 });
        out.push({ kind: 'iconbtn', icon: 'right', rect: { x: MENU_W - M - 54 - 14 - 100 + 112, y: 80, w: 36, h: 36 }, text: '', disabled: page >= pages - 1, onClick: () => a.turnPage(1) });
        void y;
      }
    }
  } else if (v.tab === 'scan') {
    out.push(surface(M, top, W, 380));
    const inner = M + 28;
    const iw = W - 56;
    const pill = (label: string, y: number, onClick: () => void, o: Partial<Widget> = {}): Widget => ({ kind: 'pill', rect: { x: inner, y, w: iw, h: 60 }, text: label, size: 25, onClick, ...o });
    if (v.roomName) {
      const err = v.resid === null ? '' : ` (scarto ${(v.resid * 100).toFixed(1)} cm)`;
      out.push(text(`Stanza riconosciuta: ${v.roomName}${err}.\nÈ già salvata nel tuo account.`, inner, top + 22, iw, 90, 26, T.text2, { wrap: true }));
      out.push(pill('Rinomina stanza', top + 130, a.renameRoom));
      out.push(pill('Non è questa stanza', top + 204, a.notThisRoom));
      if (v.captureAvailable) out.push(pill('Scansiona di nuovo', top + 278, a.scan, { primary: true, icon: 'scan' }));
    } else if (v.candidate) {
      out.push(text(`Il visore ha la scansione di "${v.candidate}", ma non sembri essere dentro quella stanza.`, inner, top + 22, iw, 100, 26, T.text2, { wrap: true }));
      out.push(pill('Sì, sono in questa stanza', top + 140, a.confirmCandidate, { primary: true }));
      out.push(
        v.captureAvailable
          ? pill('No, scansiona la stanza in cui sono', top + 214, a.scan)
          : text('Altrimenti fai la configurazione dello spazio dalle impostazioni del visore, poi torna qui.', inner, top + 214, iw, 90, 22, T.dim, { wrap: true }),
      );
    } else if (v.liveReady) {
      out.push(text('Questa stanza è già scansionata nel visore, ma non è salvata nel tuo account.', inner, top + 22, iw, 100, 26, T.text2, { wrap: true }));
      out.push(pill('Salva stanza', top + 140, a.saveRoom, { primary: true }));
      if (v.captureAvailable) out.push(pill('Scansiona di nuovo', top + 214, a.scan, { icon: 'scan' }));
    } else if (v.captureAvailable) {
      out.push(text('Nessuna scansione trovata in questa stanza.', inner, top + 22, iw, 60, 26, T.text2, { wrap: true }));
      out.push(pill('Scansiona la stanza', top + 100, a.scan, { primary: true, icon: 'scan' }));
      out.push(pill('Rileggi', top + 174, a.reread));
    } else {
      out.push(text('Nessuna scansione trovata. Questo browser non può avviare la scansione: fai la configurazione dello spazio dalle impostazioni del visore, poi torna qui.', inner, top + 22, iw, 150, 24, T.text2, { wrap: true }));
      out.push(pill('Rileggi', top + 190, a.reread, { primary: true }));
    }
  } else if (v.tab === 'options') {
    const half = (W - 14) / 2;
    const toggle = (i: number, name: string, sub: string, on: boolean, onClick: () => void, icon: IconName): Widget => ({
      kind: 'card', icon, rect: { x: M + (i % 2) * (half + 14), y: top + Math.floor(i / 2) * 82, w: half, h: 72 }, text: name, size: 22, badge: on ? 'Sì' : 'No', badgeOn: on, onClick, sub,
    });
    out.push(toggle(0, 'Contorno stanza', 'Senza progetto aperto', v.outline, a.toggleOutline, 'room'));
    out.push(toggle(1, 'Pareti invisibili', 'Nascondono le altre stanze', v.showOccluders, a.toggleOccluders, 'room_plan'));
    out.push(toggle(2, 'Snap', 'Rotazione e scala', v.snap, a.toggleSnap, 'sliders'));
    out.push(toggle(3, 'Pannelli nitidi', 'Layer del visore', v.layers, a.toggleLayers, 'check'));
    out.push(toggle(4, 'Pannello fps', 'Prestazioni', v.fps, a.toggleFps, 'sliders'));
    out.push({ kind: 'card', icon: 'user', rect: { x: M + half + 14, y: top + 164, w: half, h: 72 }, text: 'Mano dominante', size: 22, sub: 'Laser e selezione', badge: v.dominant === 'right' ? 'Destra' : 'Sinistra', badgeOn: true, onClick: a.toggleHand });
    out.push({ kind: 'card', icon: 'close', rect: { x: M, y: top + 246, w: half, h: 72 }, text: 'Chiudi il progetto', size: 22, sub: v.projectName ?? 'Nessun progetto aperto', disabled: !v.currentProjectId, onClick: a.closeProject });
    out.push(surface(M, top + 330, W, 50));
    if (v.fits[0]) out.push(text(v.fits[0], M + 24, top + 336, W - 48, 20, 16, v.fits[0].includes(': NO') ? T.bad : T.good));
    v.events.slice(-1).forEach((line) => out.push(text(line, M + 24, top + 357, W - 48, 18, 14, T.dim)));
  } else {
    out.push(surface(M, top, W, 380));
    out.push({ kind: 'card', icon: 'user', rect: { x: M + 20, y: top + 20, w: W - 40, h: 90 }, text: v.email ?? 'Non collegato', size: 26, sub: 'Account Immersa' });
    out.push({ kind: 'pill', rect: { x: M + 28, y: top + 128, w: W - 56, h: 60 }, text: 'Esci', size: 25, color: T.bad, onClick: a.signOut });
    out.push(text(`Versione ${typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'}  ·  ${v.startup ? `Avvio: ${v.startup}` : 'Avvio: -'}`, M + 28, top + 198, W - 56, 24, 16, T.dim));
    // The last events, kept across app restarts: what the session did around a standby.
    v.log.slice(-7).forEach((line, i) => out.push(text(line, M + 28, top + 230 + i * 20, W - 56, 20, 14, T.sub)));
  }

  if (v.message) out.push(...toast(v.message));
  return out;
}
