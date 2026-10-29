// The only 2D screen of the headset app: one big button into AR (the browser needs a click to
// start a session). Signing in happens inside AR (see the menu), so a store PWA is immersive only.
export async function createLauncher(enter: { button: HTMLButtonElement; note: HTMLElement }) {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:18px;background:#0f1117;color:#fff;font:20px system-ui,sans-serif;z-index:20;text-align:center;padding:24px';
  document.body.appendChild(box);

  const title = document.createElement('div');
  title.textContent = 'Immersa';
  title.style.cssText = 'font-size:48px;font-weight:600';
  enter.button.style.cssText =
    'font:600 36px system-ui,sans-serif;padding:28px 72px;border-radius:20px;border:0;background:#3466f0;color:#fff;cursor:pointer';
  enter.note.style.color = '#ffd36b';

  function show() {
    box.style.display = 'flex';
    box.replaceChildren(title, enter.button, enter.note);
  }
  // In AR the page is not visible; it is shown again when the session ends.
  show();
  return { show, hide: () => (box.style.display = 'none') };
}
