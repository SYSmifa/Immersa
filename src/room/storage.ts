import type { RoomFile } from './types';

const KEY = 'immersa.room';

// Local stand-in for the future Supabase storage.
export function loadRoom(): RoomFile | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as RoomFile) : null;
  } catch {
    return null;
  }
}

export function saveRoom(room: RoomFile | null) {
  try {
    if (room) localStorage.setItem(KEY, JSON.stringify(room));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
