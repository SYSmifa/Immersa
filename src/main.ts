import { runHeadsetApp } from './app/headset';
import { createEditorPage } from './editor/editor';
import { runTestScene } from './scene/testScene';

// Routes: ?test / ?probe (diagnostics), ?uitest (3D menu on the PC), ?edit (PC editor);
// otherwise the headset gets the AR app and the PC gets the editor.
const params = new URLSearchParams(location.search);

async function main() {
  if (params.has('test') || params.has('probe')) return runTestScene(params.has('probe'));
  if (params.has('uitest')) return (await import('./app/uitest')).runUiTest();
  if (params.has('edittest')) return (await import('./app/edittest')).runEditTest();
  if (params.has('edit')) return createEditorPage();
  const support = (mode: XRSessionMode) => navigator.xr?.isSessionSupported(mode).catch(() => false) ?? Promise.resolve(false);
  const [inHeadset, vr] = await Promise.all([support('immersive-ar'), support('immersive-vr')]);
  console.log(`[immersa] xr=${!!navigator.xr} ar=${inHeadset} vr=${vr} display=${['standalone', 'fullscreen', 'browser'].find((m) => matchMedia(`(display-mode: ${m})`).matches)} referrer=${document.referrer} ua=${navigator.userAgent}`);
  return inHeadset ? runHeadsetApp() : createEditorPage();
}

window.addEventListener('error', (e) => console.log(`[immersa] error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => console.log(`[immersa] rejection: ${String(e.reason)}`));
void main().catch((e) => console.log(`[immersa] main failed: ${String(e)}`));

// Installable app: the service worker is only for the production build (in dev it would cache stale code).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
