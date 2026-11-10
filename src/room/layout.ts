import type { Alignment } from './align';
import { floorCentre } from './floor';
import { samePlace } from './places';
import type { Room, RoomLink } from './types';

// Where the rooms of a place are in relation to each other. Each room's saved scan can carry `links`: where the other rooms
// are, in its own frame. With one room placed in the headset's session (by the headset itself or by touching two corners) the
// others of the project are placed through those links, without asking anything.
//
// A pose maps a point of one frame to another frame: x' = c x - s z + tx, y' = y + ty, z' = s x + c z + tz, c = cos(yaw),
// s = sin(yaw): the convention of Alignment (align.ts) and RoomLink (types.ts).

export interface Pose {
  yaw: number;
  tx: number;
  ty: number;
  tz: number;
}

export const IDENTITY: Pose = { yaw: 0, tx: 0, ty: 0, tz: 0 };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function apply(f: Pose, p: [number, number, number]): [number, number, number] {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  return [c * p[0] - s * p[2] + f.tx, p[1] + f.ty, s * p[0] + c * p[2] + f.tz];
}

// f after g: first g, then f.
export function compose(f: Pose, g: Pose): Pose {
  const [tx, ty, tz] = apply(f, [g.tx, g.ty, g.tz]);
  // the translation of the result is f(g(0)); apply() also added f's own offsets once, which is what we want
  return { yaw: wrap(f.yaw + g.yaw), tx, ty: ty, tz };
}

export function invert(f: Pose): Pose {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  return { yaw: wrap(-f.yaw), tx: -(c * f.tx + s * f.tz), ty: -f.ty, tz: s * f.tx - c * f.tz };
}

// Where room B is in room A's frame, given where each one was placed in the same session (B -> session -> A).
export const relative = (a: Pose, b: Pose): Pose => compose(invert(a), b);

const toLink = (p: Pose, src: RoomLink['src']): RoomLink => ({ yaw: p.yaw, tx: p.tx, ty: p.ty, tz: p.tz, at: Date.now(), src });

// How far apart two poses are: metres of translation and radians of turn.
export const poseDistance = (a: Pose, b: Pose) => ({ m: Math.hypot(a.tx - b.tx, a.ty - b.ty, a.tz - b.tz), rad: Math.abs(wrap(a.yaw - b.yaw)) });

// What room `from` knows about `to`: where `to` is in `from`'s frame, from its own links or from the other room's (inverted).
export function linkBetween(from: Room, to: Room): { pose: Pose; src: RoomLink['src'] } | null {
  const own = from.scan.links?.[to.id];
  if (own) return { pose: own, src: own.src };
  const back = to.scan.links?.[from.id];
  return back ? { pose: invert(back), src: back.src } : null;
}

// Two rooms can only be linked when they belong to the same place, and they cannot be 100 m or more apart (a link from a
// placement of the headset that puts them farther is a mistake: the headset also reports rooms of other places).
export function linkable(a: Room, b: Room, pose: Pose): boolean {
  if (a.id === b.id || !samePlace(a.place, b.place)) return false;
  const ca = floorCentre(a.scan.planes);
  const cb = apply(pose, floorCentre(b.scan.planes));
  return Math.hypot(ca[0] - cb[0], ca[2] - cb[2]) < 100;
}

// The links to write after the rooms `a` and `b` were both placed in a session (`pa`, `pb`): [a.links[b], b.links[a]], or null
// when they cannot be linked or an existing link of the headset's own ('meta') should not be replaced by a manual one, or
// when nothing changed by more than 3 cm / 0.5 degrees.
export function learnedLinks(a: Room, b: Room, pa: Pose, pb: Pose, src: RoomLink['src']): [RoomLink, RoomLink] | null {
  const bInA = relative(pa, pb);
  if (!linkable(a, b, bInA)) return null;
  const old = linkBetween(a, b);
  if (old) {
    if (old.src === 'meta' && src === 'manual') return null;
    const d = poseDistance(old.pose, bInA);
    if (d.m < 0.03 && d.rad < 0.0087) return null;
  }
  return [toLink(bInA, src), toLink(invert(bInA), src)];
}

// Places the rooms that have no placement of their own, through links from the rooms that have one (`placed`), hopping from
// room to room (nearest first). Returns only the new placements.
export function placeByLinks(rooms: Room[], placed: Map<string, Alignment>): Map<string, Alignment> {
  const out = new Map<string, Alignment>();
  const known = new Map<string, Pose>([...placed].map(([id, a]) => [id, a]));
  const byId = new Map(rooms.map((r) => [r.id, r]));
  for (let pass = 0; pass < rooms.length; pass++) {
    let grew = false;
    for (const target of rooms) {
      if (known.has(target.id)) continue;
      for (const [id, pose] of known) {
        const base = byId.get(id);
        const link = base && linkBetween(base, target); // where `target` is in the base room's frame
        if (!base || !link || !samePlace(base.place, target.place)) continue;
        const alignment = compose(pose, link.pose); // target -> base -> session
        const a: Alignment = { ...alignment, resid: 0, matched: 0, total: 0 };
        known.set(target.id, alignment);
        out.set(target.id, a);
        grew = true;
        break;
      }
    }
    if (!grew) break;
  }
  return out;
}
