using System;
using System.Collections.Generic;
using Immersa.Core;
using Meta.XR.MRUtilityKit;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>
    /// Turns a room known by the headset (MRUK) into our own room format (<see cref="RoomScan"/>, the same JSON the web app
    /// saves): planes with outline and furniture boxes, in the frame of the Unity world at the time of the call, with the
    /// web's axes (see <see cref="WebSpace"/>: z negated).
    ///
    /// Conventions, derived from src/room/capture.ts and align.ts:
    ///  - the web's plane lives in its local X/Z plane with the normal along local Y and the outline as flat [x, z, ...];
    ///    MRUK's lives in local X/Y with the normal along +Z and the outline as Vector2 (x, y). The outline keeps its numbers
    ///    ([x, y] -> [x, z]) and the orientation gets a fixed turn: Rx(-90 deg) maps web local Y to MRUK -Z and web Z to MRUK Y.
    ///  - mirroring z turns a rotation (x, y, z, w) into (-x, -y, z, w); local vectors of a plane have z = 0, so they stay as they are.
    ///  - the plane position is the centre of its rectangle (WebXR's plane space is centred), the outline is relative to it.
    ///  - the web compares normals up to their sign, so the sign of the normal does not matter.
    /// Each plane and box keeps the Meta anchor id in `Extra["uuid"]` (the anchors persist across sessions: later used to
    /// find the room again without any alignment search); the scan keeps the room id in `Extra["meta"]`.
    /// </summary>
    public static class RoomScanExport
    {
        static readonly Quaternion PlaneTurn = Quaternion.Euler(-90f, 0f, 0f);

        public static RoomScan FromRoom(MRUKRoom room)
        {
            var scan = new RoomScan { Version = 1, SavedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
            scan.Boxes = new List<RoomBox>();
            foreach (var a in room.Anchors)
            {
                if (a == null) continue;
                var label = LabelOf(a);
                if (label == null) continue;   // the global mesh is not part of our format
                // Furniture (table, storage, couch...) has BOTH a plane (its top face) and a volume: it must become a box.
                // Only walls, floor, ceiling, doors and windows are planes alone.
                if (a.VolumeBounds.HasValue) scan.Boxes.Add(ToBox(a, label));
                else if (a.PlaneRect.HasValue) scan.Planes.Add(ToPlane(a, label));
            }
            scan.Extra = new Dictionary<string, JToken>
            {
                ["meta"] = new JObject { ["roomUuid"] = room.Anchor.Uuid.ToString(), ["source"] = "unity-mruk" }
            };
            return scan;
        }

        static RoomPlane ToPlane(MRUKAnchor a, string label)
        {
            var rect = a.PlaneRect.Value;
            var c = rect.center;
            var t = a.transform;
            var centreWorld = t.TransformPoint(new Vector3(c.x, c.y, 0f));
            var q = Mirror(t.rotation) * PlaneTurn;

            var poly = new List<double>();
            var boundary = a.PlaneBoundary2D;
            if (boundary != null && boundary.Count >= 3)
                foreach (var p in boundary) { poly.Add(Round(p.x - c.x)); poly.Add(Round(p.y - c.y)); }
            else
            {
                // No outline reported: the rectangle itself.
                float hw = rect.width / 2f, hh = rect.height / 2f;
                foreach (var p in new[] { new Vector2(-hw, -hh), new Vector2(hw, -hh), new Vector2(hw, hh), new Vector2(-hw, hh) }) { poly.Add(Round(p.x)); poly.Add(Round(p.y)); }
            }

            return new RoomPlane
            {
                Label = label,
                Pos = WebSpace.ToVec3(centreWorld),
                Quat = new Quat(Round(q.x), Round(q.y), Round(q.z), Round(q.w)),
                Poly = poly,
                Extra = new Dictionary<string, JToken> { ["uuid"] = a.Anchor.Uuid.ToString() },
            };
        }

        static RoomBox ToBox(MRUKAnchor a, string label)
        {
            var b = a.VolumeBounds.Value;
            var q = Mirror(a.transform.rotation);
            // Local vectors lose the sign of z when the world is mirrored: x and y keep their range, z is flipped.
            return new RoomBox
            {
                Label = label,
                Pos = WebSpace.ToVec3(a.transform.position),
                Quat = new Quat(Round(q.x), Round(q.y), Round(q.z), Round(q.w)),
                Min = new Vec3(Round(b.min.x), Round(b.min.y), Round(-b.max.z)),
                Max = new Vec3(Round(b.max.x), Round(b.max.y), Round(-b.min.z)),
                Extra = new Dictionary<string, JToken> { ["uuid"] = a.Anchor.Uuid.ToString() },
            };
        }

        static Quaternion Mirror(Quaternion q) => new Quaternion(-q.x, -q.y, q.z, q.w);

        static double Round(float v) => Math.Round(v * 1000.0) / 1000.0;

        /// <summary>Meta's label -> the web's lower-case semantic label; null for what we leave out.</summary>
        static string LabelOf(MRUKAnchor a)
        {
            var l = a.Label;
            if ((l & MRUKAnchor.SceneLabels.GLOBAL_MESH) != 0) return null;
            if ((l & MRUKAnchor.SceneLabels.FLOOR) != 0) return "floor";
            if ((l & MRUKAnchor.SceneLabels.CEILING) != 0) return "ceiling";
            if ((l & (MRUKAnchor.SceneLabels.WALL_FACE | MRUKAnchor.SceneLabels.INNER_WALL_FACE)) != 0) return "wall";
            if ((l & MRUKAnchor.SceneLabels.INVISIBLE_WALL_FACE) != 0) return "invisible wall";
            if ((l & MRUKAnchor.SceneLabels.DOOR_FRAME) != 0) return "door";
            if ((l & MRUKAnchor.SceneLabels.WINDOW_FRAME) != 0) return "window";
            if ((l & MRUKAnchor.SceneLabels.WALL_ART) != 0) return "wall art";
            foreach (var name in a.AnchorLabels) return name.ToLowerInvariant().Replace('_', ' ');
            return "other";
        }
    }
}
