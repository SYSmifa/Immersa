import { theme } from './theme';
import { hsvToHex, type Hsv } from './color';
import type { IconName } from './icons';
import type { Widget } from './panel';

export type Tab = 'load' | 'scan' | 'tools' | 'options' | 'account';

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
  measures: boolean; // its sizes are shown now
  gaps: boolean; // its distances to the nearest things are shown now (models only)
  // Set when the selection is a note or a ruler instead of a model.
  annotation?: { kind: 'note' | 'ruler'; text: string; color: string; colors: string[]; length: string | null };
  // Set when the selection is one component of a model.
  part?: { model: string; moved: boolean };
  // Set when the selection is a wall or a floor instead of a model.
  structure?: {
    kind: 'wall' | 'floor';
    height: number;
    thickness: number;
    texture: string | null;
    moved: boolean; // shifted / turned / scaled in the headset
    textures: { id: string | null; name: string; color: string; image?: CanvasImageSource }[]; // the catalogue, "none" first
  };
}

export const OBJECT_COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#eceff1', '#424242'];

export interface MenuView {
  object: ObjectView | null; // set: the menu shows this instead of the tabs
  tab: Tab;
  email: string | null;
  startup: string; // seconds since the page loaded for each start-up step
  relaunch: string; // how the app restarts itself (see app/relaunch.ts): remove | vr | clear | legacy
  autoRestart: boolean; // it also restarts by itself after a scan is saved and after a standby
  authKnown: boolean; // we know whether someone is signed in (else: still checking)
  loginEmail: string; // typed in the in-AR sign-in
  loginPassLen: number;
  canLink: boolean; // the sign-in with a code from the PC is available
  canGoogle: boolean; // the sign-in with Google is available
  canEmailCode: boolean; // the sign-in with a code sent by email is available
  codeFor: string | null; // the email a code was sent to (the code is being typed)
  loginCode: string; // the code typed so far
  linkCode: string | null; // the code being shown while it waits for the PC
  roomName: string | null; // recognised (saved) room
  roomPlace: string | null; // its place
  info: string; // how many planes the headset reports / belong to this room
  alignRoom: string | null; // a room of the open project that can be placed by touching two of its corners (its name)
  candidate: string | null; // saved room the headset reports, but you do not seem to be inside it
  changedRoom: string | null; // saved room that only partly fits the live scan: probably this room, with a moved or changed scan
  resid: number | null; // alignment error of that room, metres
  liveReady: boolean; // the headset currently exposes a scanned room
  captureAvailable: boolean; // the page may start a scan itself
  projectName: string | null; // the open project
  events: string[]; // recent session events (standby, resume, resets)
  log: string[]; // the same events kept across app restarts (shown in Account)
  fits: string[]; // how well each room's saved planes match the live scan (diagnostics)
  projects: { id: string; name: string; models: number; rooms: string; here: boolean; tone: number }[] | null; // all of them, this room's first
  currentProjectId: string | null;
  unsaved: boolean; // models moved in the headset and not saved yet
  canVisit: boolean; // the open project is a plan without scanned rooms: it can be visited virtually
  visit: boolean; // the virtual visit is on
  showLog: boolean; // the Account tab shows the long event log (to photograph it)
  logSnap: string[]; // the log as it was when the page opened (it does not move while you read it)
  logOffset: number; // lines skipped from the newest end (the log page scrolls back)
  search: string; // the project list is filtered by this name
  scroll: number; // 0..1: how far the project list is scrolled
  outline: boolean;
  measures: 'off' | 'sel'; // Options: the selected object's sizes shown or not
  gaps: boolean; // Options: distances of the selected object to the nearest things
  annotations: boolean; // Options: notes and rulers shown
  tool: 'note' | 'ruler' | null; // Strumenti: waiting for the pinch(es) that place a note / a ruler
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
  toggleVisit(): void;
  signInGoogle(): void;
  startEmailCode(): void;
  askCode(): void;
  submitCode(): void;
  backFromCode(): void;
  startLink(): void;
  cancelLink(): void;
  toggleLog(): void;
  logOlder(): void;
  logNewer(): void;
  alignRoom(): void;
  openDepthProbe(): void;
  restartApp(): void;
  cycleRelaunch(): void;
  toggleAutoRestart(): void;
  askSearch(): void;
  clearSearch(): void;
  setScroll(fraction: number): void;
  saveRoom(): void;
  renameRoom(): void;
  confirmCandidate(): void;
  updateChanged(): void;
  notThisRoom(): void;
  scan(): void;
  reread(): void;
  toggleOutline(): void;
  toggleMeasures(): void;
  objMeasures(): void;
  toggleGaps(): void;
  objGaps(): void;
  toggleAnnotations(): void;
  startTool(kind: 'note' | 'ruler'): void;
  objAnnotText(): void;
  objAnnotColor(color: string): void;
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
  objHeight(): void;
  objThickness(): void;
  objTexture(id: string | null): void;
  objReset(): void;
  objExitPart(): void;
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
// Lower case without accents: the project search ignores both.
export const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const M = 28; // outer margin
const W = MENU_W - 2 * M;
const TABS: [Tab, string, IconName][] = [
  ['load', 'Progetti', 'folder'],
  ['scan', 'Stanza', 'room_iso'],
  ['tools', 'Strumenti', 'ruler'],
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

function navBar(v: MenuView, a: MenuActions, out: Widget[]) {
  out.push(surface(M - 4, NAV_Y, W + 8, 84));
  const tw = (W + 8) / TABS.length;
  TABS.forEach(([tab, name, icon], i) => out.push({ kind: 'nav', icon, rect: { x: M - 4 + i * tw, y: NAV_Y, w: tw, h: 84 }, text: name, active: v.tab === tab, onClick: () => a.setTab(tab) }));
}

// "Salva" pill in the header while there are unsaved changes.
function saveButton(v: MenuView, a: MenuActions, out: Widget[]) {
  if (v.currentProjectId && v.unsaved) out.push({ kind: 'pill', icon: 'check', primary: true, rect: { x: MENU_W - M - 54 - 14 - 176, y: 25, w: 176, h: 48 }, text: 'Salva', size: 24, onClick: a.saveChanges });
}


// Object menu --------------------------------------------------------------------------------------------------
// Colour page: pick what to change (all materials or one), then the colour on a wheel, a brightness bar or presets.
function colorPage(o: ObjectView, out: Widget[], a: MenuActions): Widget[] {
  out.push(backButton(a.objColorBack), title('Colore', M + 70), subtitle(o.annotation ? '' : o.name, M + 70), closeButton(a));
  const st = o.structure;
  const items: { name: string; color: string | null; t: 'all' | number; tex?: string | null; image?: CanvasImageSource }[] = st
    ? st.textures.map((t) => ({ name: t.name, color: t.color, t: 'all' as const, tex: t.id, image: t.image }))
    : [
        { name: 'Tutti i materiali', color: o.color, t: 'all' },
        ...o.materials.map((m, i) => ({ name: m.name, color: m.color, t: i })),
      ];
  const pages = Math.max(1, Math.ceil(items.length / ROWS));
  const page = Math.min(o.matPage, pages - 1);
  // left: what to change
  out.push(surface(M, 104, 352, 322));
  items.slice(page * ROWS, (page + 1) * ROWS).forEach((it, i) =>
    out.push({ kind: 'row', rect: { x: M + 12, y: 116 + i * 52, w: 328, h: 46 }, text: it.name, size: 22, swatch: it.color ?? undefined, swatchImage: it.image, active: st ? st.texture === it.tex : o.target === it.t, onClick: () => (st ? a.objTexture(it.tex ?? null) : a.objColorTarget(it.t)) }),
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
  out.push(text(st ? 'Tinta: si moltiplica alla texture · verso il centro più chiaro' : 'Verso il centro: più chiaro · barra: più scuro', 424, 396, 390, 24, 17, theme().dim));
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

function objectPage(o: ObjectView, out: Widget[], a: MenuActions): Widget[] {
  if (o.colorPage) return colorPage(o, out, a);
  out.push(backButton(o.part ? a.objExitPart : a.objClose), title(o.annotation ? (o.annotation.kind === 'note' ? 'Nota' : 'Metro') : o.part ? 'Componente' : o.structure ? (o.structure.kind === 'wall' ? 'Parete' : 'Pavimento') : 'Oggetto', M + 70), subtitle(o.annotation ? '' : o.name, M + 70), closeButton(a));
  const half = (W - 16) / 2;
  if (o.annotation) {
    const an = o.annotation;
    out.push({ kind: 'card', icon: 'room_plan', rect: { x: M, y: 112, w: W, h: 104 }, text: an.text.replace(/\s*\n\s*/g, ' · ') || (an.kind === 'note' ? 'Nota senza testo' : 'Nessuna etichetta'), sub: an.length ? `Metro: ${an.length} · tocca per cambiare l'etichetta` : 'Tocca per cambiare il testo', size: 30, onClick: a.objAnnotText });
    const cw = (W - 3 * 14) / 4;
    an.colors.forEach((c, i) => out.push({ kind: 'chip', rect: { x: M + i * (cw + 14), y: 232, w: cw, h: 56 }, text: c === an.color ? '✓' : '', size: 30, fill: c, color: '#1a1205', onClick: () => a.objAnnotColor(c) }));
    if (o.confirmDelete) {
      out.push(surface(M, 310, W, 176));
      out.push(text(`Eliminare ${an.kind === 'note' ? 'la nota' : 'il metro'}?`, M + 28, 326, W - 56, 44, 30, theme().bad, { bold: true }));
      const bw = (W - 28 * 2 - 14) / 2;
      out.push({ kind: 'pill', rect: { x: M + 28, y: 414, w: bw, h: 56 }, text: 'Annulla', size: 24, onClick: a.objDeleteNo });
      out.push({ kind: 'pill', icon: 'trash', primary: true, rect: { x: M + 28 + bw + 14, y: 414, w: bw, h: 56 }, text: 'Sì, elimina', size: 24, onClick: a.objDeleteYes });
    } else out.push({ kind: 'pill', icon: 'trash', rect: { x: M, y: 310, w: W, h: 64 }, text: an.kind === 'note' ? 'Elimina nota' : 'Elimina metro', size: 26, color: theme().bad, onClick: a.objDelete });
    return out;
  }
  if (o.part) {
    out.push({ kind: 'card', icon: 'rotate', rect: { x: M, y: 112, w: half, h: 104 }, text: `${o.yawDeg}°`, sub: 'Rotazione', size: 34, onClick: a.objRotation });
    out.push({ kind: 'card', icon: 'scale', rect: { x: M + half + 16, y: 112, w: half, h: 104 }, text: `×${o.scale.toFixed(2)}`, sub: 'Scala', size: 34, onClick: a.objScale });
    out.push({ kind: 'chip', rect: { x: M, y: 230, w: 520, h: 40 }, text: `Parte di ${o.part.model} · trascinala con il pinch`, size: 19, fill: theme().glass });
    out.push({ kind: 'card', icon: 'palette', rect: { x: M, y: 284, w: W, h: 100 }, text: 'Colore e finitura', sub: o.color ? `Tinta ${o.color.toUpperCase()}` : 'Colori originali', swatch: o.color ?? o.materials[0]?.color, onClick: a.objOpenColor });
    out.push({ kind: 'pill', icon: 'back', rect: { x: M, y: 404, w: W, h: 64 }, text: "Riposiziona dov'era", size: 26, disabled: !o.part.moved, onClick: a.objReset });
    out.push({ kind: 'pill', icon: 'close', rect: { x: M, y: 480, w: W, h: 64 }, text: 'Esci dal componente', size: 26, onClick: a.objExitPart });
    return out;
  }
  if (o.structure) {
    const st = o.structure;
    if (st.kind === 'wall') out.push({ kind: 'card', icon: 'scale', rect: { x: M, y: 112, w: half, h: 104 }, text: `${st.height.toFixed(2)} m`, sub: 'Altezza', size: 34, onClick: a.objHeight });
    out.push({ kind: 'card', icon: 'scale', rect: { x: st.kind === 'wall' ? M + half + 16 : M, y: 112, w: half, h: 104 }, text: `${(st.thickness * 100).toFixed(0)} cm`, sub: 'Spessore', size: 34, onClick: a.objThickness });
    if (o.size) out.push({ kind: 'chip', rect: { x: M, y: 230, w: 440, h: 40 }, text: o.size, size: 19, fill: theme().glass });
    const tex = st.textures.find((t) => t.id === st.texture);
    out.push({ kind: 'card', icon: 'palette', rect: { x: M, y: 284, w: W, h: 100 }, text: 'Texture e colore', sub: tex?.id ? `Texture: ${tex.name}` : o.color ? `Tinta ${o.color.toUpperCase()}` : 'Colore predefinito', swatch: o.color ?? tex?.color ?? undefined, swatchImage: !o.color ? tex?.image : undefined, onClick: a.objOpenColor });
    if (o.confirmDelete) {
      out.push(surface(M, 404, W, 176));
      out.push(text(`Eliminare "${o.name}"?`, M + 28, 420, W - 56, 44, 30, theme().bad, { bold: true }));
      out.push(text('Sparisce dal progetto; per tenerla ricordati di non salvare.', M + 28, 464, W - 56, 30, 20, theme().dim));
      const bw = (W - 28 * 2 - 14) / 2;
      out.push({ kind: 'pill', rect: { x: M + 28, y: 508, w: bw, h: 56 }, text: 'Annulla', size: 24, onClick: a.objDeleteNo });
      out.push({ kind: 'pill', icon: 'trash', primary: true, rect: { x: M + 28 + bw + 14, y: 508, w: bw, h: 56 }, text: 'Sì, elimina', size: 24, onClick: a.objDeleteYes });
    } else {
      const bw = (W - 14) / 2;
      out.push({ kind: 'pill', icon: 'back', rect: { x: M, y: 404, w: bw, h: 64 }, text: "Riposiziona", size: 24, disabled: !st.moved, onClick: a.objReset });
      out.push({ kind: 'pill', icon: 'trash', rect: { x: M + bw + 14, y: 404, w: bw, h: 64 }, text: `Elimina`, size: 24, color: theme().bad, onClick: a.objDelete });
      out.push({ kind: 'pill', icon: 'scale', primary: o.measures, rect: { x: M, y: 480, w: W, h: 64 }, text: o.measures ? 'Misure: sì' : 'Misure: no', size: 26, onClick: a.objMeasures });
    }
    return out;
  }
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
    const bw2 = (W - 14) / 2;
    out.push({ kind: 'pill', icon: 'scale', primary: o.measures, rect: { x: M, y: 404, w: bw2, h: 64 }, text: o.measures ? 'Misure: sì' : 'Misure: no', size: 24, onClick: a.objMeasures });
    out.push({ kind: 'pill', icon: 'room_plan', primary: o.gaps, rect: { x: M + bw2 + 14, y: 404, w: bw2, h: 64 }, text: o.gaps ? 'Distanze: sì' : 'Distanze: no', size: 24, onClick: a.objGaps });
    out.push({ kind: 'pill', icon: 'trash', rect: { x: M, y: 480, w: W, h: 64 }, text: 'Elimina oggetto', size: 26, color: theme().bad, onClick: a.objDelete });
  }
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
      out.push(subtitle('Accedi al tuo account'));
      if (v.codeFor || v.linkCode) out.push(surface(M, 128, W, 390));
      if (v.codeFor) {
        // A code was sent by email: type it here.
        out.push(text(`Ti ho scritto a ${v.codeFor}. Apri l'email e scrivi qui il codice che trovi.`, M + 28, 150, W - 56, 80, 24, T.text2, { wrap: true }));
        out.push({ kind: 'row', rect: { x: M + 24, y: 250, w: W - 48, h: 64 }, text: v.loginCode || 'Tocca per scrivere il codice', size: 28, align: 'left', onClick: a.askCode });
        out.push({ kind: 'pill', primary: true, rect: { x: M + 24, y: 332, w: W - 48, h: 60 }, text: 'Accedi', size: 26, disabled: v.loginCode.length < 6, onClick: a.submitCode });
        const half2 = (W - 48 - 12) / 2;
        out.push({ kind: 'pill', rect: { x: M + 24, y: 408, w: half2, h: 56 }, text: 'Invia di nuovo', size: 23, onClick: a.startEmailCode });
        out.push({ kind: 'pill', rect: { x: M + 24 + half2 + 12, y: 408, w: half2, h: 56 }, text: 'Indietro', size: 23, onClick: a.backFromCode });
      } else if (v.linkCode) {
        // Waiting for the PC: the code to type there.
        const code = `${v.linkCode.slice(0, 3)} ${v.linkCode.slice(3)}`;
        out.push(text('Sul PC apri Immersa, scegli "Collega un visore" e scrivi questo codice:', M + 28, 150, W - 56, 64, 24, T.text2, { wrap: true }));
        out.push({ kind: 'label', rect: { x: M + 28, y: 240, w: W - 56, h: 110 }, text: code, size: 92, bold: true, color: T.accentText, align: 'center' });
        out.push(text('Aspetto la conferma dal PC…', M + 28, 372, W - 56, 30, 22, T.sub, { align: 'center' }));
        out.push({ kind: 'pill', rect: { x: M + 24, y: 432, w: W - 48, h: 60 }, text: 'Annulla', size: 26, onClick: a.cancelLink });
      } else {
        // Same look as the PC login card: a white card with the two fields, Accedi, Crea un account, then "oppure" and the
        // sign-in with a code sent by email (or Google, where it is on).
        let y = 142;
        if (v.canLink) {
          out.push({ kind: 'pill', icon: 'scan', rect: { x: M + 8, y, w: W - 16, h: 52 }, text: 'Accedi con un codice dal PC', size: 24, onClick: a.startLink });
          y += 74;
        }
        const h = 52;
        out.push({ kind: 'surface', rect: { x: M + 8, y: y - 8, w: W - 16, h: 2 * h + 10 + 32 }, text: '' });
        out.push({ kind: 'row', rect: { x: M + 24, y, w: W - 48, h }, text: v.loginEmail ? v.loginEmail : 'Email', size: 24, align: 'left', fill: '#f1f3f8', hoverFill: '#e6eaf3', color: v.loginEmail ? undefined : T.sub, onClick: a.askEmail });
        out.push({ kind: 'row', rect: { x: M + 24, y: y + h + 10, w: W - 48, h }, text: v.loginPassLen ? '•'.repeat(Math.min(v.loginPassLen, 16)) : 'Password', size: 24, align: 'left', fill: '#f1f3f8', hoverFill: '#e6eaf3', color: v.loginPassLen ? undefined : T.sub, onClick: a.askPassword });
        const by = y + 2 * h + 10 + 32 + 4;
        out.push({ kind: 'pill', primary: true, rect: { x: M + 8, y: by, w: W - 16, h: 54 }, text: 'Accedi', size: 26, onClick: () => a.signIn(false) });
        out.push({ kind: 'pill', rect: { x: M + 8, y: by + 62, w: W - 16, h: 48 }, text: 'Crea un account', size: 24, onClick: () => a.signIn(true) });
        if (v.canEmailCode || v.canGoogle) {
          const oy = by + 122;
          const dim = 'rgba(255,255,255,0.18)';
          out.push({ kind: 'chip', rect: { x: M + 8, y: oy + 10, w: (W - 16) / 2 - 44, h: 2 }, text: '', fill: dim });
          out.push({ kind: 'chip', rect: { x: M + 8 + (W - 16) / 2 + 44, y: oy + 10, w: (W - 16) / 2 - 44, h: 2 }, text: '', fill: dim });
          out.push(text('oppure', M + 8, oy, W - 16, 22, 19, 'rgba(255,255,255,0.6)', { align: 'center' }));
          if (v.canEmailCode) out.push({ kind: 'pill', icon: 'check', rect: { x: M + 8, y: oy + 30, w: W - 16, h: 52 }, text: 'Accedi con un codice via email', size: 24, onClick: a.startEmailCode });
          else out.push({ kind: 'pill', icon: 'google', rect: { x: M + 8, y: oy + 30, w: W - 16, h: 52 }, text: 'Continua con Google', size: 24, onClick: a.signInGoogle });
        }
      }
    }
    return out;
  }

  if (v.object) return objectPage(v.object, out, a);

  const project = v.projectName ? ` · ${v.projectName}` : '';
  const where = v.roomName
    ? `Stanza aperta${project}`
    : v.candidate
      ? 'Stanza non confermata'
      : v.changedRoom
        ? 'Stanza da aggiornare'
      : v.liveReady
        ? `Stanza non salvata${project}`
        : `Nessuna stanza scansionata${project}`;
  const heading: Record<Tab, string> = { load: 'Progetti', scan: 'Stanza', tools: 'Strumenti', options: 'Opzioni', account: 'Account' };
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
      // A search field on top (the 3D keyboard types the name), then the list, which scrolls with the bar on its right.
      const q = fold(v.search.trim());
      const found = q ? v.projects.filter((p) => fold(p.name).includes(q)) : v.projects;
      // When the room is known its projects come first, under their own heading, then the others under another one.
      type Row = { head: string } | { p: (typeof found)[number] };
      const mine = found.filter((p) => p.here);
      const rest = found.filter((p) => !p.here);
      const list: Row[] = mine.length ? [{ head: `In questa stanza${v.roomName ? ` · ${v.roomName}` : ''}` }, ...mine.map((p) => ({ p })), ...(rest.length ? [{ head: 'Altre stanze' }, ...rest.map((p) => ({ p }))] : [])] : found.map((p) => ({ p }));
      const sw = v.search ? W - 64 : W;
      out.push({ kind: 'row', icon: 'search', rect: { x: M, y: top, w: sw, h: 52 }, text: v.search || 'Cerca un progetto', size: 23, align: 'left', color: v.search ? undefined : T.sub, onClick: a.askSearch });
      if (v.search) out.push({ kind: 'iconbtn', icon: 'close', rect: { x: M + W - 52, y: top, w: 52, h: 52 }, text: '', onClick: a.clearSearch });
      const listTop = top + 64;
      const step = 80;
      const cardH = 72;
      const scrolls = list.length > PER_PAGE;
      const cardW = scrolls ? W - 34 : W;
      const first = scrolls ? Math.round(Math.min(1, Math.max(0, v.scroll)) * (list.length - PER_PAGE)) : 0;
      if (!list.length) out.push(text(`Nessun progetto con "${v.search.trim()}".`, M, listTop + 20, W, 40, 24, T.text2));
      list.slice(first, first + PER_PAGE).forEach((row, i) => {
        const y = listTop + i * step;
        if ('head' in row) {
          out.push(text(row.head.toUpperCase(), M + 6, y + 30, cardW - 12, 36, 20, T.accent[1], { bold: true }));
          return;
        }
        const p = row.p;
        const open = p.id === v.currentProjectId;
        out.push({
          kind: 'card',
          rect: { x: M, y, w: cardW, h: cardH },
          text: p.name,
          sub: `${p.rooms} · ${p.models} ${p.models === 1 ? 'modello' : 'modelli'}`,
          tone: p.tone,
          active: open,
          reserve: open ? 150 : undefined, // room for the "Chiudi" button drawn over the card
          onClick: () => a.selectProject(p.id),
        });
        // The open project has its own close button instead of the "Aperto" label (the one in Options stays too).
        if (open) {
          out.push({ kind: 'pill', fill: '#ffffff', hoverFill: T.bad, color: T.accentText, icon: 'close', rect: { x: M + cardW - 18 - 150, y: y + (cardH - 48) / 2, w: 150, h: 48 }, text: 'Chiudi', size: 22, onClick: a.closeProject });
        }
      });
      if (scrolls) {
        const h = PER_PAGE * step - 8;
        out.push({ kind: 'scroll', rect: { x: M + W - 30, y: listTop, w: 30, h }, text: '', value: first / (list.length - PER_PAGE), span: PER_PAGE / list.length, onPoint: (_fx, fy) => a.setScroll(fy) });
      }
    }
  } else if (v.tab === 'scan') {
    out.push(surface(M, top, W, 380));
    const inner = M + 28;
    const iw = W - 56;
    // The buttons stack from `y`; the last one is always "Allineamento manuale" (place the room by touching two corners).
    let y = top;
    const add = (label: string, onClick: () => void, o: Partial<Widget> = {}) => {
      out.push({ kind: 'pill', rect: { x: inner, y, w: iw, h: 56 }, text: label, size: 24, onClick, ...o });
      y += 66;
    };
    const manual = () => add('Allineamento manuale', a.alignRoom, { disabled: !v.alignRoom, icon: 'room' });
    if (v.roomName) {
      const err = v.resid === null ? '' : ` (scarto ${(v.resid * 100).toFixed(1)} cm)`;
      out.push(text(`Stanza riconosciuta: ${v.roomName}${err}.\n${v.roomPlace ? `Luogo: ${v.roomPlace}` : 'Senza luogo: assegnalo dal PC (Le mie stanze).'}`, inner, top + 20, iw, 80, 25, T.text2, { wrap: true }));
      y = top + 104;
      add('Rinomina stanza', a.renameRoom);
      add('Non è questa stanza', a.notThisRoom);
      if (v.captureAvailable) add('Scansiona di nuovo', a.scan, { primary: true, icon: 'scan' });
      manual();
    } else if (v.candidate) {
      out.push(text(`Il visore ha la scansione di "${v.candidate}", ma non sembri essere dentro quella stanza.`, inner, top + 20, iw, 90, 25, T.text2, { wrap: true }));
      y = top + 114;
      add('Sì, sono in questa stanza', a.confirmCandidate, { primary: true });
      if (v.captureAvailable) add('No, scansiona la stanza in cui sono', a.scan);
      else {
        out.push(text('Altrimenti fai la configurazione dello spazio dalle impostazioni del visore, poi torna qui.', inner, y, iw, 60, 21, T.dim, { wrap: true }));
        y += 66;
      }
      manual();
    } else if (v.changedRoom) {
      out.push(text(`Sembra la stanza "${v.changedRoom}", ma la scansione del visore è cambiata. Aggiorno quella salvata: i modelli restano al loro posto.`, inner, top + 18, iw, 96, 24, T.text2, { wrap: true }));
      y = top + 118;
      add(`Aggiorna "${v.changedRoom}"`, a.updateChanged, { primary: true });
      add('Salva come stanza nuova', a.saveRoom);
      if (v.captureAvailable) add('Scansiona di nuovo', a.scan, { icon: 'scan' });
      manual();
    } else if (v.liveReady) {
      out.push(text('Questa stanza è già scansionata nel visore, ma non è salvata nel tuo account.', inner, top + 20, iw, 90, 25, T.text2, { wrap: true }));
      y = top + 114;
      add('Salva stanza', a.saveRoom, { primary: true });
      if (v.captureAvailable) add('Scansiona di nuovo', a.scan, { icon: 'scan' });
      manual();
    } else if (v.captureAvailable) {
      out.push(text('Nessuna scansione trovata in questa stanza.', inner, top + 20, iw, 50, 25, T.text2, { wrap: true }));
      y = top + 84;
      add('Scansiona la stanza', a.scan, { primary: true, icon: 'scan' });
      add('Rileggi', a.reread);
      manual();
    } else {
      out.push(text('Nessuna scansione trovata. Questo browser non può avviare la scansione: fai la configurazione dello spazio dalle impostazioni del visore, poi torna qui.', inner, top + 20, iw, 130, 23, T.text2, { wrap: true }));
      y = top + 156;
      add('Rileggi', a.reread, { primary: true });
      manual();
    }
  } else if (v.tab === 'tools') {
    out.push(surface(M, top, W, 380));
    const can = !!v.currentProjectId;
    out.push(text(can ? 'Scegli lo strumento, poi punta con il laser e pizzica dove metterlo.' : 'Apri un progetto per lasciare note e misure.', M + 24, top + 16, W - 48, 64, 24, T.text2, { wrap: true }));
    out.push({ kind: 'card', icon: 'pin', rect: { x: M + 20, y: top + 96, w: W - 40, h: 100 }, text: 'Nota', size: 30, sub: 'Un pinch per metterla, poi scrivi il testo', disabled: !can, onClick: () => a.startTool('note') });
    out.push({ kind: 'card', icon: 'ruler', rect: { x: M + 20, y: top + 212, w: W - 40, h: 100 }, text: 'Metro', size: 30, sub: 'Due pinch: il primo e il secondo punto', disabled: !can, onClick: () => a.startTool('ruler') });
    out.push(text('Dopo averla messa, tieni il pinch sul punto per spostarla con la mano.', M + 24, top + 334, W - 48, 40, 20, T.dim, { wrap: true }));
  } else if (v.tab === 'options') {
    const half = (W - 14) / 2;
    const STEP = 58; // six rows of cards fit above the info line
    const H = 52;
    const at = (col: number, row: number) => ({ x: M + col * (half + 14), y: top + row * STEP, w: half, h: H });
    const toggle = (col: number, row: number, name: string, sub: string, on: boolean, onClick: () => void, icon: IconName): Widget => ({
      kind: 'card', icon, rect: at(col, row), text: name, size: 22, badge: on ? 'Sì' : 'No', badgeOn: on, onClick, sub,
    });
    out.push(toggle(0, 0, 'Contorno stanza', 'Senza progetto aperto', v.outline, a.toggleOutline, 'room'));
    out.push(toggle(1, 0, 'Pareti invisibili', 'Nascondono le altre stanze', v.showOccluders, a.toggleOccluders, 'room_plan'));
    out.push(toggle(0, 1, 'Snap', 'Rotazione e scala', v.snap, a.toggleSnap, 'sliders'));
    out.push(toggle(1, 1, 'Pannelli nitidi', 'Layer del visore', v.layers, a.toggleLayers, 'check'));
    out.push(toggle(0, 2, 'Pannello fps', 'Prestazioni', v.fps, a.toggleFps, 'sliders'));
    out.push({ kind: 'card', icon: 'user', rect: at(1, 2), text: 'Mano dominante', size: 22, sub: 'Laser e selezione', badge: v.dominant === 'right' ? 'Destra' : 'Sinistra', badgeOn: true, onClick: a.toggleHand });
    out.push({ kind: 'card', icon: 'scale', rect: at(0, 3), text: 'Misure', size: 22, sub: 'Dell\'oggetto scelto', badge: v.measures === 'off' ? 'No' : 'Sì', badgeOn: v.measures !== 'off', onClick: a.toggleMeasures });
    out.push({ kind: 'card', icon: 'cube', rect: at(1, 3), text: 'Visita virtuale', size: 22, sub: v.visit ? 'Attiva: muoviti col laser' : v.canVisit ? 'Muoviti col laser' : 'Serve una pianta CAD', badge: v.visit ? 'Disattiva' : 'Avvia', badgeOn: v.canVisit || v.visit, disabled: !v.canVisit && !v.visit, onClick: a.toggleVisit });
    out.push(toggle(1, 4, 'Distanze', 'Dalle pareti', v.gaps, a.toggleGaps, 'room_plan'));
    out.push({ kind: 'card', icon: 'close', rect: at(0, 4), text: 'Chiudi il progetto', size: 22, sub: v.projectName ?? 'Nessun progetto aperto', disabled: !v.currentProjectId, onClick: a.closeProject });
    out.push(toggle(0, 5, 'Annotazioni', 'Note e metri', v.annotations, a.toggleAnnotations, 'check'));
    out.push({ kind: 'card', icon: 'room', rect: at(1, 5), text: 'Allinea la stanza', size: 22, sub: v.alignRoom ? `${v.alignRoom}: tocca 2 angoli` : 'Serve un progetto con stanza', disabled: !v.alignRoom, onClick: a.alignRoom });
    out.push(surface(M, top + 6 * STEP + 2, W, 44));
    if (v.fits[0]) out.push(text(v.fits[0], M + 24, top + 6 * STEP + 6, W - 48, 20, 16, v.fits[0].includes(': NO') ? T.bad : T.good));
    v.events.slice(-1).forEach((line) => out.push(text(line, M + 24, top + 6 * STEP + 26, W - 48, 18, 14, T.dim)));
  } else if (v.showLog) {
    // The event log in big, readable lines: the headset has no copy and paste, so it is meant to be photographed.
    out.push(surface(M, top, W, 392));
    // the newest lines that fit, shown oldest first
    const shown: { line: string; rows: number }[] = [];
    let used = 0;
    for (const line of [...v.logSnap].slice(0, Math.max(0, v.logSnap.length - v.logOffset)).reverse()) {
      const rows = line.length > 74 ? 2 : 1;
      if (used + rows * 22 + 4 > 316) break;
      shown.unshift({ line, rows });
      used += rows * 22 + 4;
    }
    let y = top + 14;
    for (const it of shown) {
      out.push(text(it.line, M + 24, y, W - 48, it.rows * 22, 17, T.text2, { wrap: true }));
      y += it.rows * 22 + 4;
    }
    const third = (W - 48 - 24) / 3;
    out.push({ kind: 'pill', rect: { x: M + 24, y: top + 334, w: third, h: 46 }, text: 'Più vecchi', size: 20, onClick: a.logOlder });
    out.push({ kind: 'pill', rect: { x: M + 36 + third, y: top + 334, w: third, h: 46 }, text: 'Più recenti', size: 20, onClick: a.logNewer });
    out.push({ kind: 'pill', rect: { x: M + 48 + 2 * third, y: top + 334, w: third, h: 46 }, text: 'Indietro', size: 20, onClick: a.toggleLog });
  } else {
    out.push(surface(M, top, W, 380));
    out.push({ kind: 'card', icon: 'user', rect: { x: M + 20, y: top + 20, w: W - 40, h: 90 }, text: v.email ?? 'Non collegato', size: 26, sub: 'Account Immersa' });
    const quarter = (W - 56 - 36) / 4;
    const pills: [string, () => void, string?][] = [['Esci', a.signOut, T.bad], ['Registro', a.toggleLog], ['Profondità', a.openDepthProbe], ['Riavvia', a.restartApp]];
    pills.forEach(([label, onClick, color], i) => out.push({ kind: 'pill', rect: { x: M + 28 + i * (quarter + 12), y: top + 128, w: quarter, h: 60 }, text: label, size: 21, ...(color ? { color } : {}), onClick }));
    // The app can restart itself (Riavvia above, and by itself after a scan is saved and after a standby): the switch and the way.
    const half = (W - 56 - 12) / 2;
    out.push({ kind: 'pill', rect: { x: M + 28, y: top + 196, w: half, h: 40 }, text: `Riavvio automatico: ${v.autoRestart ? 'Sì' : 'No'}`, size: 17, ...(v.autoRestart ? { color: T.good } : {}), onClick: a.toggleAutoRestart });
    out.push({ kind: 'pill', rect: { x: M + 28 + half + 12, y: top + 196, w: half, h: 40 }, text: `Modo: ${v.relaunch}`, size: 17, onClick: a.cycleRelaunch });
    out.push(text(`Versione ${typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'}  ·  ${v.startup ? `Avvio: ${v.startup}` : 'Avvio: -'}`, M + 28, top + 246, W - 56, 24, 16, T.dim));
    // The last events, kept across app restarts: what the session did around a standby.
    v.log.slice(-4).forEach((line, i) => out.push(text(line, M + 28, top + 276 + i * 20, W - 56, 20, 14, T.sub)));
  }
  return out;
}
