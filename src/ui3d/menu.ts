import { hsvToHex, type Hsv } from './color';
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
  fits: string[]; // how well each room's saved planes match the live scan (diagnostics)
  projects: { id: string; name: string; models: number; rooms: string; here: boolean }[] | null; // all of them, this room's first
  currentProjectId: string | null;
  unsaved: boolean; // models moved in the headset and not saved yet
  page: number;
  outline: boolean;
  layers: boolean; // panels drawn as WebXR layers (sharper)
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
const PAD = 24;
const TABS: [Tab, string][] = [
  ['load', 'Load'],
  ['scan', 'Scan'],
  ['options', 'Options'],
  ['account', 'Account'],
];

const ROWS = 5;
// Colour page: pick what to change (all materials or one), then the colour on a wheel, a brightness bar or the presets.
function colorPage(o: ObjectView, out: Widget[], a: MenuActions): Widget[] {
  const items: { name: string; color: string | null; t: 'all' | number }[] = [
    { name: 'Tutti i materiali', color: o.color, t: 'all' },
    ...o.materials.map((m, i) => ({ name: m.name, color: m.color, t: i })),
  ];
  const pages = Math.max(1, Math.ceil(items.length / ROWS));
  const page = Math.min(o.matPage, pages - 1);
  items.slice(page * ROWS, (page + 1) * ROWS).forEach((it, i) =>
    out.push({
      kind: 'row',
      rect: { x: PAD, y: 104 + i * 60, w: 330, h: 54 },
      text: it.name,
      size: 24,
      swatch: it.color ?? undefined,
      active: o.target === it.t,
      onClick: () => a.objColorTarget(it.t),
    }),
  );
  if (pages > 1) {
    out.push({ rect: { x: PAD, y: 408, w: 100, h: 48 }, text: '‹', disabled: page === 0, onClick: () => a.objMatPage(-1) });
    out.push({ kind: 'label', rect: { x: PAD + 100, y: 408, w: 130, h: 48 }, text: `${page + 1} / ${pages}`, size: 24, align: 'center' });
    out.push({ rect: { x: PAD + 230, y: 408, w: 100, h: 48 }, text: '›', disabled: page >= pages - 1, onClick: () => a.objMatPage(1) });
  }
  const [h, s, v] = o.hsv;
  out.push({ kind: 'wheel', rect: { x: 410, y: 100, w: 240, h: 240 }, text: '', hsv: o.hsv, onPoint: (fx, fy) => a.objPick(((Math.atan2(fy - 0.5, fx - 0.5) / (2 * Math.PI) + 1) % 1), Math.min(1, Math.hypot(fx - 0.5, fy - 0.5) * 2), null) });
  out.push({ kind: 'label', rect: { x: 668, y: 104, w: 170, h: 30 }, text: 'Anteprima', size: 20, color: '#8e99b3' });
  out.push({ rect: { x: 668, y: 140, w: 150, h: 150 }, kind: 'label', text: '', swatch: hsvToHex(h, s, v) });
  out.push({ kind: 'label', rect: { x: 668, y: 300, w: 170, h: 30 }, text: hsvToHex(h, s, v).toUpperCase(), size: 24, color: '#cdd6ea' });
  out.push({ kind: 'slider', rect: { x: 410, y: 358, w: 408, h: 36 }, text: '', hsv: o.hsv, onPoint: (fx) => a.objPick(null, null, fx) });
  out.push({ kind: 'label', rect: { x: 410, y: 398, w: 420, h: 30 }, text: 'Verso il centro: più chiaro · barra: più scuro', size: 19, color: '#8e99b3' });
  const n = OBJECT_COLORS.length + 1;
  const gap = 8;
  const w = (MENU_W - 2 * PAD - (n - 1) * gap) / n;
  out.push({ rect: { x: PAD, y: 440, w, h: 56 }, text: 'Orig.', size: 22, onClick: () => a.objColor(null) });
  OBJECT_COLORS.forEach((c, i) => out.push({ rect: { x: PAD + (i + 1) * (w + gap), y: 440, w, h: 56 }, text: '●', size: 44, color: c, onClick: () => a.objColor(c) }));
  out.push({ rect: { x: 330, y: 14, w: 200, h: 46 }, text: '‹ Indietro', size: 26, onClick: a.objColorBack });
  const bar = (key: 'roughness' | 'metalness', text: string, y: number) => {
    out.push({ kind: 'label', rect: { x: PAD, y, w: 260, h: 36 }, text: `${text} ${o.finish[key].toFixed(2)}`, size: 24 });
    out.push({ kind: 'bar', rect: { x: 300, y: y + 2, w: MENU_W - PAD - 300, h: 32 }, text: '', value: o.finish[key], onPoint: (fx) => a.objFinish(key, Math.round(fx * 100) / 100) });
  };
  bar('roughness', 'Rugosità', 512);
  bar('metalness', 'Metallico', 560);
  return out;
}

// Pure description of the menu for the current state; the panel just draws it.
export function buildMenu(v: MenuView, a: MenuActions): Widget[] {
  const out: Widget[] = [];
  const label = (text: string, y: number, h = 40, size = 28, color?: string, wrap = false): Widget => ({
    kind: 'label',
    rect: { x: PAD, y, w: MENU_W - 2 * PAD, h },
    text,
    size,
    color,
    wrap,
  });
  const button = (text: string, y: number, onClick: () => void, o: Partial<Widget> = {}): Widget => ({
    rect: { x: PAD, y, w: MENU_W - 2 * PAD, h: 64 },
    text,
    onClick,
    ...o,
  });

  if (!v.authKnown || !v.email) {
    // Sign in inside AR: the page has no 2D login (a store PWA must be immersive only).
    out.push({ kind: 'label', rect: { x: PAD, y: 14, w: 400, h: 46 }, text: 'Immersa', size: 38 });
    if (!v.authKnown) {
      out.push(label('Loading...', 130));
    } else {
      const ready = !!v.loginEmail && v.loginPassLen > 0;
      out.push(label('Sign in to your account', 80, 36, 26, '#9fb0d0'));
      out.push(button(v.loginEmail ? `Email: ${v.loginEmail}` : 'Tap to type your email', 140, a.askEmail));
      out.push(button(v.loginPassLen ? `Password: ${'•'.repeat(Math.min(v.loginPassLen, 16))}` : 'Tap to type your password', 220, a.askPassword));
      out.push(button('Sign in', 310, () => a.signIn(false), { primary: true, disabled: !ready }));
      out.push(button('Create account', 390, () => a.signIn(true), { disabled: !ready }));
    }
    if (v.message) out.push(label(v.message, MENU_H - 56, 40, 24, '#ffd36b'));
    return out;
  }

  if (v.object) {
    const o = v.object;
    out.push({ kind: 'label', rect: { x: PAD, y: 14, w: 500, h: 46 }, text: 'Oggetto', size: 38 });
    out.push({ rect: { x: MENU_W - PAD - 64, y: 14, w: 64, h: 46 }, text: '✕', size: 28, onClick: a.close });
    out.push(label(o.name, 58, 36, 26, '#9fb0d0'));
    if (o.colorPage) return colorPage(o, out, a);
    out.push(button(`Rotazione: ${o.yawDeg}°`, 108, a.objRotation));
    out.push(button(`Scala: ×${o.scale.toFixed(2)}${o.size ? `   (${o.size})` : ''}`, 180, a.objScale));
    out.push(button('Colore e materiali', 252, a.objOpenColor, { swatch: o.color ?? undefined }));
    const gap = 8;
    if (o.confirmDelete) {
      out.push(label(`Eliminare "${o.name}"?`, 336, 40, 28, '#ff9c8a'));
      const half = (MENU_W - 2 * PAD - gap) / 2;
      out.push({ rect: { x: PAD, y: 384, w: half, h: 64 }, text: 'Sì, elimina', primary: true, onClick: a.objDeleteYes });
      out.push({ rect: { x: PAD + half + gap, y: 384, w: half, h: 64 }, text: 'Annulla', onClick: a.objDeleteNo });
    } else {
      out.push(button('Elimina oggetto', 324, a.objDelete));
      out.push(button('Indietro', 396, a.objClose));
    }
    if (v.message) out.push(label(v.message, MENU_H - 56, 40, 24, '#ffd36b'));
    return out;
  }

  const project = v.projectName ? ` · Progetto: ${v.projectName}` : '';
  const where = v.roomName
    ? `Stanza: ${v.roomName}${project}`
    : v.candidate
      ? 'Stanza non confermata'
      : v.liveReady
        ? `Stanza non salvata${project}`
        : `Nessuna stanza scansionata${project}`;
  out.push({ kind: 'label', rect: { x: PAD, y: 14, w: 300, h: 46 }, text: 'Immersa', size: 38 });
  out.push({ rect: { x: MENU_W - PAD - 64, y: 14, w: 64, h: 46 }, text: '✕', size: 28, onClick: a.close });
  out.push(label(where, 58, 36, 24, '#9fb0d0'));

  const tabW = (MENU_W - 2 * PAD - 3 * 12) / 4;
  TABS.forEach(([tab, name], i) => {
    out.push({
      rect: { x: PAD + i * (tabW + 12), y: 104, w: tabW, h: 64 },
      text: name,
      active: v.tab === tab,
      onClick: () => a.setTab(tab),
    });
  });

  const top = 192;
  if (v.tab === 'load') {
    if (v.projects === null) {
      out.push(label('Carico i progetti...', top));
    } else if (!v.projects.length) {
      out.push(label('Non ci sono ancora progetti.\nCreane uno dal PC e salvalo con un nome.', top, 140, 28, '#cdd6ea', true));
    } else {
      const pages = Math.ceil(v.projects.length / PER_PAGE);
      const page = Math.min(v.page, pages - 1);
      v.projects.slice(page * PER_PAGE, (page + 1) * PER_PAGE).forEach((p, i) => {
        const count = `${p.models} ${p.models === 1 ? 'modello' : 'modelli'}`;
        out.push({
          kind: 'row',
          rect: { x: PAD, y: top + i * 76, w: MENU_W - 2 * PAD, h: 68 },
          text: p.name,
          sub: `${p.rooms}${p.here ? '' : ' (altra stanza)'} · ${count}${p.id === v.currentProjectId ? ' · aperto' : ''}`,
          active: p.id === v.currentProjectId,
          onClick: () => a.selectProject(p.id),
        });
      });
      if (pages > 1) {
        const y = top + PER_PAGE * 76;
        out.push({ rect: { x: PAD, y, w: 120, h: 52 }, text: '‹', disabled: page === 0, onClick: () => a.turnPage(-1) });
        out.push({ kind: 'label', rect: { x: PAD + 120, y, w: MENU_W - 2 * PAD - 240, h: 52 }, text: `${page + 1} / ${pages}`, size: 26, align: 'center' });
        out.push({ rect: { x: MENU_W - PAD - 120, y, w: 120, h: 52 }, text: '›', disabled: page >= pages - 1, onClick: () => a.turnPage(1) });
      }
    }
    if (v.currentProjectId) {
      out.push(button(v.unsaved ? 'Salva le modifiche' : 'Nessuna modifica da salvare', 560, a.saveChanges, { primary: v.unsaved, disabled: !v.unsaved }));
    }
  } else if (v.tab === 'scan') {
    if (v.roomName) {
      const err = v.resid === null ? '' : ` (scarto ${(v.resid * 100).toFixed(1)} cm)`;
      out.push(label(`Stanza riconosciuta: ${v.roomName}${err}.\nÈ già salvata nel tuo account.`, top, 120, 28, '#cdd6ea', true));
      out.push(button('Rinomina stanza', top + 140, a.renameRoom));
      out.push(button('Non è questa stanza', top + 220, a.notThisRoom));
      if (v.captureAvailable) out.push(button('Scansiona di nuovo', top + 300, a.scan));
    } else if (v.candidate) {
      out.push(label(`Il visore ha la scansione di "${v.candidate}", ma non sembri essere dentro quella stanza.`, top, 110, 28, '#cdd6ea', true));
      out.push(button('Sì, sono in questa stanza', top + 130, a.confirmCandidate, { primary: true }));
      out.push(
        v.captureAvailable
          ? button('No, scansiona la stanza in cui sono', top + 210, a.scan)
          : label('Altrimenti fai la configurazione dello spazio dalle impostazioni del visore, poi torna qui.', top + 210, 90, 24, '#8e99b3', true),
      );
    } else if (v.liveReady) {
      out.push(label('Questa stanza è già scansionata nel visore, ma non è salvata nel tuo account.', top, 100, 28, '#cdd6ea', true));
      out.push(button('Salva stanza', top + 120, a.saveRoom, { primary: true }));
      if (v.captureAvailable) out.push(button('Scansiona di nuovo', top + 200, a.scan));
    } else if (v.captureAvailable) {
      out.push(label('Nessuna scansione trovata in questa stanza.', top, 60, 28, '#cdd6ea', true));
      out.push(button('Scansiona la stanza', top + 80, a.scan, { primary: true }));
      out.push(button('Rileggi', top + 160, a.reread));
    } else {
      out.push(label('Nessuna scansione trovata. Questo browser non può avviare la scansione: fai la configurazione dello spazio dalle impostazioni del visore, poi torna qui.', top, 150, 26, '#cdd6ea', true));
      out.push(button('Rileggi', top + 170, a.reread, { primary: true }));
    }
  } else if (v.tab === 'options') {
    const half = (text: string, i: number, y: number, onClick: () => void, o: Partial<Widget> = {}): Widget =>
      button(text, y, onClick, { ...o, rect: { x: PAD + i * ((MENU_W - 2 * PAD) / 2 + 6), y, w: (MENU_W - 2 * PAD) / 2 - 6, h: 64 } });
    out.push(half(`Contorno stanza: ${v.outline ? 'sì' : 'no'}`, 0, top, a.toggleOutline));
    out.push(half(`Pareti invisibili: ${v.showOccluders ? 'sì' : 'no'}`, 1, top, a.toggleOccluders));
    out.push(half(`Snap rotazione/scala: ${v.snap ? 'sì' : 'no'}`, 0, top + 72, a.toggleSnap));
    out.push(half('Chiudi il progetto', 1, top + 72, a.closeProject, { disabled: !v.currentProjectId }));
    out.push(half(`Pannelli nitidi (layer): ${v.layers ? 'sì' : 'no'}`, 0, top + 144, a.toggleLayers));
    out.push(label('Allineamento delle stanze (diagnostica)', top + 218, 28, 20, '#8e99b3'));
    v.fits.slice(0, 3).forEach((line, i) => out.push(label(line, top + 246 + i * 24, 24, 21, line.includes(': NO') ? '#ff9c8a' : '#9be7b0')));
    v.events.forEach((line, i) => out.push(label(line, top + 324 + i * 24, 24, 19, '#8e99b3')));
  } else {
    out.push(label(v.email ?? 'Non collegato', top, 44, 30));
    out.push(label('Account Immersa', top + 44, 36, 22, '#8e99b3'));
    out.push(button('Esci', top + 110, a.signOut));
    out.push(label(v.startup ? `Avvio: ${v.startup}` : 'Avvio: -', top + 222, 60, 19, '#8e99b3', true));
    out.push(label(`Versione: ${typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'}`, top + 190, 30, 22, '#8e99b3'));
  }

  if (v.message) out.push(label(v.message, MENU_H - 56, 40, 24, '#ffd36b'));
  else if (v.info) out.push(label(v.info, MENU_H - 50, 32, 20, '#6f7a93'));
  return out;
}
