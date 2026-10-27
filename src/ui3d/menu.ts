import type { Widget } from './panel';

export type Tab = 'load' | 'scan' | 'options' | 'account';

export interface MenuView {
  tab: Tab;
  email: string | null;
  roomName: string | null; // recognised (saved) room
  info: string; // how many planes the headset reports / belong to this room
  candidate: string | null; // saved room the headset reports, but you do not seem to be inside it
  resid: number | null; // alignment error of that room, metres
  liveReady: boolean; // the headset currently exposes a scanned room
  captureAvailable: boolean; // the page may start a scan itself
  projects: { id: string; name: string; models: number }[] | null; // of the recognised room
  currentProjectId: string | null;
  page: number;
  outline: boolean;
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
  signOut(): void;
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

  const where = v.roomName
    ? `Stanza: ${v.roomName}`
    : v.candidate
      ? 'Stanza non confermata'
      : v.liveReady
        ? 'Stanza non salvata'
        : 'Nessuna stanza scansionata';
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
    if (!v.roomName && v.candidate) {
      out.push(label('Conferma prima la stanza nel tab Scan.', top, 80, 28, '#cdd6ea', true));
    } else if (!v.roomName) {
      out.push(label('Non sei in una stanza salvata.\nVai su Scan per salvarla: i progetti si aprono solo nella stanza in cui sono nati.', top, 160, 28, '#cdd6ea', true));
    } else if (v.projects === null) {
      out.push(label('Carico i progetti...', top));
    } else if (!v.projects.length) {
      out.push(label('Questa stanza non ha ancora progetti.\nCreane uno dal PC e salvalo con un nome.', top, 140, 28, '#cdd6ea', true));
    } else {
      const pages = Math.ceil(v.projects.length / PER_PAGE);
      const page = Math.min(v.page, pages - 1);
      v.projects.slice(page * PER_PAGE, (page + 1) * PER_PAGE).forEach((p, i) => {
        out.push({
          kind: 'row',
          rect: { x: PAD, y: top + i * 76, w: MENU_W - 2 * PAD, h: 68 },
          text: p.name,
          sub: `${p.models} ${p.models === 1 ? 'modello' : 'modelli'}${p.id === v.currentProjectId ? ' · aperto' : ''}`,
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
  } else if (v.tab === 'scan') {
    if (v.roomName) {
      const err = v.resid === null ? '' : ` (scarto ${(v.resid * 100).toFixed(1)} cm)`;
      out.push(label(`Stanza riconosciuta: ${v.roomName}${err}.\nÈ già salvata nel tuo account.`, top, 120, 28, '#cdd6ea', true));
      out.push(button('Rinomina stanza', top + 140, a.renameRoom));
      out.push(button('Non è questa stanza', top + 220, a.notThisRoom));
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
    out.push(button(`Contorno della stanza: ${v.outline ? 'sì' : 'no'}`, top, a.toggleOutline));
    out.push(label('Altre opzioni in arrivo.', top + 90, 40, 24, '#8e99b3'));
  } else {
    out.push(label(v.email ?? 'Non collegato', top, 44, 30));
    out.push(label('Account Immersa', top + 44, 36, 22, '#8e99b3'));
    out.push(button('Esci', top + 110, a.signOut));
  }

  if (v.message) out.push(label(v.message, MENU_H - 56, 40, 24, '#ffd36b'));
  else if (v.info) out.push(label(v.info, MENU_H - 50, 32, 20, '#6f7a93'));
  return out;
}
