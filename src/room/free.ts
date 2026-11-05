import type { Project, Room } from './types';

// Models and structures whose room is gone (deleted, or taken out of the project) would be invisible everywhere.
// They go to the project's free space (roomId ''), where both the editor and the headset show them. Returns how many moved.
export function adoptOrphans(p: Project, rooms: Room[]): number {
  const alive = new Set(p.roomIds.filter((id) => rooms.some((r) => r.id === id)));
  let n = 0;
  for (const m of p.models) {
    if (m.roomId && !alive.has(m.roomId)) {
      m.roomId = '';
      n++;
    }
  }
  for (const s of p.structures ?? []) {
    if (s.roomId && !alive.has(s.roomId)) {
      s.roomId = '';
      n++;
    }
  }
  return n;
}
