// Relaunching the installed app from inside, the way the Library starts it (see docs/android-relaunch/README.md).
// A page cannot restart the app by itself; the APK has a small activity (RelaunchActivity) that the page asks through an
// intent: URL, and which starts the app again from scratch. Several ways of doing it are built in, so that they can be
// tried one after the other without rebuilding the APK: ?relaunch=clear|remove|vr|legacy (the choice is remembered).
//   clear:  start the app's launcher in a new task, clearing the old one
//   remove: close the app's tasks first, then start it again after half a second
//   fast:   like remove, but starts again after 0.15 s (a shorter time with the Meta home showing)
//   vr:     like clear, with the category the Quest home uses to start VR apps
//   legacy: the old way (an https intent to the running app: it is only delivered to the app that is already open)

export type RelaunchMode = 'remove' | 'fast' | 'vr' | 'clear' | 'legacy'; // 'overlap' (new app first, old one removed later) only closed the app
const MODES: RelaunchMode[] = ['fast', 'remove', 'vr', 'clear', 'legacy'];
const MODE_KEY = 'immersa.relaunch.mode';
const MARK_KEY = 'immersa.relaunch.mark';
const AUTO_AT_KEY = 'immersa.relaunch.autoAt'; // when the app last relaunched ITSELF (the guard against relaunch loops)
const AUTO_KEY = 'immersa.relaunch.auto'; // '0' = the automatic relaunch is switched off
const PACKAGE = 'app.immersa.quest';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage can be unavailable */
  }
};

// Chooses the way (from Account in the headset, where there is no address bar to type ?relaunch= in).
export function setRelaunchMode(mode: RelaunchMode) {
  write(MODE_KEY, mode);
}
export const RELAUNCH_MODES = MODES;

// The way to relaunch: from the address (?relaunch=...), else the one remembered, else 'remove'.
export function relaunchMode(): RelaunchMode {
  const asked = new URLSearchParams(location.search).get('relaunch') as RelaunchMode | null;
  if (asked && MODES.includes(asked)) {
    write(MODE_KEY, asked);
    return asked;
  }
  const saved = read(MODE_KEY) as RelaunchMode | null;
  return saved && MODES.includes(saved) ? saved : 'fast'; // 'clear' did not work on the headset (the new start is lost); 'remove' reopens the app
}

// The automatic relaunch (after a scan is saved, after a standby): on unless switched off in Account.
export const autoRestartOn = () => read(AUTO_KEY) !== '0';
export const setAutoRestart = (on: boolean) => write(AUTO_KEY, on ? '1' : '0');
// How long ago the app last relaunched ITSELF (Infinity: never): an automatic relaunch is not repeated within half a minute.
export const noteAutoRestart = () => write(AUTO_AT_KEY, String(Date.now()));
export const autoRestartAge = () => {
  const t = Number(read(AUTO_AT_KEY) ?? 0);
  return t ? Date.now() - t : Infinity;
};

// The browser only follows an intent: link right after a tap of the user (transient user activation, a few seconds). A relaunch
// the app decides by itself (after a scan, after a standby) may come later than that: it runs at once if the page had a tap
// lately, else at the next one (xrApp calls tapped() from the select events of the XR session, which count as a tap).
let waiting: (() => void) | null = null;
export function whenAllowed(go: () => void): 'now' | 'tap' {
  if (navigator.userActivation?.isActive) {
    go();
    return 'now';
  }
  waiting = go;
  return 'tap';
}
export function tapped() {
  const go = waiting;
  waiting = null;
  go?.();
}
// The next way, in Account (the ways are tried one after the other).
export function nextRelaunchMode(): RelaunchMode {
  const next = MODES[(MODES.indexOf(relaunchMode()) + 1) % MODES.length];
  setRelaunchMode(next);
  return next;
}

// What the APK is told for each way (an APK that does not know `delay` just ignores it).
const NATIVE: Record<Exclude<RelaunchMode, 'legacy'>, string> = {
  remove: 'mode=remove&delay=500',
  fast: 'mode=remove&delay=150',
  vr: 'mode=vr',
  clear: 'mode=clear',
};
export const relaunchUrl = (mode: RelaunchMode, host = location.host) =>
  mode === 'legacy'
    ? `intent://${host}/#Intent;scheme=https;package=${PACKAGE};end`
    : `intent://relaunch?${NATIVE[mode]}#Intent;scheme=immersa;package=${PACKAGE};end`;

// Asks the APK to start the app again. A note is left so that the new start can say it came from here.
export function relaunchApp(mode = relaunchMode()) {
  write(MARK_KEY, JSON.stringify({ mode, at: Date.now() }));
  try {
    location.href = relaunchUrl(mode);
  } catch {
    /* not allowed */
  }
}

// At start: was this start asked by relaunchApp (in the last minute)? How, and how long ago.
export function takeRelaunchMark(): { mode: string; seconds: number } | null {
  const raw = read(MARK_KEY);
  write(MARK_KEY, null);
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as { mode: string; at: number };
    const seconds = (Date.now() - m.at) / 1000;
    return seconds >= 0 && seconds < 60 ? { mode: m.mode, seconds } : null;
  } catch {
    return null;
  }
}
