import type { WebGLRenderer } from 'three';

// Our own "Enter AR" button (ARButton restyles itself). Returns the button and a
// start() that can also be called right after a click, e.g. after logging in.
export function createEnterAr(renderer: WebGLRenderer, features: string[]) {
  const init: XRSessionInit = { optionalFeatures: ['local-floor', ...features] };
  const button = document.createElement('button');
  button.textContent = 'Entra in AR';
  const note = document.createElement('div');

  async function use(session: XRSession) {
    await renderer.xr.setSession(session);
    session.addEventListener('end', () => offer());
  }

  async function start() {
    note.textContent = '';
    try {
      await use(await navigator.xr!.requestSession('immersive-ar', init));
    } catch (e) {
      note.textContent = `Impossibile avviare l'AR: ${e instanceof Error ? e.message : e}`;
    }
  }

  // Quest Browser can show its own "enter" entry for the page.
  function offer() {
    const xr = navigator.xr as (XRSystem & { offerSession?: (mode: XRSessionMode, init?: XRSessionInit) => Promise<XRSession> }) | undefined;
    xr?.offerSession?.('immersive-ar', init).then(use).catch(() => undefined);
  }

  button.onclick = start;
  offer();
  return { button, note, start };
}
