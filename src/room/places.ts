import type { Project, Room } from './types';

// Places: every room can belong to a place (a house, a site). A project only uses rooms of one place. Rooms without a place
// (saved before places existed) are not checked until they are given one.

export const normPlace = (s: string | undefined | null) => (s ?? '').trim().toLowerCase();
export const samePlace = (a: string | undefined, b: string | undefined) => !!normPlace(a) && normPlace(a) === normPlace(b);

// The places of these rooms, without repeats (first spelling wins), most recently used first.
export function knownPlaces(rooms: Room[]): string[] {
  const seen = new Map<string, string>();
  for (const r of [...rooms].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const k = normPlace(r.place);
    if (k && !seen.has(k)) seen.set(k, r.place!.trim());
  }
  return [...seen.values()];
}

// The place of a project: the one its rooms share (undefined when none of them has one, or when they disagree).
export function placeOfRooms(rooms: Room[]): string | undefined {
  const names = knownPlaces(rooms);
  return names.length === 1 ? names[0] : undefined;
}

// Can `room` join a project that already uses `members`? '' = yes, otherwise why not.
export function addRoomError(members: Room[], room: Room): string {
  const place = placeOfRooms(members);
  if (!place || !normPlace(room.place)) return place && !normPlace(room.place) ? `"${room.name}" non ha un luogo: assegnale "${place}" da "Le mie stanze".` : '';
  return samePlace(place, room.place) ? '' : `"${room.name}" è nel luogo "${room.place}", questo progetto usa il luogo "${place}": un progetto usa stanze di un solo luogo.`;
}

// Would giving `roomId` this place leave a project with rooms of two places? The name of the first such project, or ''.
export function placeChangeConflict(roomId: string, place: string | null, rooms: Room[], projects: Project[]): string {
  if (!normPlace(place)) return '';
  for (const p of projects) {
    if (!p.roomIds.includes(roomId)) continue;
    const others = p.roomIds.filter((id) => id !== roomId).map((id) => rooms.find((r) => r.id === id)).filter((r): r is Room => !!r);
    if (others.some((o) => normPlace(o.place) && !samePlace(o.place, place ?? undefined))) return p.name;
  }
  return '';
}

// Rooms that can be chosen together: after one with a place is chosen, only rooms of that place (or without one) remain.
export function compatibleRooms(chosen: Room[], all: Room[]): Room[] {
  const place = placeOfRooms(chosen);
  return place ? all.filter((r) => !normPlace(r.place) || samePlace(r.place, place)) : all;
}
