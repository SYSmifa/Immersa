import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Credentials come from .env.local (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
// Without them the app runs local-only.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

export async function currentUserEmail(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.email ?? null;
}
