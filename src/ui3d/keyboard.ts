import type { Object3D } from 'three';
import type { UiHost } from './host';
import { theme } from './theme';
import { Vector3 } from 'three';
import { Panel, type Widget } from './panel';

export interface KeyboardRequest {
  title: string;
  initial?: string;
  max?: number;
  secret?: boolean; // show dots instead of the typed text (passwords)
  capital?: boolean; // start with a capital letter (names); false for emails and passwords
  allowEmpty?: boolean; // OK works with nothing typed (a search that is being cleared)
  onChange?(text: string): void; // after every key that changes the text (a live filter)
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

const W = 1080;
const H = 520;
const PAD = 12;
const GAP = 8;

// On-screen keyboard: a tilted panel that appears within arm's reach, below the eyes, and then stays where it is, so the
// fingers can be put on the keys (see poke.ts). The laser works on it too. Dark keys like the system keyboard, in Immersa's
// font; the OK key is turquoise.
const SIZE = 0.54; // m, width of the panel
const KEY = { fill: 'rgba(46,50,60,0.96)', hoverFill: 'rgba(84,92,108,0.98)', downFill: '#2dd4bf' };

export function createKeyboard(host: UiHost, parent: Object3D, head: () => { pos: Vector3; fwd: Vector3 } | null) {
  const panel = new Panel(SIZE, (SIZE * H) / W, W / SIZE);
  panel.mesh.visible = false;
  parent.add(panel.mesh);
  host.add(panel);
  // 0.4 m in front of you and 0.38 m below the eyes, turned to face you, the top leaning away: where a hand rests to type.
  function place() {
    const h = head();
    if (!h) return;
    const f = new Vector3(h.fwd.x, 0, h.fwd.z);
    if (f.length() < 0.2) f.set(0, 0, -1);
    f.normalize();
    panel.mesh.position.set(h.pos.x + f.x * 0.4, h.pos.y - 0.38, h.pos.z + f.z * 0.4);
    panel.mesh.rotation.set(-0.85, Math.atan2(h.pos.x - panel.mesh.position.x, h.pos.z - panel.mesh.position.z), 0, 'YXZ');
    panel.mesh.updateMatrixWorld(true);
  }

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
    req?.onChange?.(text);
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
        if (!text && req?.capital !== false) shift = 'once';
        req?.onChange?.(text);
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
    const value = req?.secret ? text : text.trim();
    if ((!value && !req?.allowEmpty) || !req) return;
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
      { kind: 'label', rect: { x: PAD, y: 6, w: 280, h: 44 }, text: req?.title ?? '', size: 24, color: theme().headerSub },
      { kind: 'row', rect: { x: PAD, y: 8 + 40, w: W - 2 * PAD - 190, h: 70 }, text: `${req?.secret ? '•'.repeat(text.length) : text}│`, size: 40, fill: 'rgba(14,16,22,0.9)', hoverFill: 'rgba(14,16,22,0.9)', color: '#ffffff', glass: true },
      { glass: true, rect: { x: W - PAD - 170, y: 48, w: 170, h: 70 }, text: 'Annulla', size: 28, color: '#ffffff', ...KEY, onClick: cancel },
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
          glass: true,
          color: '#ffffff',
          ...(k.act === 'ok' ? {} : KEY),
          disabled: k.act === 'ok' && !text.trim() && !req?.allowEmpty,
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
      shift = text || r.capital === false ? 'off' : 'once'; // names start with a capital
      place(); // near you, and it stays there
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
