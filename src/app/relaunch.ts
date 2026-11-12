// Relaunching the installed app from inside, the way the Library starts it (see docs/android-relaunch/README.md).
// A page cannot restart the app by itself; the APK has a small activity (RelaunchActivity) that the page asks through an
// intent: URL, and which starts the app again from scratch. Several ways of doing it are built in, so that they can be
// tried one after the other without rebuilding the APK: ?relaunch=clear|remove|vr|legacy (the choice is remembered).
//   clear:  start the app's launcher in a new task, clearing the old one
//   remove: close the app's tasks first, then start it again after a moment
//   vr:     like clear, with the category the Quest home uses to start VR apps
//   legacy: the old way (an https intent to the running app: it is only delivered to the app that is already open)

export type RelaunchMode = 'clear' | 'remove' | 'vr' | 'legacy';
const MODES: RelaunchMode[] = ['clear', 'remove', 'vr', 'legacy'];
const MODE_KEY = 'immersa.relaunch.mode';
const MARK_KEY = 'immersa.relaunch.mark';
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
  return saved && MODES.includes(saved) ? saved : 'remove'; // 'clear' did not work on the headset (the new start is lost); 'remove' reopens the app
}

export const relaunchUrl = (mode: RelaunchMode, host = location.host) =>
  mode === 'legacy'
    ? `intent://${host}/#Intent;scheme=https;package=${PACKAGE};end`
    : `intent://relaunch?mode=${mode}#Intent;scheme=immersa;package=${PACKAGE};end`;

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
