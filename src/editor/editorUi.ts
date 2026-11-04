import '@fontsource/sen/latin-500.css';
import '@fontsource/sen/latin-700.css';
import { AURA } from '../ui3d/theme';

// DOM UI of the PC editor, in the same "Aura" look as the headset menu: ink gradient, white cards, turquoise accent, font Sen.
// Layout for mouse + keyboard: left sidebar (project, rooms, models), top toolbar (tools), right inspector, bottom toast.
export type Tool = 'select' | 'translate' | 'rotate' | 'build';
export type BuildKind = 'floor' | 'wall';

export interface EditorHandlers {
  onProject(id: string): void;
  onNewProject(): void;
  onRenameProject(): void;
  onDeleteProject(): void;
  onProjectRoom(id: string): void;
  onAddRoom(id: string): void;
  onRemoveRoom(): void;
  onShell(visible: boolean): void;
  onUpload(file: File): void;
  onSelect(id: string): void;
  onTool(tool: Tool): void;
  onBuildKind(kind: BuildKind): void;
  onScale(value: number): void;
  onDeleteModel(): void;
  onStructureHeight(value: number): void;
  onDeleteStructure(): void;
  onSave(): void;
  onRenameRoom(id: string): void;
  onDeleteRoom(id: string): void;
}

export interface SelectionInfo {
  scale: number;
  yawDeg: number; // saved heading
  size: [number, number, number] | null; // metres, null while the file is loading
}

export interface StructureInfo {
  kind: BuildKind;
  height: number;
  length: number; // walls: length; floors: area
}

type Option = { id: string; name: string };

const A = AURA;
const CSS = `
.ed{--ink:${A.bgStops[0]};--ink2:${A.bgStops[1]};--ink3:${A.bgStops[2]};--acc:${A.accent[0]};--acc2:${A.accent[1]};--tint:${A.surfaceHover};
  font-family:'Sen',system-ui,sans-serif;font-size:14px;color:#fff}
.ed *{box-sizing:border-box;font-family:inherit}
.ed button,.ed select,.ed input{font-size:14px}
.ed-side{position:fixed;top:12px;left:12px;bottom:12px;width:310px;z-index:10;display:flex;flex-direction:column;gap:10px;padding:14px;
  border-radius:22px;background:linear-gradient(160deg,var(--ink),var(--ink2) 55%,var(--ink3));box-shadow:0 10px 40px #0008;overflow:auto}
.ed-brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;letter-spacing:.02em}
.ed-brand i{width:12px;height:12px;border-radius:4px;background:linear-gradient(135deg,var(--acc),var(--acc2));box-shadow:0 0 12px var(--acc)}
.ed-title{color:#8b95a7;font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:6px 4px 0}
.ed-card{background:#fff;color:#12151c;border-radius:16px;padding:10px;display:flex;flex-direction:column;gap:8px}
.ed-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ed-card select,.ed-card input[type=number]{width:100%;padding:8px 10px;border-radius:10px;border:1px solid #d9dee8;background:#f4f6fa;color:#12151c;outline:none}
.ed-card input[type=number]{width:90px}
.ed-card select:focus,.ed-card input:focus{border-color:var(--acc)}
.ed-pill{border:0;border-radius:999px;padding:8px 14px;background:#e8ecf3;color:#12151c;cursor:pointer;font-weight:500;transition:.12s;display:inline-flex;align-items:center;gap:6px}
.ed-pill:hover:not(:disabled){background:var(--tint)}
.ed-pill:disabled{opacity:.4;cursor:default}
.ed-pill.acc{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#04211d;font-weight:700}
.ed-pill.bad:hover:not(:disabled){background:#ef4444;color:#fff}
.ed-pill.ghost{background:#ffffff14;color:#fff}
.ed-pill.ghost:hover:not(:disabled){background:#ffffff26}
.ed-item{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:12px;background:#fff;color:#12151c;cursor:pointer;border:2px solid transparent;
  text-align:left;width:100%;font-weight:500;transition:.12s}
.ed-item:hover{background:var(--tint)}
.ed-item.on{border-color:var(--acc);background:var(--tint)}
.ed-list{display:flex;flex-direction:column;gap:6px;max-height:26vh;overflow:auto}
.ed-check{display:flex;gap:8px;align-items:center;color:#cfd6e4;padding:0 4px;cursor:pointer}
.ed-check input{accent-color:var(--acc)}
.ed-file{color:#cfd6e4;font-size:12px}
.ed-file::file-selector-button{border:0;border-radius:999px;padding:7px 12px;margin-right:8px;background:#ffffff1f;color:#fff;cursor:pointer;font-family:inherit}
.ed-top{position:fixed;top:12px;left:340px;right:12px;z-index:9;display:flex;gap:10px;align-items:flex-start;pointer-events:none}
.ed-top>*{pointer-events:auto}
.ed-tools{display:flex;gap:4px;padding:6px;border-radius:999px;background:linear-gradient(160deg,var(--ink),var(--ink3));box-shadow:0 6px 24px #0007}
.ed-tools .ed-pill{background:transparent;color:#cfd6e4}
.ed-tools .ed-pill:hover:not(:disabled){background:#ffffff1f}
.ed-tools .ed-pill.on{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#04211d;font-weight:700}
.ed-grow{flex:1}
.ed-save{box-shadow:0 6px 24px #0007;padding:11px 20px}
.ed-save.dirty{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#04211d;font-weight:700}
.ed-save:not(.dirty){background:linear-gradient(160deg,var(--ink),var(--ink3));color:#cfd6e4}
.ed-build{position:fixed;top:72px;left:340px;z-index:9;display:none;gap:10px;align-items:center;padding:8px 14px 8px 8px;border-radius:999px;
  background:linear-gradient(160deg,var(--ink),var(--ink3));box-shadow:0 6px 24px #0007}
.ed-build span{color:#aeb7c8;font-size:13px}
.ed-insp{position:fixed;right:12px;top:72px;width:250px;z-index:9;display:none;flex-direction:column;gap:10px;padding:14px;border-radius:20px;
  background:linear-gradient(160deg,var(--ink),var(--ink2) 55%,var(--ink3));box-shadow:0 10px 40px #0008}
.ed-insp b{font-size:15px}
.ed-insp .ed-card{gap:6px}
.ed-meta{color:#8b95a7;font-size:12px}
.ed-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:11;max-width:min(640px,60vw);padding:11px 20px;border-radius:999px;
  background:linear-gradient(160deg,var(--ink),var(--ink3));box-shadow:0 6px 24px #0008;color:#fff;text-align:center;white-space:pre-wrap;transition:opacity .2s}
.ed-toast:empty{opacity:0}
.ed-kbd{color:#8b95a7;font-size:11px;padding:2px 6px;margin-left:4px}
`;

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

  // ---- sidebar ----
  const side = el('div', '', 'ed-side');
  const brand = el('div', '', 'ed-brand');
  brand.append(el('i'), document.createTextNode('Immersa'));

  const projects = select(h.onProject);
  const projectButtons = [pill('Nuovo', h.onNewProject, 'acc'), pill('Rinomina', h.onRenameProject), pill('Elimina', h.onDeleteProject, 'bad')];

  const projectRooms = select(h.onProjectRoom);
  const addable = select();
  const addButton = pill('Aggiungi', () => addable.value && h.onAddRoom(addable.value));
  const removeButton = pill('Togli dal progetto', h.onRemoveRoom, 'bad');

  const shell = el('input');
  shell.type = 'checkbox';
  shell.checked = true;
  shell.onchange = () => h.onShell(shell.checked);
  const shellRow = el('label', '', 'ed-check');
  shellRow.append(shell, document.createTextNode('Mostra le pareti scansionate'));

  const file = el('input', '', 'ed-file');
  file.type = 'file';
  file.accept = '.glb';
  file.onchange = () => {
    if (file.files?.[0]) h.onUpload(file.files[0]);
    file.value = '';
  };
  const list = el('div', '', 'ed-list');

  const accountRooms = select();
  const accountButtons = [
    pill('Rinomina', () => accountRooms.value && h.onRenameRoom(accountRooms.value)),
    pill('Elimina', () => accountRooms.value && h.onDeleteRoom(accountRooms.value), 'bad'),
  ];

  side.append(
    brand,
    title('Progetto'),
    card(projects, row(...projectButtons)),
    title('Stanze del progetto'),
    card(projectRooms, row(addable, addButton), removeButton),
    shellRow,
    title('Modelli di questa stanza (.glb)'),
    file,
    list,
    title('Tutte le tue stanze'),
    card(accountRooms, row(...accountButtons)),
  );

  // ---- toolbar ----
  const top = el('div', '', 'ed-top');
  const toolDefs: [Tool, string][] = [
    ['select', 'Seleziona'],
    ['translate', 'Sposta'],
    ['rotate', 'Ruota'],
    ['build', 'Costruisci'],
  ];
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  const tools = el('div', '', 'ed-tools');
  for (const [id, label] of toolDefs) {
    const b = pill(label, () => h.onTool(id));
    toolButtons.set(id, b);
    tools.append(b);
  }
  const save = pill('Salva', h.onSave, 'ed-save');
  top.append(tools, el('div', '', 'ed-grow'), save);

  // Build options (shown with the Build tool).
  const build = el('div', '', 'ed-build');
  const kindButtons = new Map<BuildKind, HTMLButtonElement>();
  for (const [id, label] of [['floor', 'Pavimento'], ['wall', 'Parete']] as [BuildKind, string][]) {
    const b = pill(label, () => h.onBuildKind(id), 'ghost');
    kindButtons.set(id, b);
    build.append(b);
  }
  const buildHint = el('span');
  build.append(buildHint);

  // ---- inspector ----
  const insp = el('div', '', 'ed-insp');
  const inspTitle = el('b');
  const scale = el('input');
  scale.type = 'number';
  scale.step = '0.01';
  scale.min = '0.001';
  scale.onchange = () => {
    const v = Number(scale.value);
    if (v > 0) h.onScale(v);
  };
  const size = el('div', '', 'ed-meta');
  const modelCard = card(row(el('span', 'Scala'), scale), size, pill('Elimina modello', h.onDeleteModel, 'bad'));
  const height = el('input');
  height.type = 'number';
  height.step = '0.1';
  height.min = '0.05';
  height.onchange = () => {
    const v = Number(height.value);
    if (v > 0) h.onStructureHeight(v);
  };
  const heightRow = row(el('span', 'Altezza (m)'), height);
  const structMeta = el('div', '', 'ed-meta');
  const structCard = card(heightRow, structMeta, pill('Elimina', h.onDeleteStructure, 'bad'));
  insp.append(inspTitle, modelCard, structCard);

  const toast = el('div', '', 'ed-toast');
  root.append(side, top, build, insp, toast);

  // Keyboard shortcuts are wired by the editor (it knows the state); here only the visual hint.
  save.append(el('span', 'Ctrl+S', 'ed-kbd'));

  const set = (els: HTMLElement[], on: boolean) => els.forEach((e) => ((e as HTMLButtonElement).disabled = !on));
  const setState = (project: boolean, room: boolean) => {
    set([projectButtons[1], projectButtons[2], addButton, addable, projectRooms], project);
    set([removeButton, file, save, ...toolButtons.values()], project && room);
  };
  setState(false, false);

  return {
    setStatus(text: string) {
      toast.textContent = text;
    },
    setDirty(dirty: boolean) {
      save.classList.toggle('dirty', dirty);
      save.firstChild!.textContent = dirty ? 'Salva *' : 'Salva';
    },
    setProjects(items: Option[], selected: string | null) {
      fill(projects, items, selected, items.length ? '— scegli un progetto —' : '(nessun progetto)');
    },
    setProjectRooms(items: Option[], selected: string | null, addableRooms: Option[]) {
      fill(projectRooms, items, selected, items.length ? '— scegli una stanza —' : '(nessuna stanza)');
      fill(addable, addableRooms, null, addableRooms.length ? '— aggiungi una stanza —' : "(nessun'altra stanza)");
    },
    setAccountRooms(items: Option[]) {
      fill(accountRooms, items, null, items.length ? '— scegli una stanza —' : '(nessuna stanza)');
    },
    setState,
    setTool(tool: Tool, kind: BuildKind) {
      for (const [id, b] of toolButtons) b.classList.toggle('on', id === tool);
      for (const [id, b] of kindButtons) b.classList.toggle('acc', tool === 'build' && id === kind);
      for (const [id, b] of kindButtons) b.classList.toggle('ghost', !(tool === 'build' && id === kind));
      build.style.display = tool === 'build' ? 'flex' : 'none';
      buildHint.textContent =
        kind === 'wall'
          ? 'Trascina sul pavimento: dal punto iniziale al finale (Maiusc = linea dritta)'
          : 'Trascina sul pavimento per disegnare il rettangolo';
    },
    setModels(models: Option[], selectedId: string | null) {
      list.replaceChildren(
        ...models.map((m) => {
          const b = el('button', m.name, `ed-item${m.id === selectedId ? ' on' : ''}`);
          b.onclick = () => h.onSelect(m.id);
          return b;
        }),
      );
    },
    setSelection(info: SelectionInfo | null) {
      modelCard.style.display = info ? 'flex' : 'none';
      structCard.style.display = 'none';
      insp.style.display = info ? 'flex' : 'none';
      if (!info) return;
      inspTitle.textContent = 'Modello';
      scale.value = String(info.scale);
      size.textContent = `${info.size ? `${info.size.map((n) => n.toFixed(2)).join(' × ')} m` : 'carico...'} · ${info.yawDeg.toFixed(0)}°`;
    },
    setStructure(info: StructureInfo | null) {
      structCard.style.display = info ? 'flex' : 'none';
      if (info) {
        modelCard.style.display = 'none';
        insp.style.display = 'flex';
        inspTitle.textContent = info.kind === 'wall' ? 'Parete' : 'Pavimento';
        heightRow.style.display = info.kind === 'wall' ? 'flex' : 'none';
        height.value = String(info.height);
        structMeta.textContent = info.kind === 'wall' ? `Lunga ${info.length.toFixed(2)} m` : `Superficie ${info.length.toFixed(2)} m²`;
      } else if (modelCard.style.display === 'none') {
        insp.style.display = 'none';
      }
    },
  };
}
