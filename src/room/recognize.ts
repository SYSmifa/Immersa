import { alignPlanes, type Alignment } from './align';
import type { Room, RoomPlane } from './types';

const MAX_RESID = 0.05; // m: accept only below this mean plane error
const MIN_MATCH = 0.7; // fraction of the saved planes that must be found again

export interface Recognised {
  room: Room;
  alignment: Alignment; // maps the saved room's frame onto the live session frame
}

// Which saved room (if any) is the live scan? Best fit among the rooms that pass both thresholds.
export function recognizeRoom(live: RoomPlane[], rooms: Room[]): Recognised | null {
  let best: Recognised | null = null;
  let bestScore = -Infinity;
  for (const room of rooms) {
    const a = alignPlanes(room.scan.planes, live);
    if (!a || a.resid >= MAX_RESID || a.matched < MIN_MATCH * a.total) continue;
    const score = a.matched / a.total - a.resid; // more planes found first, then tighter fit
    if (score > bestScore) {
      bestScore = score;
      best = { room, alignment: a };
    }
  }
  return best;
}
