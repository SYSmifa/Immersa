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
  const inHeadset = (await navigator.xr?.isSessionSupported('immersive-ar').catch(() => false)) ?? false;
  return inHeadset ? runHeadsetApp() : createEditorPage();
}

void main();
