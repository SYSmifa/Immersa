import { supabase } from './supabase';

const BUCKET = 'models';

// URL a loader can fetch: public/models/<file> for "local:" paths, else a signed storage URL.
export async function modelUrl(path: string): Promise<string> {
  if (path.startsWith('local:')) return `/models/${path.slice(6)}`;
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// SHA-256 of the file as hex, or null where crypto.subtle is missing (plain http).
async function fileHash(file: Blob): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Uploads a GLB into the user's own folder of the private "models" bucket. The path is the hash of the content
// (`<user>/<hash>.glb`): the same model uploaded twice is stored once, and two different models with the same name
// never share an address (the name is only a label in the project).
export async function uploadModel(file: File): Promise<{ path: string; name: string }> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) throw new Error('not signed in');
  const hash = await fileHash(file);
  const path = hash ? `${uid}/${hash}.glb` : `${uid}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: 'model/gltf-binary', upsert: false });
  if (error && !(hash && /already exists|duplicate/i.test(error.message))) throw new Error(error.message);
  return { path, name: file.name };
}

// Deletes the user's files that no project uses any more. `used` = every model path of every project of the user.
// Files younger than `minAgeMs` are left alone: they may belong to a project that is still being edited and not saved.
// Best effort: never throws.
export async function pruneModels(used: Set<string>, minAgeMs = 24 * 3600 * 1000): Promise<number> {
  try {
    if (!supabase) return 0;
    const { data: auth } = await supabase.auth.getSession();
    const uid = auth.session?.user.id;
    if (!uid) return 0;
    const { data, error } = await supabase.storage.from(BUCKET).list(uid, { limit: 1000 });
    if (error || !data) return 0;
    const old = data.filter((f) => f.id && !used.has(`${uid}/${f.name}`) && Date.now() - new Date(f.created_at ?? Date.now()).getTime() > minAgeMs);
    if (!old.length) return 0;
    const { error: e } = await supabase.storage.from(BUCKET).remove(old.map((f) => `${uid}/${f.name}`));
    return e ? 0 : old.length;
  } catch {
    return 0;
  }
}

export interface StoredModel {
  path: string;
  size: number; // bytes
  createdAt: string;
}

// The user's files in the bucket (for the library). Empty without Supabase.
export async function listModels(): Promise<StoredModel[]> {
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) return [];
  const { data, error } = await supabase.storage.from(BUCKET).list(uid, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((f) => f.id)
    .map((f) => ({ path: `${uid}/${f.name}`, size: Number((f.metadata as { size?: number } | null)?.size ?? 0), createdAt: f.created_at ?? '' }));
}

export async function removeModels(paths: string[]): Promise<void> {
  if (!supabase || !paths.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw new Error(error.message);
}
