// DOM side panel of the PC editor (Italian labels, like the login box).
export interface EditorHandlers {
  onUpload(file: File): void;
  onSelect(id: string): void;
  onMode(mode: 'translate' | 'rotate'): void;
  onScale(value: number): void;
  onDelete(): void;
  onSave(): void;
}

export interface SelectionInfo {
  scale: number;
  size: [number, number, number] | null; // metres, null while the file is loading
}

export function createEditorUi(h: EditorHandlers) {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;top:56px;left:8px;width:260px;padding:10px;background:#000c;color:#fff;' +
    'font:13px sans-serif;z-index:10;display:flex;flex-direction:column;gap:8px';
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

  const status = el('div');
  status.style.cssText = 'color:#8f8;min-height:1.2em;white-space:pre-wrap';

  const file = el('input');
  file.type = 'file';
  file.accept = '.glb';
  file.onchange = () => {
    if (file.files?.[0]) h.onUpload(file.files[0]);
    file.value = '';
  };

  const list = el('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:3px;max-height:30vh;overflow:auto';

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
    button('Elimina', () => h.onDelete()),
    row(el('span', 'Scala'), scale, size),
  );
  selection.style.display = 'none';

  const save = button('Salva stanza', () => h.onSave());
  box.append(el('b', 'Editor stanza'), status, el('div', 'Carica modello (.glb)'), file, list, selection, save);

  return {
    setStatus(text: string) {
      status.textContent = text;
    },
    setDirty(dirty: boolean) {
      save.textContent = dirty ? 'Salva stanza *' : 'Salva stanza';
      save.style.fontWeight = dirty ? 'bold' : 'normal';
    },
    setModels(models: { id: string; name: string }[], selectedId: string | null) {
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
