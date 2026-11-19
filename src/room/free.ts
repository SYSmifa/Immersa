import { floorHeight } from './anchors';
import type { Project, Room } from './types';

// Models and structures whose room is gone (deleted, or taken out of the project) would be invisible everywhere.
// They go to the project's free space (roomId ''), where both the editor and the headset show them. Returns how many moved.
// The free space has its floor at height 0, while the old room's floor was wherever the headset's session put it (often about -1 m):
// what moves is lowered by that floor, so that it stays on the floor. A room that still exists (only taken out of the project) tells
// its floor height; one that was deleted does not, so the lowest model of the room is taken as standing on the floor.
export function adoptOrphans(p: Project, rooms: Room[]): number {
  const alive = new Set(p.roomIds.filter((id) => rooms.some((r) => r.id === id)));
  const orphan = (id: string) => !!id && !alive.has(id);
  const drop = new Map<string, number>(); // old room id → how much to lower what comes from it
  for (const id of new Set([...p.models.map((m) => m.roomId), ...(p.structures ?? []).map((s) => s.roomId)])) {
    if (!orphan(id)) continue;
    const old = rooms.find((r) => r.id === id);
    const floor = old ? floorHeight(old.scan.planes) : Math.min(...p.models.filter((m) => m.roomId === id).map((m) => m.pos[1]), ...(p.structures ?? []).filter((s) => s.roomId === id).map((s) => s.y));
    drop.set(id, Number.isFinite(floor) && Math.abs(floor) > 0.02 ? floor : 0);
  }
  let n = 0;
  for (const m of p.models) {
    if (!orphan(m.roomId)) continue;
    m.pos = [m.pos[0], m.pos[1] - (drop.get(m.roomId) ?? 0), m.pos[2]];
    m.roomId = '';
    n++;
  }
  for (const s of p.structures ?? []) {
    if (!orphan(s.roomId)) continue;
    s.y -= drop.get(s.roomId) ?? 0;
    s.roomId = '';
    n++;
  }
  return n;
}
