import type { Object3D } from 'three';
import type { UiHost } from './host';
import { Panel, type Widget } from './panel';

export interface KeyboardRequest {
  title: string;
  initial?: string;
  max?: number;
  onDone(text: string): void;
  onCancel?(): void;
}

type Mode = 'letters' | 'sym' | 'acc';
type Shift = 'off' | 'once' | 'caps';
interface Key {
  label: string;
  w: number;
  ch?: string; // character typed
  act?: 'shift' | 'back' | 'space' | 'ok' | 'sym' | 'acc' | 'abc';
}

const chars = (s: string): Key[] => [...s].map((c) => ({ label: c, ch: c, w: 1 }));
const DIGITS = chars('1234567890');

// QWERTY like the Meta keyboard: number row, shift, backspace, ?123 page, space, OK.
function rows(mode: Mode): Key[][] {
  const bottom = (first: Key): Key[] => [
    first,
    { label: ',', ch: ',', w: 1 },
    { label: '', act: 'space', w: 5 },
    { label: '.', ch: '.', w: 1 },
    { label: 'OK', act: 'ok', w: 1.5 },
  ];
  const back: Key = { label: '⌫', act: 'back', w: 1.5 };
  if (mode === 'sym') {
    return [
      DIGITS,
      chars('@#$%&*-+()'),
      chars('!"\':;/?_='),
      [{ label: 'àé', act: 'acc', w: 1.5 }, ...chars('[]{}<>~'), back],
      bottom({ label: 'ABC', act: 'abc', w: 1.5 }),
    ];
  }
  if (mode === 'acc') {
    return [
      DIGITS,
      chars('àèéìòùçñäö'),
      chars('üßåøæœ¿¡«'),
      [{ label: '#+=', act: 'sym', w: 1.5 }, ...chars('ÀÈÉÌÒÙÇ'), back],
      bottom({ label: 'ABC', act: 'abc', w: 1.5 }),
    ];
  }
  return [
    DIGITS,
    chars('qwertyuiop'),
    chars('asdfghjkl'),
    [{ label: '⇧', act: 'shift', w: 1.5 }, ...chars('zxcvbnm'), back],
    bottom({ label: '?123', act: 'sym', w: 1.5 }),
  ];
}

const PX = 1200;
const W = 1080;
const H = 520;
const PAD = 12;
const GAP = 8;

// On-screen keyboard as a tilted 3D panel under the menu. Pointed at with the same
// rays as the menu (see UiHost), so names can be typed without leaving AR.
export function createKeyboard(host: UiHost, parent: Object3D) {
  const panel = new Panel(W / PX, H / PX, PX);
  panel.mesh.position.set(0, -0.54, 0.12);
  panel.mesh.rotation.x = -0.55; // top leans away, like a keyboard held in front of you
  panel.mesh.visible = false;
  parent.add(panel.mesh);
  host.add(panel);

  let req: KeyboardRequest | null = null;
  let text = '';
  let mode: Mode = 'letters';
  let shift: Shift = 'off';
  let lastShiftTap = 0;

  const upper = () => mode === 'letters' && shift !== 'off';

  function type(ch: string) {
    if (text.length >= (req?.max ?? 24)) return;
    text += upper() ? ch.toUpperCase() : ch;
    if (shift === 'once') shift = 'off';
    render();
  }

  function press(k: Key) {
    if (k.ch) return type(k.ch);
    switch (k.act) {
      case 'space':
        if (text && !text.endsWith(' ')) type(' ');
        break;
      case 'back':
        text = text.slice(0, -1);
        if (!text) shift = 'once';
        break;
      case 'shift': {
        const t = performance.now();
        shift = shift === 'off' ? 'once' : shift === 'once' && t - lastShiftTap < 400 ? 'caps' : 'off';
        lastShiftTap = t;
        break;
      }
      case 'sym':
        mode = 'sym';
        break;
      case 'acc':
        mode = 'acc';
        break;
      case 'abc':
        mode = 'letters';
        break;
      case 'ok':
        return done();
    }
    render();
  }

  function done() {
    const value = text.trim();
    if (!value || !req) return;
    const r = req;
    close();
    r.onDone(value);
  }

  function cancel() {
    const r = req;
    close();
    r?.onCancel?.();
  }

  function render() {
    const widgets: Widget[] = [
      { kind: 'label', rect: { x: PAD, y: 6, w: 280, h: 44 }, text: req?.title ?? '', size: 24, color: '#9fb0d0' },
      { kind: 'field', rect: { x: PAD, y: 8 + 40, w: W - 2 * PAD - 190, h: 70 }, text: `${text}│`, size: 40 },
      { rect: { x: W - PAD - 170, y: 48, w: 170, h: 70 }, text: 'Annulla', size: 28, onClick: cancel },
    ];
    const unit = (W - 2 * PAD - 9 * GAP) / 10;
    const keyH = 76;
    rows(mode).forEach((row, r) => {
      // A key of weight w spans w columns plus the gaps between them, so rows line up.
      const width = (k: Key) => k.w * unit + (k.w - 1) * GAP;
      const total = row.reduce((sum, k) => sum + width(k), 0) + (row.length - 1) * GAP;
      let x = (W - total) / 2;
      const y = 130 + r * (keyH + GAP);
      for (const k of row) {
        const w = width(k);
        const isShift = k.act === 'shift';
        widgets.push({
          kind: 'key',
          rect: { x, y, w, h: keyH },
          text: k.ch ? (upper() ? k.label.toUpperCase() : k.label) : k.label,
          size: k.ch || k.act === 'space' ? 38 : 30,
          primary: k.act === 'ok',
          active: isShift && shift !== 'off',
          disabled: k.act === 'ok' && !text.trim(),
          onClick: () => press(k),
        });
        if (isShift && shift === 'caps') widgets[widgets.length - 1].text = '⇪';
        x += w + GAP;
      }
    });
    panel.set(widgets);
  }

  function close() {
    panel.mesh.visible = false;
    req = null;
  }

  return {
    open(r: KeyboardRequest) {
      req = r;
      text = r.initial ?? '';
      mode = 'letters';
      shift = text ? 'off' : 'once'; // names start with a capital
      panel.mesh.visible = true;
      render();
    },
    close,
    panel,
    isOpen: () => panel.mesh.visible,
    // Test hook: what a typed sequence of keys would produce.
    get text() {
      return text;
    },
  };
}
