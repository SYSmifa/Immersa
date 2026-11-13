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
const H = 616; // five rows of keys (130 + 5 x 76 + 4 x 8 = 542), the grip bar under them and a margin
const PAD = 12;
const GAP = 8;

// On-screen keyboard: a tilted panel that appears within arm's reach, below the eyes, and then stays where it is, so the
// fingers can be put on the keys (see poke.ts). The laser works on it too. Dark keys like the system keyboard, in Immersa's
// font; the OK key is turquoise.
const SIZE = 0.54; // m, width of the panel
const KEY = { fill: 'rgba(46,50,60,0.96)', hoverFill: 'rgba(32,128,118,0.97)', downFill: '#2dd4bf' }; // the key under a finger goes turquoise

export function createKeyboard(host: UiHost, parent: Object3D, head: () => { pos: Vector3; fwd: Vector3 } | null) {
  const panel = new Panel(SIZE, (SIZE * H) / W, W / SIZE);
  panel.mesh.renderOrder = 1300; // over the panels and the notes' labels and lines (1000-1200), under the hands (1400+)
  panel.mesh.visible = false;
  parent.add(panel.mesh);
  host.add(panel);
  // 0.4 m in front of you and 0.38 m below the eyes, turned to face you, the top leaning away: where a hand rests to type.
  // Once there it STAYS there, however you turn your head (it is not a panel that follows your look): it comes to you again only
  // when you have gone so far that it is no longer in front of you (behind you, to the side, too far, or a floor higher or
  // lower). The small bar under it takes hold of it: pinch the bar and the keyboard goes with the hand until you let go.
  const DIST = 0.4;
  const DROP = 0.38;
  const FAR = 1.4; // m: farther than this it is no longer "in front"
  const SIDE = 1.2; // rad (~69°): more than this from where you look, horizontally, it is no longer in front
  const HIGH = 0.5; // m: this much higher or lower than where it should be
  let kYaw = 0; // which way it faces (set when it is put, not turned with the head)
  let kPos = new Vector3();
  let kY = 0;
  let to: { x: number; z: number; y: number; yaw: number } | null = null; // a new place it is on its way to
  let grabbing = false;
  let grabNew = false; // the grab has just begun: the offset to the hand is taken on the next carry()
  const grabOff = new Vector3();
  let holdUntil = 0; // after a grab it is left where it was put for a while
  const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  function apply() {
    panel.mesh.position.set(kPos.x, kY, kPos.z);
    panel.mesh.rotation.set(-0.85, kYaw, 0, 'YXZ');
    panel.mesh.updateMatrixWorld(true);
  }
  // The place in front of the head: 0.4 m ahead on the level, 0.38 m below the eyes, turned to the head.
  function placeFor(h: { pos: Vector3; fwd: Vector3 }) {
    const f = new Vector3(h.fwd.x, 0, h.fwd.z);
    if (f.length() < 0.2) f.set(0, 0, -1);
    f.normalize();
    const x = h.pos.x + f.x * DIST;
    const z = h.pos.z + f.z * DIST;
    return { x, z, y: h.pos.y - DROP, yaw: Math.atan2(h.pos.x - x, h.pos.z - z) };
  }
  function place() {
    const h = head();
    if (!h) return;
    const t = placeFor(h);
    kPos = new Vector3(t.x, 0, t.z);
    kY = t.y;
    kYaw = t.yaw;
    to = null;
    grabbing = false;
    holdUntil = 0;
    apply();
  }
  // Is it still where you can use it?
  function lost(h: { pos: Vector3; fwd: Vector3 }): boolean {
    const dx = kPos.x - h.pos.x;
    const dz = kPos.z - h.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > FAR || Math.abs(kY - (h.pos.y - DROP)) > HIGH) return true;
    const fl = Math.hypot(h.fwd.x, h.fwd.z);
    if (fl < 0.3 || dist < 0.05) return false; // looking down at it, or standing on it
    return (dx * h.fwd.x + dz * h.fwd.z) / (dist * fl) < Math.cos(SIDE);
  }
  function follow(h: { pos: Vector3; fwd: Vector3 }, dt: number) {
    if (!panel.mesh.visible || grabbing || performance.now() < holdUntil) return;
    if (!to && lost(h)) to = placeFor(h);
    if (!to) return;
    const k = Math.min(1, dt * 4);
    kPos.x += (to.x - kPos.x) * k;
    kPos.z += (to.z - kPos.z) * k;
    kY += (to.y - kY) * k;
    kYaw += wrapAngle(to.yaw - kYaw) * k;
    if (Math.hypot(to.x - kPos.x, to.z - kPos.z) < 0.02 && Math.abs(to.y - kY) < 0.02 && Math.abs(wrapAngle(to.yaw - kYaw)) < 0.05) to = null;
    apply();
  }
  // While the grip is held: the keyboard keeps its place relative to the hand (no jump when it is taken).
  function carry(hand: Vector3 | null) {
    if (!grabbing || !hand) return;
    if (grabNew) {
      grabOff.set(kPos.x - hand.x, kY - hand.y, kPos.z - hand.z);
      grabNew = false;
    }
    kPos.set(hand.x + grabOff.x, 0, hand.z + grabOff.z);
    kY = hand.y + grabOff.y;
    to = null;
    apply();
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
    widgets.push({
      kind: 'grip',
      rect: { x: W / 2 - 150, y: 552, w: 300, h: 40 },
      text: '',
      onDown: () => {
        grabbing = true;
        grabNew = true;
      },
      onUp: () => {
        grabbing = false;
        holdUntil = performance.now() + 4000; // where you put it, it stays
      },
    });
    panel.set(widgets);
  }

  function close() {
    grabbing = false;
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
    carry,
    panel,
    isOpen: () => panel.mesh.visible,
    // Test hook: what a typed sequence of keys would produce.
    get text() {
      return text;
    },
  };
}
