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

// Uploads a GLB into the user's own folder of the private "models" bucket.
export async function uploadModel(file: File): Promise<{ path: string; name: string }> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) throw new Error('not signed in');
  const safe = file.name.replace(/[^\w.-]+/g, '_');
  const path = `${uid}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: 'model/gltf-binary', upsert: false });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}
