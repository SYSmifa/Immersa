import { authenticate } from '../cloud/auth';
import { supabase } from '../cloud/supabase';

// Small DOM login box (top right). Done on the 2D page before entering AR:
// the session is kept in the browser, so on the Quest it is typed once.
export async function createLogin() {
  if (!supabase) return;
  const sb = supabase;

  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;bottom:12px;left:12px;width:310px;padding:10px 14px;border-radius:18px;color:#cfd6e4;' +
    'background:linear-gradient(160deg,#0b0d12,#1d222d);box-shadow:0 6px 24px #0007;font:13px Sen,system-ui,sans-serif;' +
    'z-index:12;display:flex;gap:6px;align-items:center;flex-wrap:wrap';
  document.body.appendChild(box);

  const button = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'border:0;border-radius:999px;padding:7px 14px;background:linear-gradient(135deg,#14b8a6,#2dd4bf);color:#04211d;font:700 13px Sen,system-ui,sans-serif;cursor:pointer';
    b.onclick = onClick;
    return b;
  };

  const { data } = await sb.auth.getSession();
  if (data.session) {
    const label = document.createElement('span');
    label.textContent = data.session.user.email ?? 'signed in';
    box.append(
      label,
      button('Esci', async () => {
        await sb.auth.signOut();
        location.reload();
      }),
    );
    return;
  }

  const email = document.createElement('input');
  email.type = 'email';
  email.placeholder = 'email';
  const password = document.createElement('input');
  password.type = 'password';
  password.placeholder = 'password';
  for (const i of [email, password]) i.style.cssText = 'flex:1;min-width:0;padding:7px 10px;border-radius:10px;border:1px solid #3a4150;background:#0b0d12;color:#fff;font:13px Sen,system-ui,sans-serif';
  const status = document.createElement('span');

  const run = async (signUp: boolean) => {
    status.textContent = '...';
    const res = await authenticate(email.value, password.value, signUp);
    if (res.ok) location.reload();
    else status.textContent = res.message;
  };
  box.append(email, password, button('Accedi', () => run(false)), button('Registrati', () => run(true)), status);
}
