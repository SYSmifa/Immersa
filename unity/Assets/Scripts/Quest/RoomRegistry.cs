using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Immersa.Cloud;
using Meta.XR.MRUtilityKit;
using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>
    /// The user's saved rooms and where each one is in the live world: every saved room is aligned once to the rooms the headset
    /// knows (<see cref="RoomAligner"/>), so projects can be opened without aligning again, and the app knows which saved room
    /// the user is in ("IN QUESTA STANZA").
    /// </summary>
    public class RoomRegistry
    {
        const string Tag = "[Rooms] ";

        public List<RoomInfo> Saved { get; private set; } = new List<RoomInfo>();
        public Dictionary<string, RoomPlacement> Placements { get; } = new Dictionary<string, RoomPlacement>();
        Transform root;

        public int LiveCount { get; private set; }

        /// <summary>Reads the saved rooms, waits for the headset's rooms, and aligns each saved room. Frames are rebuilt every time.</summary>
        public async Task Refresh(SupabaseClient client)
        {
            if (root != null) Object.Destroy(root.gameObject);
            root = new GameObject("SavedRooms").transform;
            Placements.Clear();

            var mruk = MRUK.Instance;
            float t0 = Time.realtimeSinceStartup;
            while (mruk != null && !mruk.IsInitialized && Time.realtimeSinceStartup - t0 < 15f) await Task.Delay(300);
            var live = mruk != null ? mruk.Rooms : new List<MRUKRoom>();
            LiveCount = live.Count;

            Saved = await client.ListRooms();
            foreach (var room in Saved)
            {
                var p = RoomAligner.Place(room, live, root);
                Placements[room.id] = p;
            }
            Debug.Log(Tag + Saved.Count + " saved room(s), " + live.Count + " live, " + Placements.Values.Count(p => p.found) + " recognized");
        }

        public RoomPlacement Get(string roomId) => roomId != null && Placements.TryGetValue(roomId, out var p) ? p : null;

        /// <summary>The saved room the user is standing in now (recognized and the head is inside its live room), or null.</summary>
        public RoomPlacement Current(Vector3 headPosition)
        {
            foreach (var p in Placements.Values)
                if (p.found && p.liveRoom != null && p.liveRoom.IsPositionInRoom(headPosition)) return p;
            return null;
        }
    }
}
