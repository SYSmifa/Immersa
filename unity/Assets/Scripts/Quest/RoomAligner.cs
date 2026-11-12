using System.Collections.Generic;
using Immersa.Cloud;
using Immersa.Core;
using Meta.XR.MRUtilityKit;
using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>The outcome of placing one saved room in the live world.</summary>
    public class RoomPlacement
    {
        public string roomId;
        public string name;
        public Alignment alignment;      // null when the room was not found
        public Transform frame;          // models of this room are children of it (in web axes through WebSpace); null when not found
        public MRUKRoom liveRoom;        // the room the headset reports now that this one was matched with
        public string status = "not found";
        public bool found;
    }

    /// <summary>
    /// Puts saved rooms where they really are: the saved planes (web file, or saved from Unity) are matched with the planes
    /// MRUK reports now (<see cref="PlaneAlign"/>, the web app's algorithm), and a frame object is created whose children use
    /// the web's coordinates of that room.
    ///
    /// Frame math: the alignment maps a saved point to the live one as x' = c x - s z + tx, y' = y + ty, z' = s x + c z + tz in
    /// web axes. The Unity world is the live web world with z negated, and a model child is placed with WebSpace.Position
    /// (x, y, -z). That is exactly a frame at (tx, ty, -tz) turned by +yaw about Y (derived and checked in the unit tests of
    /// PlaneAlign; confirm on the headset).
    /// </summary>
    public static class RoomAligner
    {
        const string Tag = "[Align] ";
        const double Good = 0.6;    // share of the saved structural planes that must be found for a sure match
        const double NearMatch = 0.35;

        public static RoomPlacement Place(RoomInfo saved, IReadOnlyList<MRUKRoom> liveRooms, Transform parent)
        {
            var res = new RoomPlacement { roomId = saved.id, name = saved.name };
            if (saved.scan == null || saved.scan.Planes == null || saved.scan.Planes.Count == 0) { res.status = "no scan data"; return res; }
            if (liveRooms == null || liveRooms.Count == 0) { res.status = "the headset knows no room"; return res; }

            Alignment best = null;
            double bestScore = double.NegativeInfinity;
            int bestIndex = -1;
            for (int i = 0; i < liveRooms.Count; i++)
            {
                var live = RoomScanExport.FromRoom(liveRooms[i]);
                var a = PlaneAlign.AlignPlanes(saved.scan.Planes, live.Planes);
                if (a == null) continue;
                double score = a.Matched - a.Resid * 5;
                Debug.Log(Tag + "'" + saved.name + "' vs live room " + (i + 1) + ": " + a.Matched + "/" + a.Total + " planes, resid " + (a.Resid * 100).ToString("0.0") + " cm, yaw " + (a.Yaw * Mathf.Rad2Deg).ToString("0.0") + " deg");
                if (score > bestScore) { bestScore = score; best = a; bestIndex = i; }
            }
            if (best == null || best.Total == 0) { res.status = "no plane in common"; return res; }

            double share = (double)best.Matched / best.Total;
            string detail = best.Matched + "/" + best.Total + " planes, " + (best.Resid * 100).ToString("0.0") + " cm";
            if (share < NearMatch) { res.status = "not found (" + detail + ")"; return res; }

            res.alignment = best;
            res.liveRoom = liveRooms[bestIndex];
            res.found = true;
            res.status = (share >= Good ? "aligned" : "aligned, weak") + " with room " + (bestIndex + 1) + " (" + detail + ")";

            var go = new GameObject("RoomFrame-" + saved.name);
            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3((float)best.Tx, (float)best.Ty, -(float)best.Tz);
            go.transform.rotation = Quaternion.Euler(0f, (float)(best.Yaw * Mathf.Rad2Deg), 0f);
            res.frame = go.transform;
            Debug.Log(Tag + "'" + saved.name + "': " + res.status + " | frame at " + go.transform.position.ToString("0.00") + " yaw " + (best.Yaw * Mathf.Rad2Deg).ToString("0.0"));
            return res;
        }
    }
}
