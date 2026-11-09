import { supabase } from './supabase';

const BUCKET = 'models';

// Models imported on the PC but not uploaded yet (they go up when the project is saved, possibly simplified first):
// they live in memory under a "pending:<n>" path that only the editor ever sees.
const pending = new Map<string, { file: File; url?: string }>();
let pendingCount = 0;
export const isPendingModel = (path: string) => path.startsWith('pending:');
export function registerPendingModel(file: File): string {
  const path = `pending:${++pendingCount}`;
  pending.set(path, { file });
  return path;
}
export const pendingModelFile = (path: string) => pending.get(path)?.file;

// URL a loader can fetch: public/models/<file> for "local:" paths, a blob for "pending:" ones, else a signed storage URL.
export async function modelUrl(path: string): Promise<string> {
  const p = pending.get(path);
  if (p) return (p.url ??= URL.createObjectURL(p.file));
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
  if (error && /exceeded the maximum allowed size/i.test(error.message)) throw new Error(`il modello pesa ${(file.size / 1048576).toFixed(0)} MB e supera il limite del cloud (50 MB per file): semplificalo, oppure alza il limite in Supabase → Storage → Settings`);
  if (error && !(hash && /already exists|duplicate/i.test(error.message))) throw new Error(error.message);
  return { path, name: file.name };
}

export interface PruneReport {
  removed: number;
  recent: number; // unused but younger than minAge: kept for now
  error?: string;
}

// Deletes the user's files that no project uses any more. `used` = every model path of every project of the user.
// Files younger than `minAgeMs` are left alone: they may belong to a project that is still being edited and not saved.
// Best effort: never throws, tells what it did.
export async function pruneModels(used: Set<string>, minAgeMs = 24 * 3600 * 1000): Promise<PruneReport> {
  try {
    if (!supabase) return { removed: 0, recent: 0 };
    const { data: auth } = await supabase.auth.getSession();
    const uid = auth.session?.user.id;
    if (!uid) return { removed: 0, recent: 0 };
    const { data, error } = await supabase.storage.from(BUCKET).list(uid, { limit: 1000 });
    if (error || !data) return { removed: 0, recent: 0, error: error?.message ?? 'lista non disponibile' };
    const unused = data.filter((f) => f.id && !used.has(`${uid}/${f.name}`));
    const age = (f: (typeof data)[number]) => (f.created_at ? Date.now() - new Date(f.created_at).getTime() : 0); // unknown date: not old
    const old = unused.filter((f) => age(f) > minAgeMs);
    if (old.length) {
      const { error: e } = await supabase.storage.from(BUCKET).remove(old.map((f) => `${uid}/${f.name}`));
      if (e) return { removed: 0, recent: unused.length - old.length, error: e.message };
    }
    return { removed: old.length, recent: unused.length - old.length };
  } catch (e) {
    return { removed: 0, recent: 0, error: e instanceof Error ? e.message : String(e) };
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
