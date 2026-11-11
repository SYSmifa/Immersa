using System;
using System.Collections.Generic;
using System.Linq;

namespace Immersa.Core
{
    // Port of src/room/places.ts. Every room can belong to a place (a house, a site). A project only uses rooms of one place.
    // Rooms without a place (saved before places existed) are not checked until they are given one.
    // The messages are in Italian on purpose: they are shown to the user and must read like the web app's.
    public static class Places
    {
        public static string Norm(string s) => (s ?? "").Trim().ToLowerInvariant();

        public static bool Same(string a, string b) => Norm(a).Length > 0 && Norm(a) == Norm(b);

        // The places of these rooms, without repeats (first spelling wins), most recently used first.
        public static List<string> Known(IEnumerable<Room> rooms)
        {
            var seen = new Dictionary<string, string>();
            var order = new List<string>();
            foreach (var r in rooms.OrderByDescending(x => x.UpdatedAt, StringComparer.Ordinal))
            {
                var k = Norm(r.Place);
                if (k.Length > 0 && !seen.ContainsKey(k)) { seen[k] = r.Place.Trim(); order.Add(k); }
            }
            return order.Select(k => seen[k]).ToList();
        }

        // The place of a project: the one its rooms share (null when none of them has one, or when they disagree).
        public static string OfRooms(IEnumerable<Room> rooms)
        {
            var names = Known(rooms);
            return names.Count == 1 ? names[0] : null;
        }

        // Can `room` join a project that already uses `members`? "" = yes, otherwise why not.
        public static string AddRoomError(IReadOnlyList<Room> members, Room room)
        {
            var place = OfRooms(members);
            if (place == null || Norm(room.Place).Length == 0)
                return place != null && Norm(room.Place).Length == 0
                    ? "\"" + room.Name + "\" non ha un luogo: assegnale \"" + place + "\" da \"Le mie stanze\"."
                    : "";
            return Same(place, room.Place)
                ? ""
                : "\"" + room.Name + "\" è nel luogo \"" + room.Place + "\", questo progetto usa il luogo \"" + place + "\": un progetto usa stanze di un solo luogo.";
        }

        // Would giving `roomId` this place leave a project with rooms of two places? The name of the first such project, or "".
        public static string PlaceChangeConflict(string roomId, string place, IReadOnlyList<Room> rooms, IReadOnlyList<Project> projects)
        {
            if (Norm(place).Length == 0) return "";
            foreach (var p in projects)
            {
                if (!p.RoomIds.Contains(roomId)) continue;
                var others = p.RoomIds.Where(id => id != roomId).Select(id => rooms.FirstOrDefault(r => r.Id == id)).Where(r => r != null);
                if (others.Any(o => Norm(o.Place).Length > 0 && !Same(o.Place, place))) return p.Name;
            }
            return "";
        }

        // Rooms that can be chosen together: after one with a place is chosen, only rooms of that place (or without one) remain.
        public static List<Room> Compatible(IEnumerable<Room> chosen, IEnumerable<Room> all)
        {
            var place = OfRooms(chosen);
            return place != null ? all.Where(r => Norm(r.Place).Length == 0 || Same(r.Place, place)).ToList() : all.ToList();
        }
    }
}
