import '@fontsource/sen/latin-500.css';
import '@fontsource/sen/latin-700.css';
import { AURA } from '../ui3d/theme';

// DOM UI of the PC editor, in the same "Aura" look as the headset menu: ink gradient, white cards, turquoise accent, font Sen.
// Layout: left sidebar (home: open / new project / my rooms; then the project settings; login at the bottom),
// centre-top toolbar, top-right outline of the scene with the details of the selection under it, toast at the bottom.
export type BuildKind = 'floor' | 'wall';
export type Gizmo = 'translate' | 'rotate' | 'scale';
export type View = 'home' | 'projects' | 'rooms' | 'new' | 'project';

export interface LookEdit {
  target?: 'all' | number; // which material; omitted with `reset`
  color?: string | null; // null = back to the file's colour
  roughness?: number;
  metalness?: number;
  reset?: boolean; // every colour and finish back to the file's own
}
export interface StructureEdit {
  height?: number;
  thickness?: number;
  color?: string | null;
}

export interface EditorHandlers {
  onOpenProject(id: string): void;
  onCreateProject(name: string, roomIds: string[]): void;
  onCloseProject(): void;
  onRenameProject(): void;
  onDeleteProject(): void;
  onProjectRoom(id: string): void;
  onAddRoom(id: string): void;
  onRemoveRoom(): void;
  onShell(visible: boolean): void;
  onUpload(file: File): void;
  onRenameRoom(id: string): void;
  onDeleteRoom(id: string): void;
  onSave(): void;
  // toolbar
  onBuild(kind: BuildKind | null): void;
  onGizmo(mode: Gizmo): void;
  onOrtho(on: boolean): void;
  onSnapGrid(on: boolean): void;
  onSnapVertex(on: boolean): void;
  onLocal(on: boolean): void;
  onUndo(): void;
  onRedo(): void;
  // outline + details
  onPick(key: string, additive: boolean): void;
  onModelScale(value: number, commit: boolean): void;
  onModelYaw(deg: number, commit: boolean): void;
  onModelLook(edit: LookEdit, commit: boolean): void;
  onStructure(edit: StructureEdit, commit: boolean): void;
  onDeleteSelection(): void;
}

export interface OutlineItem {
  key: string; // 'm:<id>' model, 's:<id>' structure
  name: string;
  kind: 'model' | BuildKind;
}
export interface MaterialRow {
  name: string;
  color: string;
  roughness: number;
  metalness: number;
}
export type Details =
  | { kind: 'multi'; count: number }
  | { kind: 'model'; scale: number; yawDeg: number; size: [number, number, number] | null; materials: MaterialRow[] }
  | { kind: 'structure'; type: BuildKind; height: number; thickness: number; color: string; measure: string };
export interface ToolbarState {
  build: BuildKind | null;
  gizmo: Gizmo;
  ortho: boolean;
  grid: boolean;
  vertex: boolean;
  local: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

type Option = { id: string; name: string };

const A = AURA;
const CSS = `
.ed{--ink:${A.bgStops[0][1]};--ink2:${A.bgStops[1][1]};--ink3:${A.bgStops[2][1]};--acc:${A.accent[0]};--acc2:${A.accent[1]};--tint:${A.surfaceHover};
  font-family:'Sen',system-ui,sans-serif;font-size:14px;color:#fff}
.ed *{box-sizing:border-box;font-family:inherit}
.ed button,.ed select,.ed input{font-size:14px}
.ed-panel{background:linear-gradient(160deg,var(--ink),var(--ink2) 55%,var(--ink3));box-shadow:0 10px 40px #0008;border-radius:22px}
.ed-side{position:fixed;top:12px;left:12px;bottom:12px;width:310px;z-index:10;display:flex;flex-direction:column;gap:10px;padding:14px}
.ed-body{flex:1;overflow:auto;display:flex;flex-direction:column;gap:10px;min-height:0}
.ed-brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;letter-spacing:.02em}
.ed-brand i{width:12px;height:12px;border-radius:4px;background:linear-gradient(135deg,var(--acc),var(--acc2));box-shadow:0 0 12px var(--acc)}
.ed-title{color:#8b95a7;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:6px 4px 0}
.ed-footer{border-top:1px solid #ffffff1a;padding-top:10px}
.ed-card{background:#fff;color:#12151c;border-radius:16px;padding:10px;display:flex;flex-direction:column;gap:8px}
.ed-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ed-row.sp{justify-content:space-between;flex-wrap:nowrap}
.ed-card select,.ed-card input[type=number],.ed-card input[type=text]{width:100%;padding:8px 10px;border-radius:10px;border:1px solid #d9dee8;background:#f4f6fa;color:#12151c;outline:none}
.ed-card input[type=number]{width:96px}
.ed-card select:focus,.ed-card input:focus{border-color:var(--acc)}
.ed-card input[type=color]{width:34px;height:28px;padding:0;border:1px solid #d9dee8;border-radius:8px;background:none;cursor:pointer}
.ed-card input[type=range]{width:100%;accent-color:var(--acc)}
.ed-pill{border:0;border-radius:999px;padding:8px 14px;background:#e8ecf3;color:#12151c;cursor:pointer;font-weight:500;transition:.12s;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.ed-pill:hover:not(:disabled){background:var(--tint)}
.ed-pill:disabled{opacity:.4;cursor:default}
.ed-pill.acc{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#04211d;font-weight:700}
.ed-pill.bad:hover:not(:disabled){background:#ef4444;color:#fff}
.ed-big{display:flex;align-items:center;gap:12px;width:100%;padding:16px;border:0;border-radius:16px;background:#fff;color:#12151c;font-weight:700;font-size:15px;
  cursor:pointer;text-align:left;transition:.12s}
.ed-big:hover{background:var(--tint)}
.ed-big svg{width:24px;height:24px;color:var(--acc)}
.ed-big small{display:block;font-weight:500;color:#667085;font-size:12px;margin-top:2px}
.ed-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:#fff;color:#12151c;cursor:pointer;border:2px solid transparent;
  text-align:left;width:100%;font-weight:500;transition:.12s}
.ed-item:hover{background:var(--tint)}
.ed-item.on{border-color:var(--acc);background:var(--tint)}
.ed-item svg{width:18px;height:18px;flex:none;color:#0f9488}
.ed-item span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ed-item small{color:#667085;font-weight:500}
.ed-check{display:flex;gap:8px;align-items:center;color:#cfd6e4;padding:0 4px;cursor:pointer}
.ed-card .ed-check{color:#12151c;padding:4px}
.ed-check input{accent-color:var(--acc)}
.ed-file{color:#cfd6e4;font-size:12px}
.ed-file::file-selector-button{border:0;border-radius:999px;padding:7px 12px;margin-right:8px;background:#ffffff1f;color:#fff;cursor:pointer;font-family:inherit}
.ed-back{align-self:flex-start;background:#ffffff14;color:#fff}
.ed-back:hover:not(:disabled){background:#ffffff26}
.ed-h{font-weight:700;font-size:16px;padding:0 4px}
.ed-top{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9;display:none;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
.ed-top>*{pointer-events:auto}
.ed-tools{display:flex;gap:2px;align-items:center;padding:6px;border-radius:999px;background:linear-gradient(160deg,var(--ink),var(--ink3));box-shadow:0 6px 24px #0007}
.ed-ib{width:40px;height:40px;border:0;border-radius:50%;background:transparent;color:#cfd6e4;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.12s}
.ed-ib svg{width:21px;height:21px}
.ed-ib:hover:not(:disabled){background:#ffffff1f}
.ed-ib:disabled{opacity:.3;cursor:default}
.ed-ib.on,.ed-ib.on:hover:not(:disabled){background:linear-gradient(135deg,var(--acc),var(--acc2));color:#04211d}
.ed-sep{width:1px;height:24px;background:#ffffff26;margin:0 6px}
.ed-save{padding:0 16px;height:40px;margin-left:4px;background:#ffffff14;color:#cfd6e4;border-radius:999px;border:0;cursor:pointer;font-weight:500}
.ed-save.dirty{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#04211d;font-weight:700}
.ed-save:disabled{opacity:.4}
.ed-hint{padding:7px 16px;border-radius:999px;background:linear-gradient(160deg,var(--ink),var(--ink3));box-shadow:0 6px 24px #0007;color:#cfd6e4;font-size:13px;display:none}
.ed-right{position:fixed;right:12px;top:12px;bottom:12px;width:270px;z-index:9;display:none;flex-direction:column;gap:10px;pointer-events:none}
.ed-right>*{pointer-events:auto}
.ed-outline{padding:14px;display:flex;flex-direction:column;gap:6px;max-height:34vh;min-height:0}
.ed-outline .ed-list{overflow:auto;display:flex;flex-direction:column;gap:5px}
.ed-details{padding:14px;display:none;flex-direction:column;gap:8px;overflow:auto;min-height:0}
.ed-meta{color:#667085;font-size:12px}
.ed-mat{display:flex;flex-direction:column;gap:2px;padding:8px 0;border-top:1px solid #e5e8ee}
.ed-mat label{display:flex;align-items:center;gap:8px;font-size:12px;color:#475467}
.ed-mat label b{width:22px;color:#12151c}
.ed-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:11;max-width:min(640px,50vw);padding:11px 20px;border-radius:999px;
  background:linear-gradient(160deg,var(--ink),var(--ink3));box-shadow:0 6px 24px #0008;color:#fff;text-align:center;white-space:pre-wrap;transition:opacity .2s}
.ed-toast:empty{opacity:0}
`;

const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  room: svg('<path d="M4 20V8l8-4 8 4v12M4 20h16M9 20v-6h6v6"/>'),
  floor: svg('<path d="M3 14l9 5 9-5-9-5zM3 14v-2l9-5 9 5v2"/>'),
  wall: svg('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 12h18M9 5v7M15 12v7"/>'),
  persp: svg('<path d="M12 3l8 4v10l-8 4-8-4V7zM12 11v10M4 7l8 4 8-4"/>'),
  ortho: svg('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16M12 4v16"/>'),
  grid: svg('<path d="M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>'),
  magnet: svg('<path d="M6 3v8a6 6 0 0 0 12 0V3M6 7h4M14 7h4"/>'),
  world: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
  local: svg('<path d="M5 19V4M5 19h15M5 19l7-7"/><path d="M3 6l2-2 2 2M18 17l2 2-2 2"/>'),
  undo: svg('<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>'),
  move: svg('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5"/>'),
  scale: svg('<path d="M4 20L20 4M14 4h6v6M4 14v6h6"/>'),
  cube: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
};

export function createEditorUi(h: EditorHandlers) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'ed';
  document.body.appendChild(root);

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
    const e = document.createElement(tag);
    e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const row = (...children: HTMLElement[]) => {
    const r = el('div', '', 'ed-row');
    r.append(...children);
    return r;
  };
  const pill = (label: string, onClick: () => void, cls = '') => {
    const b = el('button', label, `ed-pill ${cls}`.trim());
    b.onclick = onClick;
    return b;
  };
  const card = (...children: HTMLElement[]) => {
    const c = el('div', '', 'ed-card');
    c.append(...children);
    return c;
  };
  const title = (t: string) => el('div', t, 'ed-title');
  const select = (onChange?: (id: string) => void) => {
    const s = el('select');
    if (onChange) s.onchange = () => onChange(s.value);
    return s;
  };
  const fill = (s: HTMLSelectElement, items: Option[], selected: string | null, placeholder: string) => {
    s.replaceChildren(
      Object.assign(el('option', placeholder), { value: '' }),
      ...items.map((i) => Object.assign(el('option', i.name), { value: i.id })),
    );
    s.value = selected ?? '';
  };
  const big = (icon: string, label: string, sub: string, onClick: () => void) => {
    const b = el('button', '', 'ed-big');
    b.innerHTML = `${icon}<div>${label}<small>${sub}</small></div>`;
    b.onclick = onClick;
    return b;
  };
  const back = (label: string, to: () => void) => {
    const b = el('button', '', 'ed-pill ed-back');
    b.innerHTML = `<span style="width:16px;height:16px;display:inline-flex">${ICON.back}</span>${label}`;
    b.onclick = to;
    return b;
  };

  // ---- sidebar ----
  const side = el('div', '', 'ed-panel ed-side');
  const brand = el('div', '', 'ed-brand');
  brand.append(el('i'), document.createTextNode('Immersa'));
  const body = el('div', '', 'ed-body');
  const footer = el('div', '', 'ed-footer');
  side.append(brand, body, footer);

  let view: View = 'home';
  let projectItems: Option[] = [];
  let openId: string | null = null;
  let roomItems: Option[] = [];
  let projectRoomItems: Option[] = [];
  let currentRoomId: string | null = null;
  let addableItems: Option[] = [];
  let projectName = '';
  let hasRoom = false;
  let hasProject = false;

  const goHome = () => setView('home');

  function renderHome() {
    body.replaceChildren(
      big(ICON.folder, 'Apri progetto', 'La lista dei tuoi progetti', () => setView('projects')),
      big(ICON.plus, 'Nuovo progetto', 'Nome e stanze', () => setView('new')),
      big(ICON.room, 'Le mie stanze', 'Stanze scansionate dal visore', () => setView('rooms')),
    );
  }

  function renderProjects() {
    const list = projectItems.map((p) => {
      const b = el('button', '', 'ed-item');
      b.innerHTML = `${ICON.folder}<span></span>`;
      b.querySelector('span')!.textContent = p.name;
      b.onclick = () => h.onOpenProject(p.id);
      return b;
    });
    body.replaceChildren(
      back('Indietro', goHome),
      el('div', 'Apri progetto', 'ed-h'),
      ...(list.length ? list : [el('div', 'Nessun progetto: creane uno con "Nuovo progetto".', 'ed-title')]),
    );
  }

  function renderNew() {
    const name = el('input');
    name.type = 'text';
    name.placeholder = 'Nome del progetto';
    const checks = roomItems.map((r) => {
      const c = el('input');
      c.type = 'checkbox';
      c.value = r.id;
      const l = el('label', '', 'ed-check');
      l.append(c, document.createTextNode(r.name));
      return l;
    });
    const create = pill('Crea progetto', () => {
      const n = name.value.trim();
      if (!n) return name.focus();
      const ids = checks.map((l) => l.firstChild as HTMLInputElement).filter((c) => c.checked).map((c) => c.value);
      h.onCreateProject(n, ids);
    }, 'acc');
    name.onkeydown = (e) => e.key === 'Enter' && create.click();
    body.replaceChildren(
      back('Indietro', goHome),
      el('div', 'Nuovo progetto', 'ed-h'),
      card(name),
      title('Stanze del progetto'),
      card(...(checks.length ? checks : [el('div', 'Nessuna stanza salvata: scansionala dal visore (tab Scan).', 'ed-meta')])),
      create,
    );
    name.focus();
  }

  function renderRooms() {
    const cards = roomItems.map((r) => {
      const t = el('div', r.name);
      t.style.fontWeight = '700';
      return card(t, row(pill('Rinomina', () => h.onRenameRoom(r.id)), pill('Elimina', () => h.onDeleteRoom(r.id), 'bad')));
    });
    body.replaceChildren(
      back('Indietro', goHome),
      el('div', 'Le mie stanze', 'ed-h'),
      ...(cards.length ? cards : [el('div', 'Nessuna stanza: scansionala e salvala dal visore (tab Scan).', 'ed-title')]),
    );
  }

  const shellBox = el('input');
  shellBox.type = 'checkbox';
  shellBox.checked = true;
  shellBox.onchange = () => h.onShell(shellBox.checked);
  const fileInput = el('input', '', 'ed-file');
  fileInput.type = 'file';
  fileInput.accept = '.glb';
  fileInput.onchange = () => {
    if (fileInput.files?.[0]) h.onUpload(fileInput.files[0]);
    fileInput.value = '';
  };

  function renderProject() {
    const name = el('div', projectName);
    name.style.cssText = 'font-weight:700;font-size:16px';
    const rooms = projectRoomItems.map((r) => {
      const b = el('button', '', `ed-item${r.id === currentRoomId ? ' on' : ''}`);
      b.innerHTML = `${ICON.room}<span></span>`;
      b.querySelector('span')!.textContent = r.name;
      b.onclick = () => h.onProjectRoom(r.id);
      return b;
    });
    const addable = select();
    fill(addable, addableItems, null, addableItems.length ? '— aggiungi una stanza —' : "(nessun'altra stanza)");
    addable.disabled = !addableItems.length;
    const add = pill('Aggiungi', () => addable.value && h.onAddRoom(addable.value));
    add.disabled = !addableItems.length;
    const remove = pill('Togli la stanza dal progetto', h.onRemoveRoom, 'bad');
    remove.disabled = !hasRoom;
    fileInput.disabled = !hasRoom;
    const shellLabel = el('label', '', 'ed-check');
    shellLabel.append(shellBox, document.createTextNode('Mostra le pareti scansionate'));
    body.replaceChildren(
      back('Chiudi progetto', h.onCloseProject),
      card(name, row(pill('Rinomina', h.onRenameProject), pill('Elimina', h.onDeleteProject, 'bad'))),
      title('Stanze del progetto'),
      ...(rooms.length ? rooms : [el('div', 'Nessuna stanza: aggiungine una.', 'ed-meta')]),
      card(row(addable, add), remove),
      shellLabel,
      title('Aggiungi un modello (.glb)'),
      fileInput,
    );
  }

  function render() {
    ({ home: renderHome, projects: renderProjects, new: renderNew, rooms: renderRooms, project: renderProject })[view]();
  }
  function setView(v: View) {
    view = v;
    render();
    syncChrome();
  }

  // ---- toolbar ----
  const top = el('div', '', 'ed-top');
  const tools = el('div', '', 'ed-tools');
  const ib = (icon: string, tip: string, onClick: () => void) => {
    const b = el('button', '', 'ed-ib');
    b.innerHTML = icon;
    b.title = tip;
    b.onclick = onClick;
    return b;
  };
  const sep = () => el('div', '', 'ed-sep');
  let state: ToolbarState = { build: null, gizmo: 'translate', ortho: false, grid: true, vertex: true, local: false, canUndo: false, canRedo: false };
  const bFloor = ib(ICON.floor, 'Pavimento: trascina sul pavimento per disegnarlo', () => h.onBuild(state.build === 'floor' ? null : 'floor'));
  const bWall = ib(ICON.wall, 'Parete: trascina sul pavimento per disegnarla', () => h.onBuild(state.build === 'wall' ? null : 'wall'));
  const bMove = ib(ICON.move, 'Sposta (W)', () => h.onGizmo('translate'));
  const bRotate = ib(ICON.rotate, 'Ruota (E)', () => h.onGizmo('rotate'));
  const bScale = ib(ICON.scale, 'Scala (R)', () => h.onGizmo('scale'));
  const bOrtho = ib(ICON.persp, 'Camera: prospettiva / ortogonale dall\'alto (pianta)', () => h.onOrtho(!state.ortho));
  const bGrid = ib(ICON.grid, 'Snap alla griglia (5 cm, rotazione a 15°)', () => h.onSnapGrid(!state.grid));
  const bVertex = ib(ICON.magnet, 'Snap ai vertici di pareti e pavimenti', () => h.onSnapVertex(!state.vertex));
  const bLocal = ib(ICON.world, 'Pivot: mondo / relativo all\'oggetto', () => h.onLocal(!state.local));
  const bUndo = ib(ICON.undo, 'Annulla (Ctrl+Z)', h.onUndo);
  const bRedo = ib(ICON.redo, 'Ripeti (Ctrl+Y)', h.onRedo);
  const save = el('button', 'Salva', 'ed-save');
  save.onclick = h.onSave;
  tools.append(bFloor, bWall, sep(), bMove, bRotate, bScale, sep(), bOrtho, sep(), bGrid, bVertex, bLocal, sep(), bUndo, bRedo, save);
  const hint = el('div', '', 'ed-hint');
  top.append(tools, hint);

  // ---- outline + details ----
  const right = el('div', '', 'ed-right');
  const outline = el('div', '', 'ed-panel ed-outline');
  outline.append(el('div', 'Scena', 'ed-h'));
  const outlineList = el('div', '', 'ed-list');
  outline.append(outlineList);
  const details = el('div', '', 'ed-panel ed-details');
  right.append(outline, details);

  const toast = el('div', '', 'ed-toast');
  root.append(side, top, right, toast);

  function syncChrome() {
    const on = view === 'project' && hasProject;
    top.style.display = on ? 'flex' : 'none';
    right.style.display = on ? 'flex' : 'none';
  }

  const numberField = (value: number, step: string, min: string | null, onInput: (v: number, commit: boolean) => void) => {
    const i = el('input');
    i.type = 'number';
    i.step = step;
    if (min !== null) i.min = min;
    i.value = String(Number(value.toFixed(3)));
    i.oninput = () => i.value !== '' && Number.isFinite(Number(i.value)) && onInput(Number(i.value), false);
    i.onchange = () => i.value !== '' && Number.isFinite(Number(i.value)) && onInput(Number(i.value), true);
    return i;
  };
  const colorField = (value: string, onInput: (hex: string, commit: boolean) => void) => {
    const i = el('input');
    i.type = 'color';
    i.value = value;
    i.oninput = () => onInput(i.value, false);
    i.onchange = () => onInput(i.value, true);
    return i;
  };
  const slider = (label: string, value: number, onInput: (v: number, commit: boolean) => void) => {
    const r = el('input');
    r.type = 'range';
    r.min = '0';
    r.max = '1';
    r.step = '0.01';
    r.value = String(value);
    r.oninput = () => onInput(Number(r.value), false);
    r.onchange = () => onInput(Number(r.value), true);
    const l = el('label');
    l.append(el('b', label), r);
    return l;
  };

  let lastSig = '';
  function renderDetails(d: Details | null) {
    details.style.display = d ? 'flex' : 'none';
    if (!d) return;
    const del = pill('Elimina', h.onDeleteSelection, 'bad');
    if (d.kind === 'multi') {
      details.replaceChildren(el('div', `${d.count} oggetti selezionati`, 'ed-h'), card(el('div', 'Il gizmo li muove e li ruota insieme.', 'ed-meta'), del));
      return;
    }
    if (d.kind === 'model') {
      const size = el('div', d.size ? `${d.size.map((n) => n.toFixed(2)).join(' × ')} m` : 'carico...', 'ed-meta');
      const mats = d.materials.map((m, i) => {
        const wrap = el('div', '', 'ed-mat');
        const head = row(colorField(m.color, (hex, c) => h.onModelLook({ target: i, color: hex }, c)), el('span', m.name));
        head.style.fontSize = '12px';
        wrap.append(
          head,
          slider('R', m.roughness, (v, c) => h.onModelLook({ target: i, roughness: v }, c)),
          slider('M', m.metalness, (v, c) => h.onModelLook({ target: i, metalness: v }, c)),
        );
        return wrap;
      });
      const all = row(el('span', 'Tutti'), colorField(d.materials[0]?.color ?? '#ffffff', (hex, c) => h.onModelLook({ target: 'all', color: hex }, c)));
      details.replaceChildren(
        el('div', 'Modello', 'ed-h'),
        card(
          row(el('span', 'Scala'), numberField(d.scale, '0.01', '0.001', (v, c) => h.onModelScale(v, c))),
          row(el('span', 'Rotazione °'), numberField(d.yawDeg, '1', null, (v, c) => h.onModelYaw(v, c))),
          size,
        ),
        el('div', 'Materiali', 'ed-h'),
        card(
          ...(mats.length ? [all, ...mats, pill('Colori originali', () => h.onModelLook({ reset: true }, true))] : [el('div', 'carico...', 'ed-meta')]),
        ),
        card(del),
      );
      return;
    }
    const rows: HTMLElement[] = [];
    if (d.type === 'wall') rows.push(row(el('span', 'Altezza (m)'), numberField(d.height, '0.1', '0.05', (v, c) => h.onStructure({ height: v }, c))));
    rows.push(row(el('span', 'Spessore (m)'), numberField(d.thickness, '0.01', '0.01', (v, c) => h.onStructure({ thickness: v }, c))));
    rows.push(row(el('span', 'Colore'), colorField(d.color, (hex, c) => h.onStructure({ color: hex }, c))));
    details.replaceChildren(el('div', d.type === 'wall' ? 'Parete' : 'Pavimento', 'ed-h'), card(...rows, el('div', d.measure, 'ed-meta')), card(del));
  }

  render();

  const setState = (project: boolean, room: boolean) => {
    hasProject = project;
    hasRoom = room;
    syncChrome();
    if (view === 'project') renderProject();
  };

  return {
    footer,
    setStatus(text: string) {
      toast.textContent = text;
    },
    setView,
    getView: () => view,
    setProjects(items: Option[], selected: string | null) {
      projectItems = items;
      openId = selected;
      if (view === 'projects') renderProjects();
    },
    setRooms(items: Option[]) {
      roomItems = items;
      if (view === 'rooms') renderRooms();
    },
    // The project being edited: its name, rooms, the open room, and the account rooms it could still use.
    setProject(name: string, rooms: Option[], currentId: string | null, addable: Option[]) {
      projectName = name;
      projectRoomItems = rooms;
      currentRoomId = currentId;
      addableItems = addable;
      if (view === 'project') renderProject();
    },
    setState,
    setDirty(dirty: boolean) {
      save.classList.toggle('dirty', dirty);
      save.textContent = dirty ? 'Salva *' : 'Salva';
    },
    setToolbar(s: ToolbarState) {
      state = s;
      const on = (b: HTMLElement, v: boolean) => b.classList.toggle('on', v);
      on(bFloor, s.build === 'floor');
      on(bWall, s.build === 'wall');
      on(bMove, s.gizmo === 'translate');
      on(bRotate, s.gizmo === 'rotate');
      on(bScale, s.gizmo === 'scale');
      on(bOrtho, s.ortho);
      bOrtho.innerHTML = s.ortho ? ICON.ortho : ICON.persp;
      on(bGrid, s.grid);
      on(bVertex, s.vertex);
      on(bLocal, s.local);
      bLocal.innerHTML = s.local ? ICON.local : ICON.world;
      bUndo.disabled = !s.canUndo;
      bRedo.disabled = !s.canRedo;
      hint.style.display = s.build ? 'block' : 'none';
      hint.textContent =
        (s.build === 'wall' ? 'Parete: trascina sul pavimento (Maiusc = linea dritta)' : 'Pavimento: trascina sul pavimento') +
        ' · tieni premuto Maiusc per crearne altri di fila · Esc per uscire';
    },
    setOutline(items: OutlineItem[], selected: Set<string>) {
      outlineList.replaceChildren(
        ...(items.length
          ? items.map((it) => {
              const b = el('button', '', `ed-item${selected.has(it.key) ? ' on' : ''}`);
              b.innerHTML = `${it.kind === 'model' ? ICON.cube : ICON[it.kind]}<span></span>`;
              b.querySelector('span')!.textContent = it.name;
              b.onclick = (e) => h.onPick(it.key, e.shiftKey || e.ctrlKey || e.metaKey);
              return b;
            })
          : [el('div', 'Vuota: aggiungi un modello o costruisci.', 'ed-meta')]),
      );
    },
    setDetails(d: Details | null) {
      const sig = JSON.stringify(d);
      if (sig === lastSig) return;
      // While typing in a field, a refresh of the same kind of object must not rewrite it under the cursor.
      if (d && lastSig && details.contains(document.activeElement) && JSON.parse(lastSig)?.kind === d.kind) return;
      lastSig = sig;
      renderDetails(d);
    },
    openId: () => openId,
  };
}
