import { authenticate } from '../cloud/auth';
import type { Backend } from '../cloud/backend';

// The only 2D screen of the headset app: sign in once (the real keyboard works
// here), then one big button into AR. After that everything happens in AR.
export async function createLauncher(backend: Backend, enter: { button: HTMLButtonElement; note: HTMLElement; start(): void }) {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:18px;background:#0f1117;color:#fff;font:20px system-ui,sans-serif;z-index:20;text-align:center;padding:24px';
  document.body.appendChild(box);

  const title = document.createElement('div');
  title.textContent = 'Immersa';
  title.style.cssText = 'font-size:48px;font-weight:600';
  const status = document.createElement('div');
  status.style.color = '#ffd36b';

  enter.button.style.cssText =
    'font:600 36px system-ui,sans-serif;padding:28px 72px;border-radius:20px;border:0;background:#3466f0;color:#fff;cursor:pointer';
  enter.note.style.color = '#ffd36b';

  const field = (type: string, placeholder: string) => {
    const i = document.createElement('input');
    i.type = type;
    i.placeholder = placeholder;
    i.style.cssText = 'font-size:24px;padding:14px 18px;width:min(520px,80vw);border-radius:12px;border:1px solid #3a4560;background:#1a1e28;color:#fff';
    return i;
  };
  const linkButton = (text: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = onClick;
    b.style.cssText = 'font-size:20px;padding:10px 20px;border-radius:12px;border:1px solid #3a4560;background:#1a1e28;color:#fff;cursor:pointer';
    return b;
  };

  async function show() {
    box.replaceChildren(title);
    const email = await backend.email().catch(() => null);
    if (email) {
      const who = document.createElement('div');
      who.textContent = email;
      who.style.color = '#9fb0d0';
      box.append(who, enter.button, enter.note);
      return;
    }
    const mail = field('email', 'email');
    mail.autocomplete = 'email';
    const pass = field('password', 'password');
    pass.autocomplete = 'current-password';
    pass.spellcheck = false;
    // The headset keyboard can misbehave in password fields (no digits, no backspace): a plain-text mode helps.
    const reveal = linkButton('Mostra password', () => {
      pass.type = pass.type === 'password' ? 'text' : 'password';
      reveal.textContent = pass.type === 'password' ? 'Mostra password' : 'Nascondi password';
      pass.focus();
    });
    const run = async (signUp: boolean) => {
      status.textContent = '...';
      const res = await authenticate(mail.value, pass.value, signUp);
      if (!res.ok) {
        status.textContent = res.message;
        return;
      }
      await show();
      enter.start(); // the click on Accedi is still a valid user gesture
    };
    pass.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void run(false); // never return false from here: it would cancel every other key
    });
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px';
    row.append(linkButton('Accedi', () => void run(false)), linkButton('Registrati', () => void run(true)));
    box.append(mail, pass, reveal, row, status);
  }

  await show();
  // Inside AR the page is not visible; show it again when the session ends.
  return { show };
}
