// DOM side panel of the PC editor (Italian labels, like the login box).
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
  onMode(mode: 'translate' | 'rotate'): void;
  onScale(value: number): void;
  onDeleteModel(): void;
  onSave(): void;
  onRenameRoom(id: string): void;
  onDeleteRoom(id: string): void;
}

export interface SelectionInfo {
  scale: number;
  size: [number, number, number] | null; // metres, null while the file is loading
}

type Option = { id: string; name: string };

export function createEditorUi(h: EditorHandlers) {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;top:8px;left:8px;width:290px;max-height:calc(100vh - 16px);overflow:auto;padding:10px;' +
    'background:#000c;color:#fff;font:13px sans-serif;z-index:10;display:flex;flex-direction:column;gap:8px';
  document.body.appendChild(box);

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
    const e = document.createElement(tag);
    e.textContent = text;
    return e;
  };
  const row = (...children: HTMLElement[]) => {
    const r = el('div');
    r.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';
    r.append(...children);
    return r;
  };
  const button = (label: string, onClick: () => void) => {
    const b = el('button', label);
    b.onclick = onClick;
    return b;
  };
  const section = (title: string) => {
    const t = el('div', title);
    t.style.cssText = 'color:#9fb0d0;margin-top:4px';
    return t;
  };
  const select = (onChange?: (id: string) => void) => {
    const s = el('select');
    s.style.cssText = 'width:100%';
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

  const status = el('div');
  status.style.cssText = 'color:#8f8;min-height:1.2em;white-space:pre-wrap';

  const projects = select(h.onProject);
  const projectButtons = [
    button('Nuovo', h.onNewProject),
    button('Rinomina', h.onRenameProject),
    button('Elimina', h.onDeleteProject),
  ];

  const projectRooms = select(h.onProjectRoom);
  const addable = select();
  const addButton = button('Aggiungi', () => addable.value && h.onAddRoom(addable.value));
  const removeButton = button('Togli dal progetto', h.onRemoveRoom);

  const shell = el('input');
  shell.type = 'checkbox';
  shell.checked = true;
  shell.onchange = () => h.onShell(shell.checked);
  const shellRow = el('label');
  shellRow.style.cssText = 'display:flex;gap:6px;align-items:center';
  shellRow.append(shell, document.createTextNode('Mostra le pareti'));

  const file = el('input');
  file.type = 'file';
  file.accept = '.glb';
  file.onchange = () => {
    if (file.files?.[0]) h.onUpload(file.files[0]);
    file.value = '';
  };

  const list = el('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:3px;max-height:22vh;overflow:auto';

  const scale = el('input');
  scale.type = 'number';
  scale.step = '0.01';
  scale.min = '0.001';
  scale.style.width = '80px';
  scale.onchange = () => {
    const v = Number(scale.value);
    if (v > 0) h.onScale(v);
  };
  const size = el('span');
  const selection = row(
    button('Sposta', () => h.onMode('translate')),
    button('Ruota', () => h.onMode('rotate')),
    button('Elimina modello', h.onDeleteModel),
    row(el('span', 'Scala'), scale, size),
  );
  selection.style.display = 'none';

  const save = button('Salva progetto', h.onSave);

  const accountRooms = select();
  const accountButtons = [
    button('Rinomina', () => accountRooms.value && h.onRenameRoom(accountRooms.value)),
    button('Elimina', () => accountRooms.value && h.onDeleteRoom(accountRooms.value)),
  ];

  box.append(
    el('b', 'Editor Immersa'),
    status,
    section('Progetto'),
    projects,
    row(...projectButtons),
    section('Stanze del progetto'),
    projectRooms,
    row(addable, addButton),
    removeButton,
    shellRow,
    section('Modelli di questa stanza (.glb)'),
    file,
    list,
    selection,
    save,
    section("Tutte le tue stanze"),
    accountRooms,
    row(...accountButtons),
  );

  const set = (els: HTMLElement[], on: boolean) => els.forEach((e) => ((e as HTMLButtonElement).disabled = !on));
  const setState = (project: boolean, room: boolean) => {
    set([projectButtons[1], projectButtons[2], addButton, addable, projectRooms], project);
    set([removeButton, file, save], project && room);
    set([file], project && room);
  };
  setState(false, false);

  return {
    setStatus(text: string) {
      status.textContent = text;
    },
    setDirty(dirty: boolean) {
      save.textContent = dirty ? 'Salva progetto *' : 'Salva progetto';
      save.style.fontWeight = dirty ? 'bold' : 'normal';
    },
    setProjects(items: Option[], selected: string | null) {
      fill(projects, items, selected, items.length ? '— scegli un progetto —' : '(nessun progetto)');
    },
    setProjectRooms(items: Option[], selected: string | null, addableRooms: Option[]) {
      fill(projectRooms, items, selected, items.length ? '— scegli una stanza —' : '(nessuna stanza)');
      fill(addable, addableRooms, null, addableRooms.length ? '— aggiungi una stanza —' : '(nessun\'altra stanza)');
    },
    setAccountRooms(items: Option[]) {
      fill(accountRooms, items, null, items.length ? '— scegli una stanza —' : '(nessuna stanza)');
    },
    setState,
    setModels(models: Option[], selectedId: string | null) {
      list.replaceChildren(
        ...models.map((m) => {
          const b = button(m.name, () => h.onSelect(m.id));
          b.style.cssText = `text-align:left;${m.id === selectedId ? 'outline:2px solid #4af' : ''}`;
          return b;
        }),
      );
    },
    setSelection(info: SelectionInfo | null) {
      selection.style.display = info ? 'flex' : 'none';
      if (!info) return;
      scale.value = String(info.scale);
      size.textContent = info.size ? `${info.size.map((n) => n.toFixed(2)).join(' × ')} m` : 'carico...';
    },
  };
}
