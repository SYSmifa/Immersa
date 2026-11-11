import { Quaternion, Vector3 } from 'three';
import type { Alignment } from './align';
import { floorCentre } from './floor';
import { samePlace } from './places';
import type { Room, RoomLink, RoomModel, Vec3 } from './types';

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

// How far apart two poses are: metres of translation and radians of turn.
export const poseDistance = (a: Pose, b: Pose) => ({ m: Math.hypot(a.tx - b.tx, a.ty - b.ty, a.tz - b.tz), rad: Math.abs(wrap(a.yaw - b.yaw)) });

const AGREE_M = 0.05; // two measures of one link agree when closer than this ...
const AGREE_RAD = 0.0175; // ... and than 1 degree
const agree = (a: Pose, b: Pose) => {
  const d = poseDistance(a, b);
  return d.m < AGREE_M && d.rad < AGREE_RAD;
};

export type LinkState = 'manual' | 'confirmed' | 'tentative';
export const linkState = (l: RoomLink): LinkState => (l.src === 'manual' ? 'manual' : (l.n ?? 1) >= 2 ? 'confirmed' : 'tentative');
// Only a link measured by hand, or seen again by a second session, is trusted to put a room somewhere.
export const isConfirmed = (l: RoomLink) => linkState(l) !== 'tentative';

// The same link seen from the other room (its candidate too).
export function invertLink(l: RoomLink): RoomLink {
  const inv = (p: Pose): Pose => invert(p);
  return { ...l, ...inv(l), cand: l.cand && { ...l.cand, ...inv(l.cand) } };
}

// What room `from` knows about `to`: the link with `to` placed in `from`'s frame, from its own links or from the other room's (inverted).
export function linkBetween(from: Room, to: Room): { pose: Pose; src: RoomLink['src']; link: RoomLink } | null {
  const own = from.scan.links?.[to.id];
  if (own) return { pose: own, src: own.src, link: own };
  const back = to.scan.links?.[from.id];
  if (!back) return null;
  const link = invertLink(back);
  return { pose: link, src: link.src, link };
}

// Two rooms can only be linked when they belong to the same place, and they cannot be 100 m or more apart (a link from a
// placement of the headset that puts them farther is a mistake: the headset also reports rooms of other places).
export function linkable(a: Room, b: Room, pose: Pose): boolean {
  if (a.id === b.id || !samePlace(a.place, b.place)) return false;
  const ca = floorCentre(a.scan.planes);
  const cb = apply(pose, floorCentre(b.scan.planes));
  return Math.hypot(ca[0] - cb[0], ca[2] - cb[2]) < 100;
}

export interface Learned {
  links: [RoomLink, RoomLink] | null; // [a.links[b], b.links[a]] to write; null = nothing to write
  note: string; // for the event log
}

// What to do with a new measure of where room `b` is in `a`'s frame (both were placed in one session: `pa`, `pb`).
// - first measure from the headset: kept, but only as a guess (n = 1);
// - the same again in another session: confirmed (n = 2);
// - a different one: against a confirmed link it is thrown away; against a guess it is kept aside as a candidate, and the
//   candidate wins when a later session agrees with it;
// - by hand, or with both rooms scanned in this very session (`together`, no restart between): trusted at once. A hand
//   measure replaces anything; the headset's never replaces one made by hand.
// null: nothing to say or write.
export function learnedLinks(a: Room, b: Room, pa: Pose, pb: Pose, src: RoomLink['src'], sess: string, together = false): Learned | null {
  const bInA = relative(pa, pb);
  if (!linkable(a, b, bInA)) return null;
  const old = linkBetween(a, b)?.link;
  const now = Date.now();
  const trusted = src === 'manual' || together;
  const fresh: RoomLink = { ...bInA, at: now, src, n: trusted ? 2 : 1, sess };
  const pair = (l: RoomLink): [RoomLink, RoomLink] => [l, invertLink(l)];
  if (!old) return { links: pair(fresh), note: trusted ? (src === 'manual' ? 'a mano' : 'scansionate insieme: confermata') : 'misura provvisoria: serve una seconda sessione' };
  const same = agree(old, bInA);
  if (trusted) {
    if (src !== 'manual' && old.src === 'manual') return null; // the headset's measure never replaces a hand one
    if (same && isConfirmed(old)) return null; // nothing changes
    return { links: pair(fresh), note: src === 'manual' ? 'a mano: sostituisce la misura precedente' : 'scansionate insieme: confermata' };
  }
  if (old.src === 'manual') return null;
  if (same) {
    if (old.sess === sess || isConfirmed(old)) return null; // nothing new
    return { links: pair({ ...old, n: (old.n ?? 1) + 1, sess, at: now, cand: undefined }), note: 'confermata da una seconda sessione' };
  }
  if (isConfirmed(old)) {
    const d = poseDistance(old, bInA);
    return { links: null, note: `misura scartata: differisce di ${d.m.toFixed(2)} m dalla posizione confermata` };
  }
  // a guess against a different measure
  const cand = old.cand;
  if (cand && agree(cand, bInA)) {
    if (cand.sess === sess) return null;
    return { links: pair({ ...fresh, n: cand.n + 1 }), note: 'confermata: la prima misura era diversa e non si è ripetuta' };
  }
  if (cand?.sess === sess) return null;
  return { links: pair({ ...old, cand: { ...bInA, at: now, n: 1, sess } }), note: 'seconda misura diversa dalla prima: ne serve un\'altra' };
}

// Places the rooms that have no placement of their own, through CONFIRMED links from the rooms that have one (`placed`), hopping
// from room to room. Returns only the new placements.
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
        if (!base || !link || !samePlace(base.place, target.place) || !isConfirmed(link.link)) continue;
        const alignment = compose(pose, link.pose); // target -> base -> session
        known.set(target.id, alignment);
        out.set(target.id, { ...alignment, resid: 0, matched: 0, total: 0 });
        grew = true;
        break;
      }
    }
    if (!grew) break;
  }
  return out;
}

// For the lists: how a room stands with the other rooms of its place ("Cucina ✓", "Sala (da confermare)").
export function linkSummary(room: Room, rooms: Room[]): { name: string; state: LinkState }[] {
  const out: { name: string; state: LinkState }[] = [];
  for (const other of rooms) {
    if (other.id === room.id || !samePlace(other.place, room.place)) continue;
    const l = linkBetween(room, other)?.link;
    if (l) out.push({ name: other.name, state: linkState(l) });
  }
  return out;
}

export interface Placement {
  pose: Pose; // where the room's frame is, in the frame of the room we look from
  state: LinkState | 'unknown'; // how sure the position is: the weakest link on the way ('unknown': no link, put aside)
}

const RANK: Record<LinkState, number> = { tentative: 0, confirmed: 1, manual: 2 };

// Where every other room of the project is, seen from `current` (the room being edited): through the links, hopping from room to
// room, whatever their state (the editor shows a guess too, marked as such, so that a wrong one is seen). A room with no link at
// all is put aside, on the floor level of `current` and to the east of it, one after the other, with state 'unknown'.
export function placeAround(current: Room, members: Room[]): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const byId = new Map(members.map((r) => [r.id, r]));
  byId.set(current.id, current);
  const known = new Map<string, { pose: Pose; rank: number }>([[current.id, { pose: IDENTITY, rank: RANK.manual }]]);
  for (let pass = 0; pass < members.length; pass++) {
    let grew = false;
    for (const target of members) {
      if (known.has(target.id)) continue;
      let best: { pose: Pose; rank: number } | null = null;
      for (const [id, k] of known) {
        const base = byId.get(id);
        const link = base && linkBetween(base, target);
        if (!base || !link || !samePlace(base.place, target.place)) continue;
        const rank = Math.min(k.rank, RANK[linkState(link.link)]);
        if (!best || rank > best.rank) best = { pose: compose(k.pose, link.pose), rank };
      }
      if (best) {
        known.set(target.id, best);
        grew = true;
      }
    }
    if (!grew) break;
  }
  const states: LinkState[] = ['tentative', 'confirmed', 'manual'];
  for (const [id, k] of known) if (id !== current.id) out.set(id, { pose: k.pose, state: states[k.rank] });
  // the rest: aside
  const floorOf = (r: Room) => floorCentre(r.scan.planes);
  const cur = floorOf(current);
  let east = Math.max(...current.scan.planes.flatMap((p) => (p.poly ?? []).length >= 6 ? [p.pos[0] + 3] : [p.pos[0]]), cur[0]) + 4;
  for (const r of members) {
    if (r.id === current.id || known.has(r.id)) continue;
    const c = floorOf(r);
    const xs = r.scan.planes.map((p) => p.pos[0]);
    const width = xs.length ? Math.max(...xs) - Math.min(...xs) + 2 : 4;
    out.set(r.id, { pose: { yaw: 0, tx: east + width / 2 - c[0], ty: cur[1] - c[1], tz: cur[2] - c[2] }, state: 'unknown' });
    east += width + 3;
  }
  return out;
}

// Is this point (in the room's own frame) inside the room? Its floor outline, a little widened (0.15 m: a wall's thickness), and
// between the floor and the ceiling; rooms scanned without an outline are judged by the box around their planes.
export function roomContains(room: Room, p: Vec3, margin = 0.15): boolean {
  const planes = room.scan.planes;
  const floors = planes.filter((q) => q.label === 'floor' && q.quat && (q.poly?.length ?? 0) >= 6);
  const floorY = planes.filter((q) => q.label === 'floor').reduce((a, q, _, all) => a + q.pos[1] / all.length, 0);
  const ceil = planes.find((q) => q.label === 'ceiling');
  const top = ceil ? ceil.pos[1] : floorY + 3.5;
  if (p[1] < floorY - 0.6 || p[1] > top + 0.3) return false;
  if (!floors.length) {
    const xs = planes.map((q) => q.pos[0]);
    const zs = planes.map((q) => q.pos[2]);
    return xs.length > 0 && p[0] >= Math.min(...xs) - 0.5 && p[0] <= Math.max(...xs) + 0.5 && p[2] >= Math.min(...zs) - 0.5 && p[2] <= Math.max(...zs) + 0.5;
  }
  for (const f of floors) {
    const q = new Quaternion(...f.quat!);
    const pts: [number, number][] = [];
    for (let i = 0; i < f.poly!.length; i += 2) {
      const v = new Vector3(f.poly![i], 0, f.poly![i + 1]).applyQuaternion(q).add(new Vector3(...f.pos));
      pts.push([v.x, v.z]);
    }
    let inside = false;
    let near = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i];
      const [xj, zj] = pts[j];
      if (zi > p[2] !== zj > p[2] && p[0] < ((xj - xi) * (p[2] - zi)) / (zj - zi) + xi) inside = !inside;
      const dx = xj - xi;
      const dz = zj - zi;
      const t = Math.max(0, Math.min(1, ((p[0] - xi) * dx + (p[2] - zi) * dz) / (dx * dx + dz * dz || 1)));
      near = Math.min(near, Math.hypot(p[0] - (xi + t * dx), p[2] - (zi + t * dz)));
    }
    if (inside || near <= margin) return true;
  }
  return false;
}

export interface ModelMove {
  model: RoomModel;
  to: Room;
  pos: Vec3; // its pivot in the new room's frame
  yaw: number;
}
export interface ModelStay {
  model: RoomModel;
  to: Room | null; // the room it lies in, when only one
  why: 'tentative' | 'ambiguous';
}

// Models of `current` (the room being edited) whose pivot is no longer inside it: where did they end up? Only a room whose link
// with `current` is sure (confirmed or by hand) takes a model over; a guess, or a pivot lying in two rooms at once (they overlap:
// a link is wrong), leaves it where it is and says so. A pivot in no room (a corridor, outdoors) leaves it silently.
// The new position and yaw are the same place seen from the new room's frame.
export function planModelMoves(current: Room, members: Room[], models: RoomModel[]): { moves: ModelMove[]; stay: ModelStay[] } {
  const around = placeAround(current, members);
  const moves: ModelMove[] = [];
  const stay: ModelStay[] = [];
  for (const m of models) {
    if (m.roomId !== current.id || roomContains(current, m.pos)) continue;
    const hits: { room: Room; place: Placement; pos: Vec3 }[] = [];
    for (const r of members) {
      const place = around.get(r.id);
      if (!place || place.state === 'unknown') continue; // put aside: its coordinates mean nothing
      const pos = apply(invert(place.pose), m.pos);
      if (roomContains(r, pos)) hits.push({ room: r, place, pos });
    }
    if (!hits.length) continue;
    if (hits.length > 1) {
      stay.push({ model: m, to: null, why: 'ambiguous' });
      continue;
    }
    const h = hits[0];
    if (h.place.state === 'tentative') {
      stay.push({ model: m, to: h.room, why: 'tentative' });
      continue;
    }
    moves.push({ model: m, to: h.room, pos: h.pos, yaw: m.yaw + h.place.pose.yaw });
  }
  return { moves, stay };
}
