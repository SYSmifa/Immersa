import { Box3, Quaternion, Vector3 } from 'three';
import { alignPlanes, type Alignment } from './align';
import type { Room, RoomPlane, Vec3 } from './types';

const MAX_RESID = 0.05; // m: accept only below this mean plane error
const MIN_MATCH = 0.7; // fraction of the saved planes that must be found again

// A fit good enough to trust: tight error and most of the saved planes found again.
export const isGoodFit = (a: Alignment | null): a is Alignment => !!a && a.resid < MAX_RESID && a.matched >= MIN_MATCH * a.total;

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
    if (!isGoodFit(a)) continue;
    const score = a.matched / a.total - a.resid; // more planes found first, then tighter fit
    if (score > bestScore) {
      bestScore = score;
      best = { room, alignment: a };
    }
  }
  return best;
}

// The headset reports the planes of the room it has stored even when you are not in
// it, so a match alone does not prove you are there: also check that your head is inside.
const bounds = new WeakMap<Room, Box3>();
const MARGIN_XZ = 0.4; // m
const MARGIN_Y = 0.6;

function roomBounds(room: Room): Box3 {
  let box = bounds.get(room);
  if (!box) {
    box = new Box3();
    for (const p of room.scan.planes) {
      box.expandByPoint(new Vector3(...p.pos));
      if (!p.poly || !p.quat) continue;
      const q = new Quaternion(...p.quat);
      for (let i = 0; i < p.poly.length; i += 2) {
        box.expandByPoint(new Vector3(p.poly[i], 0, p.poly[i + 1]).applyQuaternion(q).add(new Vector3(...p.pos)));
      }
    }
    bounds.set(room, box);
  }
  return box;
}

// Is `head` (session frame) inside the room, given how the saved room maps onto the session?
export function isInside(r: Recognised, head: Vec3): boolean {
  const a = r.alignment;
  const dx = head[0] - a.tx;
  const dz = head[2] - a.tz;
  const c = Math.cos(a.yaw);
  const s = Math.sin(a.yaw);
  const x = c * dx + s * dz; // inverse of x' = c*x - s*z + tx, z' = s*x + c*z + tz
  const z = -s * dx + c * dz;
  const y = head[1] - a.ty;
  const b = roomBounds(r.room);
  return x >= b.min.x - MARGIN_XZ && x <= b.max.x + MARGIN_XZ && z >= b.min.z - MARGIN_XZ && z <= b.max.z + MARGIN_XZ && y >= b.min.y - MARGIN_Y && y <= b.max.y + MARGIN_Y;
}
