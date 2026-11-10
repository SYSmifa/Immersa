// The headset app sets this (Account → "Prova profondità") and the NEXT start from the Library opens the probe instead of the
// app, once: leaving a session closes the installed app, so the probe cannot be opened from inside it.
const FLAG = 'immersa.depthprobe';
export const askDepthProbe = () => {
  try {
    localStorage.setItem(FLAG, String(Date.now()));
  } catch {
    /* storage unavailable */
  }
};
export function takeDepthProbeRequest(): boolean {
  try {
    const t = Number(localStorage.getItem(FLAG));
    localStorage.removeItem(FLAG);
    return t > 0 && Date.now() - t < 15 * 60 * 1000; // a forgotten request does not hijack a start a day later
  } catch {
    return false;
  }
}
