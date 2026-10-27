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
  room_id: string;
  name: string;
  models: RoomModel[];
  updated_at: string;
}

const ROOM_COLS = 'id,name,data,updated_at';
const PROJECT_COLS = 'id,room_id,name,models,updated_at';

const toRoom = (r: RoomRow): Room => ({ id: r.id, name: r.name, updatedAt: r.updated_at, scan: r.data });
const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  roomId: r.room_id,
  name: r.name,
  updatedAt: r.updated_at,
  models: r.models ?? [],
});

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
    async listProjects(roomId) {
      const { data, error } = await client()
        .from('projects')
        .select(PROJECT_COLS)
        .eq('room_id', roomId)
        .order('updated_at', { ascending: false });
      check(error);
      return (data as ProjectRow[]).map(toProject);
    },
    async createProject(roomId, name, models) {
      const { data, error } = await client()
        .from('projects')
        .insert({ room_id: roomId, name, models })
        .select(PROJECT_COLS)
        .single();
      check(error);
      return toProject(data as ProjectRow);
    },
    async saveProject(id, patch) {
      const { error } = await client().from('projects').update({ ...patch, updated_at: now() }).eq('id', id);
      check(error);
    },
    async deleteProject(id) {
      const { error } = await client().from('projects').delete().eq('id', id);
      check(error);
    },
  };
}
