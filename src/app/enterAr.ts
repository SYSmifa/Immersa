import type { WebGLRenderer } from 'three';

// Our own "Enter AR" button (ARButton restyles itself). Returns the button and a
// start() that can also be called right after a click, e.g. after logging in.
export function createEnterAr(renderer: WebGLRenderer, features: string[]) {
  const init: XRSessionInit = { optionalFeatures: ['local-floor', ...features] };
  const button = document.createElement('button');
  button.textContent = 'Entra in AR';
  const note = document.createElement('div');

  async function use(session: XRSession) {
    try {
      await renderer.xr.setSession(session);
    } catch (e) {
      // The browser does not offer the unbounded space: end this session and retry with local-floor.
      session.end().catch(() => undefined);
      renderer.xr.setReferenceSpaceType('local-floor');
      await renderer.xr.setSession(await navigator.xr!.requestSession('immersive-ar', init));
      return;
    }
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

  // End the running session and start a new one (a fresh session has no Guardian with the
  // unbounded space). Starting needs a user gesture in some browsers: if it is refused the
  // launcher page shows again and one tap on "Entra in AR" does it.
  async function restart() {
    await renderer.xr.getSession()?.end().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 400));
    await start();
  }

  button.onclick = start;
  offer();
  return { button, note, start, restart };
}
