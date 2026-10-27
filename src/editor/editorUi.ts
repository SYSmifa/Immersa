// DOM side panel of the PC editor (Italian labels, like the login box).
export interface EditorHandlers {
  onRoom(id: string): void;
  onRenameRoom(): void;
  onDeleteRoom(): void;
  onProject(id: string): void;
  onNewProject(): void;
  onRenameProject(): void;
  onDeleteProject(): void;
  onUpload(file: File): void;
  onSelect(id: string): void;
  onMode(mode: 'translate' | 'rotate'): void;
  onScale(value: number): void;
  onDeleteModel(): void;
  onSave(): void;
}

export interface SelectionInfo {
  scale: number;
  size: [number, number, number] | null; // metres, null while the file is loading
}

type Option = { id: string; name: string };

export function createEditorUi(h: EditorHandlers) {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;top:8px;left:8px;width:280px;max-height:calc(100vh - 16px);overflow:auto;padding:10px;' +
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
  const select = (onChange: (id: string) => void) => {
    const s = el('select');
    s.style.cssText = 'width:100%';
    s.onchange = () => onChange(s.value);
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

  const rooms = select(h.onRoom);
  const renameRoom = button('Rinomina', h.onRenameRoom);
  const deleteRoom = button('Elimina', h.onDeleteRoom);
  const projects = select(h.onProject);
  const projectButtons = [
    button('Nuovo', h.onNewProject),
    button('Rinomina', h.onRenameProject),
    button('Elimina', h.onDeleteProject),
  ];

  const file = el('input');
  file.type = 'file';
  file.accept = '.glb';
  file.onchange = () => {
    if (file.files?.[0]) h.onUpload(file.files[0]);
    file.value = '';
  };

  const list = el('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:3px;max-height:25vh;overflow:auto';

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
  const projectControls = [...projectButtons, file, save];

  box.append(
    el('b', 'Editor Immersa'),
    status,
    section('Stanza'),
    rooms,
    row(renameRoom, deleteRoom),
    section('Progetto'),
    projects,
    row(...projectButtons),
    section('Modelli (.glb)'),
    file,
    list,
    selection,
    save,
  );
  const enableProject = (on: boolean) => projectControls.forEach((c) => ((c as HTMLButtonElement).disabled = !on));
  renameRoom.disabled = deleteRoom.disabled = true;
  enableProject(false);

  return {
    setStatus(text: string) {
      status.textContent = text;
    },
    setDirty(dirty: boolean) {
      save.textContent = dirty ? 'Salva progetto *' : 'Salva progetto';
      save.style.fontWeight = dirty ? 'bold' : 'normal';
    },
    setRooms(items: Option[], selected: string | null) {
      fill(rooms, items, selected, items.length ? '— scegli una stanza —' : '(nessuna stanza)');
      renameRoom.disabled = deleteRoom.disabled = !selected;
    },
    // `enabled`: a room is chosen, so projects can be created.
    setProjects(items: Option[], selected: string | null, enabled: boolean) {
      fill(projects, items, selected, items.length ? '— scegli un progetto —' : '(nessun progetto)');
      projectButtons[0].disabled = !enabled;
      for (const b of [projectButtons[1], projectButtons[2], file, save]) (b as HTMLButtonElement).disabled = !selected;
    },
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
