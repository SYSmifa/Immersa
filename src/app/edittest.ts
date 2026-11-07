import { createEditorPage } from '../editor/editor';
import { createFakeBackend } from './fakeBackend';

/* eslint-disable @typescript-eslint/no-explicit-any */
// ?edittest: the PC editor with the in-memory backend and a fake upload (no Supabase needed).
export function runEditTest() {
  const backend = createFakeBackend(new URLSearchParams(location.search).has('loggedout')); // ?loggedout: the login card
  (window as any).__backend = backend;
  let files = [
    { path: 'u/aaaa.glb', size: 3_400_000, createdAt: new Date().toISOString() },
    { path: 'u/bbbb.glb', size: 120_000, createdAt: new Date().toISOString() },
  ];
  const library = { list: async () => files, remove: async (paths: string[]) => void (files = files.filter((f) => !paths.includes(f.path))) };
  const editor = createEditorPage(backend, async (file) => ({ path: 'local:smoke.glb', name: file.name }), library);
  void editor.then((e) => ((window as any).__editor = e));
  return editor;
}
