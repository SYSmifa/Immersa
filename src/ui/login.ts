import { authenticate } from '../cloud/auth';
import { supabase } from '../cloud/supabase';

// Small DOM login box (top right). Done on the 2D page before entering AR:
// the session is kept in the browser, so on the Quest it is typed once.
export async function createLogin() {
  if (!supabase) return;
  const sb = supabase;

  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;top:8px;right:8px;padding:8px 10px;background:#000a;color:#fff;' +
    'font:13px sans-serif;z-index:10;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:60vw';
  document.body.appendChild(box);

  const button = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
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
  const status = document.createElement('span');

  const run = async (signUp: boolean) => {
    status.textContent = '...';
    const res = await authenticate(email.value, password.value, signUp);
    if (res.ok) location.reload();
    else status.textContent = res.message;
  };
  box.append(email, password, button('Accedi', () => run(false)), button('Registrati', () => run(true)), status);
}
