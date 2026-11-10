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
  multiline?: boolean; // a key adds a line break (the text of a note)
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
  act?: 'shift' | 'back' | 'space' | 'ok' | 'sym' | 'acc' | 'abc' | 'enter';
}

const chars = (s: string): Key[] => [...s].map((c) => ({ label: c, ch: c, w: 1 }));
const DIGITS = chars('1234567890');

// QWERTY like the Meta keyboard: number row, shift, backspace, ?123 page, space, OK.
function rows(mode: Mode, multiline = false): Key[][] {
  const bottom = (first: Key): Key[] => [
    first,
    ...(multiline ? [{ label: '↵', act: 'enter' as const, w: 1 }] : []),
    { label: ',', ch: ',', w: 1 },
    { label: '', act: 'space', w: multiline ? 4 : 5 },
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
const H = 572; // five rows of keys (130 + 5 x 76 + 4 x 8 = 542) and a margin under them
const PAD = 12;
const GAP = 8;

// On-screen keyboard: a tilted panel that appears within arm's reach, below the eyes, and then stays where it is, so the
// fingers can be put on the keys (see poke.ts). The laser works on it too. Dark keys like the system keyboard, in Immersa's
// font; the OK key is turquoise.
const SIZE = 0.54; // m, width of the panel
const KEY = { fill: 'rgba(46,50,60,0.96)', hoverFill: 'rgba(32,128,118,0.97)', downFill: '#2dd4bf' }; // the key under a finger goes turquoise

export function createKeyboard(host: UiHost, parent: Object3D, head: () => { pos: Vector3; fwd: Vector3 } | null) {
  const panel = new Panel(SIZE, (SIZE * H) / W, W / SIZE);
  panel.mesh.visible = false;
  parent.add(panel.mesh);
  host.add(panel);
  // 0.4 m in front of you and 0.38 m below the eyes, turned to face you, the top leaning away: where a hand rests to type.
  // It stays put while you type and follows like the menu does: round when you turn far, up or down when you stand or sit.
  const DIST = 0.4;
  const DROP = 0.38;
  let kYaw = 0;
  let kPos = new Vector3();
  let kY = 0;
  let followYaw = false;
  let followPos = false;
  let followY = false;
  const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  function apply(h: { pos: Vector3 }) {
    panel.mesh.position.set(kPos.x, kY, kPos.z);
    panel.mesh.rotation.set(-0.85, Math.atan2(h.pos.x - kPos.x, h.pos.z - kPos.z), 0, 'YXZ');
    panel.mesh.updateMatrixWorld(true);
  }
  function place() {
    const h = head();
    if (!h) return;
    const f = new Vector3(h.fwd.x, 0, h.fwd.z);
    if (f.length() < 0.2) f.set(0, 0, -1);
    f.normalize();
    kYaw = Math.atan2(f.x, f.z);
    kPos = new Vector3(h.pos.x + f.x * DIST, 0, h.pos.z + f.z * DIST);
    kY = h.pos.y - DROP;
    followYaw = followPos = followY = false;
    apply(h);
  }
  function follow(h: { pos: Vector3; fwd: Vector3 }, dt: number) {
    if (!panel.mesh.visible) return;
    if (Math.hypot(h.fwd.x, h.fwd.z) > 0.3) {
      const d = wrapAngle(Math.atan2(h.fwd.x, h.fwd.z) - kYaw);
      if (Math.abs(d) > 0.75) followYaw = true;
      if (followYaw) {
        kYaw += d * Math.min(1, dt * 3);
        if (Math.abs(wrapAngle(Math.atan2(h.fwd.x, h.fwd.z) - kYaw)) < 0.12) followYaw = false;
      }
    }
    const tx = h.pos.x + Math.sin(kYaw) * DIST;
    const tz = h.pos.z + Math.cos(kYaw) * DIST;
    const err = Math.hypot(tx - kPos.x, tz - kPos.z);
    if (err > 0.18) followPos = true;
    if (followPos) {
      const k = Math.min(1, dt * 3);
      kPos.x += (tx - kPos.x) * k;
      kPos.z += (tz - kPos.z) * k;
      if (err < 0.04) followPos = false;
    }
    const dy = h.pos.y - DROP - kY;
    if (Math.abs(dy) > 0.07) followY = true;
    if (followY) {
      kY += dy * Math.min(1, dt * 2);
      if (Math.abs(dy) < 0.02) followY = false;
    }
    apply(h);
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
        if (text && !text.endsWith(' ') && !text.endsWith('\n')) type(' ');
        break;
      case 'enter':
        if (text && !text.endsWith('\n')) type('\n');
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
      { kind: 'row', rect: { x: PAD, y: 8 + 40, w: W - 2 * PAD - 190, h: 70 }, text: req?.secret ? '•'.repeat(text.length) : text.replace(/\n/g, ' ↵ '), caret: true, size: 40, fill: 'rgba(14,16,22,0.9)', hoverFill: 'rgba(14,16,22,0.9)', color: '#ffffff', glass: true },
      ...(text
        ? [
            {
              kind: 'iconbtn' as const,
              icon: 'close' as const,
              rect: { x: W - PAD - 190 - 58, y: 8 + 40 + 9, w: 52, h: 52 },
              text: '',
              fill: 'rgba(255,255,255,0.16)',
              onClick: () => {
                text = ''; // clears everything at once
                if (req?.capital !== false) shift = 'once';
                req?.onChange?.(text);
                render();
              },
            },
          ]
        : []),
      { glass: true, rect: { x: W - PAD - 170, y: 48, w: 170, h: 70 }, text: 'Annulla', size: 28, color: '#ffffff', ...KEY, onClick: cancel },
    ];
    const unit = (W - 2 * PAD - 9 * GAP) / 10;
    const keyH = 76;
    rows(mode, !!req?.multiline).forEach((row, r) => {
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
          size: k.ch || k.act === 'space' || k.act === 'enter' ? 38 : 30,
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
    follow,
    panel,
    isOpen: () => panel.mesh.visible,
    // Test hook: what a typed sequence of keys would produce.
    get text() {
      return text;
    },
  };
}
