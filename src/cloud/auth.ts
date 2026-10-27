import { supabase } from './supabase';

export type AuthResult = { ok: true } | { ok: false; message: string };

// Email + password sign-in / sign-up. ok=true only when a session exists.
export async function authenticate(email: string, password: string, signUp: boolean): Promise<AuthResult> {
  if (!supabase) return { ok: false, message: 'Supabase non configurato (.env.local)' };
  const creds = { email: email.trim(), password };
  const { data, error } = signUp ? await supabase.auth.signUp(creds) : await supabase.auth.signInWithPassword(creds);
  if (error) return { ok: false, message: error.message };
  if (!data.session) return { ok: false, message: 'Controlla la mail per confermare, poi Accedi' };
  return { ok: true };
}
