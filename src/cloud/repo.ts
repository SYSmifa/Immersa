import type { Project, Room, RoomModel, RoomScan } from '../room/types';
import type { Backend } from './backend';
import { currentUserEmail, supabase } from './supabase';

interface RoomRow {
  id: string;
  name: string;
  data: RoomScan;
  updated_at: string;
}
interface ProjectRow {
  id: string;
  room_id: string | null; // the first room (kept for the foreign key)
  room_ids: string[] | null;
  name: string;
  models: RoomModel[];
  updated_at: string;
}

const ROOM_COLS = 'id,name,data,updated_at';
const PROJECT_COLS = 'id,room_id,room_ids,name,models,updated_at';

const toRoom = (r: RoomRow): Room => ({ id: r.id, name: r.name, updatedAt: r.updated_at, scan: r.data });
const toProject = (r: ProjectRow): Project => {
  const roomIds = r.room_ids?.length ? r.room_ids : r.room_id ? [r.room_id] : [];
  return {
    id: r.id,
    name: r.name,
    updatedAt: r.updated_at,
    roomIds,
    // Projects saved before multi-room had no roomId on their models.
    models: (r.models ?? []).map((m) => ({ ...m, roomId: m.roomId ?? roomIds[0] ?? '' })),
  };
};

function client() {
  if (!supabase) throw new Error('Supabase non configurato (.env.local)');
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const now = () => new Date().toISOString();

export function createSupabaseBackend(): Backend {
  return {
    email: currentUserEmail,
    async signOut() {
      await supabase?.auth.signOut();
    },
    async listRooms() {
      const { data, error } = await client().from('rooms').select(ROOM_COLS).order('updated_at', { ascending: false });
      check(error);
      return (data as RoomRow[]).map(toRoom);
    },
    async createRoom(name, scan) {
      const { data, error } = await client().from('rooms').insert({ name, data: scan }).select(ROOM_COLS).single();
      check(error);
      return toRoom(data as RoomRow);
    },
    async renameRoom(id, name) {
      const { error } = await client().from('rooms').update({ name, updated_at: now() }).eq('id', id);
      check(error);
    },
    async updateRoomScan(id, scan, previous) {
      const { error } = await client().from('rooms').update({ data: scan, previous_data: previous, updated_at: now() }).eq('id', id);
      check(error);
    },
    async deleteRoom(id) {
      const { error } = await client().from('rooms').delete().eq('id', id);
      check(error);
    },
    async listProjects() {
      const { data, error } = await client().from('projects').select(PROJECT_COLS).order('updated_at', { ascending: false });
      check(error);
      return (data as ProjectRow[]).map(toProject);
    },
    async createProject(name, roomIds, models) {
      const { data, error } = await client()
        .from('projects')
        .insert({ name, room_id: roomIds[0] ?? null, room_ids: roomIds, models })
        .select(PROJECT_COLS)
        .single();
      check(error);
      return toProject(data as ProjectRow);
    },
    async saveProject(id, patch) {
      const row: Record<string, unknown> = { updated_at: now() };
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.models !== undefined) row.models = patch.models;
      if (patch.roomIds !== undefined) {
        row.room_ids = patch.roomIds;
        row.room_id = patch.roomIds[0] ?? null;
      }
      const { error } = await client().from('projects').update(row).eq('id', id);
      check(error);
    },
    async deleteProject(id) {
      const { error } = await client().from('projects').delete().eq('id', id);
      check(error);
    },
  };
}
