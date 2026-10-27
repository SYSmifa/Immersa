import { supabase } from '../cloud/supabase';
import type { RoomFile } from './types';

const KEY = 'immersa.room';

export type StorageKind = 'cloud' | 'local';

// Rooms saved by older versions lack some fields.
function normalise(room: RoomFile | null | undefined): RoomFile | null {
  if (!room) return null;
  room.items ??= [];
  room.models ??= [];
  return room;
}

function readLocal(): RoomFile | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? normalise(JSON.parse(s) as RoomFile) : null;
  } catch {
    return null;
  }
}

function writeLocal(room: RoomFile | null) {
  try {
    if (room) localStorage.setItem(KEY, JSON.stringify(room));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

async function signedIn(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

// One room per user for now. In Supabase when signed in, else in localStorage.
let rowId: string | null = null;
let queue: Promise<unknown> = Promise.resolve(); // serialise saves so we never insert twice

export async function loadRoom(): Promise<{ room: RoomFile | null; kind: StorageKind }> {
  if (supabase && (await signedIn())) {
    const { data, error } = await supabase
      .from('rooms')
      .select('id,data')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    rowId = data?.id ?? null;
    // A room saved locally before the first login is picked up and pushed on the next save.
    return { room: normalise(data?.data as RoomFile | undefined) ?? readLocal(), kind: 'cloud' };
  }
  return { room: readLocal(), kind: 'local' };
}

export function saveRoom(room: RoomFile): Promise<StorageKind> {
  const run = async (): Promise<StorageKind> => {
    if (!supabase || !(await signedIn())) {
      writeLocal(room);
      return 'local';
    }
    const now = new Date().toISOString();
    if (rowId) {
      const { error } = await supabase.from('rooms').update({ data: room, updated_at: now }).eq('id', rowId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase.from('rooms').insert({ data: room }).select('id').single();
      if (error) throw new Error(error.message);
      rowId = data.id;
    }
    return 'cloud';
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

export async function deleteRoom(): Promise<void> {
  writeLocal(null);
  if (supabase && (await signedIn())) {
    const { error } = await supabase.from('rooms').delete().not('id', 'is', null);
    if (error) throw new Error(error.message);
  }
  rowId = null;
}
