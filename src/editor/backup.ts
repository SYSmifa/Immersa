// Backup and export of projects: ONE file, a zip with the extension ".immersa" (so that it opens with any zip tool):
//   immersa.json   rooms (scans, links) and projects (models, walls, notes), plus which model file is which
//   models/<n>.glb the models the projects use (the cloud's GLBs, as they are)
// Importing creates copies (new ids, names made unique): nothing already in the account is touched.
import { strFromU8, strToU8, unzipSync, zipSync } from 'three/addons/libs/fflate.module.js';
import type { Annotation, Project, Room, RoomModel, RoomScan, Structure } from '../room/types';

export const BACKUP_EXT = '.immersa';
const FORMAT = 'immersa-backup';
const VERSION = 1;

export interface BackupProject {
  name: string;
  roomIds: string[];
  models: RoomModel[];
  structures: Structure[];
  annotations: Annotation[];
  tone?: number;
}
export interface BackupRoom {
  id: string;
  name: string;
  place?: string;
  scan: RoomScan;
}
export interface BackupFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  rooms: BackupRoom[];
  projects: (BackupProject & { id: string })[];
  files: Record<string, string>; // model path in the cloud → entry in the zip
}

const isCloudPath = (p: string) => !p.startsWith('local:') && !p.startsWith('pending:');

// What goes into the file: the given projects and the rooms they use (or `rooms`, for a full backup). Links to rooms that are not
// in the file are dropped (they would point nowhere).
export function selectForBackup(rooms: Room[], projects: Project[], only?: Project): { rooms: BackupRoom[]; projects: (BackupProject & { id: string })[] } {
  const chosen = only ? [only] : projects;
  const wanted = new Set(only ? only.roomIds : rooms.map((r) => r.id));
  for (const p of chosen) for (const m of p.models) if (m.roomId) wanted.add(m.roomId);
  const inFile = rooms.filter((r) => wanted.has(r.id));
  const ids = new Set(inFile.map((r) => r.id));
  return {
    rooms: inFile.map((r) => {
      const links = Object.fromEntries(Object.entries(r.scan.links ?? {}).filter(([k]) => ids.has(k)));
      const scan: RoomScan = { ...r.scan, links: Object.keys(links).length ? links : undefined };
      if (!scan.links) delete scan.links;
      return { id: r.id, name: r.name, place: r.place, scan };
    }),
    projects: chosen.map((p) => ({ id: p.id, name: p.name, roomIds: p.roomIds.filter((x) => ids.has(x)), models: p.models, structures: p.structures, annotations: p.annotations, tone: p.tone })),
  };
}

// Builds the zip. `getModel` returns a model file's bytes (null = could not be read: its name is returned in `missing`).
export async function buildBackup(sel: ReturnType<typeof selectForBackup>, getModel: (path: string) => Promise<Uint8Array | null>, progress?: (done: number, total: number) => void): Promise<{ bytes: Uint8Array; missing: string[] }> {
  const paths = [...new Set(sel.projects.flatMap((p) => p.models.map((m) => m.path)).filter(isCloudPath))];
  const files: Record<string, string> = {};
  const entries: Record<string, Uint8Array> = {};
  const missing: string[] = [];
  let i = 0;
  for (const path of paths) {
    progress?.(i++, paths.length);
    const bytes = await getModel(path).catch(() => null);
    if (!bytes) {
      missing.push(path);
      continue;
    }
    const entry = `models/${Object.keys(files).length + 1}.glb`;
    files[path] = entry;
    entries[entry] = bytes;
  }
  const meta: BackupFile = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), rooms: sel.rooms, projects: sel.projects, files };
  entries['immersa.json'] = strToU8(JSON.stringify(meta));
  // GLBs are already compressed: stored as they are (level 0), the json is small
  return { bytes: zipSync(entries, { level: 0 }), missing };
}

export function parseBackup(bytes: Uint8Array): { backup: BackupFile; files: Record<string, Uint8Array> } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('Il file non è un backup di Immersa (non si apre come archivio).');
  }
  const raw = entries['immersa.json'];
  if (!raw) throw new Error('Il file non è un backup di Immersa (manca immersa.json).');
  const backup = JSON.parse(strFromU8(raw)) as BackupFile;
  if (backup.format !== FORMAT) throw new Error('Il file non è un backup di Immersa.');
  if (backup.version > VERSION) throw new Error('Il backup è stato fatto da una versione più nuova dell\'app: aggiorna la pagina e riprova.');
  if (!Array.isArray(backup.rooms) || !Array.isArray(backup.projects)) throw new Error('Il backup è danneggiato.');
  return { backup, files: entries };
}

// "name", or "name (2)", ... the first one not in `taken` (caps and edge spaces ignored, like the app's own names).
export function uniqueName(name: string, taken: Iterable<string>): string {
  const norm = (v: string) => v.trim().toLowerCase();
  const set = new Set([...taken].map(norm));
  if (!set.has(norm(name))) return name;
  for (let i = 2; ; i++) if (!set.has(norm(`${name} (${i})`))) return `${name} (${i})`;
}

// A room's scan for the new copy: its links are re-addressed to the new room ids (a link to a room that was not imported goes).
export function remapScan(scan: RoomScan, idMap: Map<string, string>): RoomScan {
  const out: RoomScan = { ...scan };
  if (scan.links) {
    const links = Object.fromEntries(Object.entries(scan.links).flatMap(([k, l]) => (idMap.has(k) ? [[idMap.get(k)!, l]] : [])));
    if (Object.keys(links).length) out.links = links;
    else delete out.links;
  }
  return out;
}

// A project's content for the new copy: rooms re-addressed, model files re-addressed (`pathMap`: old path → new path).
export function remapProject(p: BackupProject, idMap: Map<string, string>, pathMap: Map<string, string>): BackupProject {
  const room = (id: string) => (id === '' ? '' : (idMap.get(id) ?? ''));
  return {
    name: p.name,
    tone: p.tone,
    roomIds: p.roomIds.flatMap((id) => (idMap.has(id) ? [idMap.get(id)!] : [])),
    models: p.models.map((m) => ({ ...m, roomId: room(m.roomId), path: pathMap.get(m.path) ?? m.path })),
    structures: p.structures.map((s) => ({ ...s, roomId: room(s.roomId) })),
    annotations: p.annotations.map((a) => ({ ...a, roomId: room(a.roomId) })),
  };
}
