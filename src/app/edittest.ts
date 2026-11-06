import { createEditorPage } from '../editor/editor';
import { createFakeBackend } from './fakeBackend';

/* eslint-disable @typescript-eslint/no-explicit-any */
// ?edittest: the PC editor with the in-memory backend and a fake upload (no Supabase needed).
export function runEditTest() {
  const backend = createFakeBackend();
  (window as any).__backend = backend;
  const editor = createEditorPage(backend, async (file) => ({ path: 'local:smoke.glb', name: file.name }));
  void editor.then((e) => ((window as any).__editor = e));
  return editor;
}
