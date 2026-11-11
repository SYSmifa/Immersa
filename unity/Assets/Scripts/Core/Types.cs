using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Immersa.Core
{
    // The same data as src/room/types.ts. The web app is the source of truth: keep field names and meaning identical.
    // JSON names are camelCase (see Json.cs). Absent optional fields stay null and are not written back.
    // Every class keeps the fields it does not know in `Extra`, so a newer web version's data survives a save from Unity.

    public class RoomPlane
    {
        public string Label;
        public Vec3 Pos;               // plane centre in the frame the room was scanned in
        public Quat? Quat;             // plane orientation
        public List<double> Poly;      // outline in plane space, flat [x, z, x, z, ...] (for drawing only)
        [JsonExtensionData] public IDictionary<string, JToken> Extra;
    }

    // A furniture-like volume (table, couch...): an oriented box.
    public class RoomBox
    {
        public string Label;
        public Vec3 Pos;               // origin of the box's own frame, in the scan's frame
        public Quat Quat;
        public Vec3 Min;               // corners of the box in its own frame
        public Vec3 Max;
        [JsonExtensionData] public IDictionary<string, JToken> Extra;
    }

    public class Finish
    {
        public double? Roughness;      // 0..1
        public double? Metalness;      // 0..1
        [JsonExtensionData] public IDictionary<string, JToken> Extra;
    }

    // A component of a model changed on its own (offsets in the model's own frame at scale 1).
    public class PartEdit
    {
        public Vec3? D;                // moved from where it was in the file
        public double? Yaw;            // turned about Y, radians
        public double? Scale;          // 1 = as in the file
        public string Color;           // tint of the whole component
        public Finish Finish;
        [JsonExtensionData] public IDictionary<string, JToken> Extra;
    }

    // A 3D model placed in a project. Real-world size: Scale multiplies the file's own metres.
    public class RoomModel
    {
        public string Id;
        public string RoomId;          // the room whose frame Pos and Yaw are in ('' = free space)
        public string Name;
        public string Source;          // file it was imported from (the cloud GLB is a conversion of it)
        public string Path;            // "<user id>/<sha>.glb" in the Supabase "models" bucket, or "local:<file>"
        public Vec3 Pos;               // base centre of the model, in that room's frame
        public double Yaw;             // rotation about Y, radians
        public Vec2? Tilt;             // also turned about X and Z (radians); orientation = Ry(yaw) * Rx(tilt.X) * Rz(tilt.Y)
        public double Scale;
        public string Color;           // '#rrggbb' tint of every material; null = the file's own colours
        public Dictionary<string, string> MaterialColors;   // by material index: overrides Color
        public Finish Finish;
        public Dictionary<string, Finish> MaterialFinish;   // by material index: overrides Finish
        public Dictionary<string, PartEdit> Parts;          // by part path (child indices of the glTF node tree)
        [JsonExtensionData] public IDictionary<string, JToken> Extra;
    }

    // Where another room is, seen from this one: x' = c x - s z + tx, y' = y + ty, z' = s x + c z + tz (c = cos yaw, s = sin yaw).
    public class RoomLinkCandidate
    {
        public double Yaw, Tx, Ty, Tz, At;
        public int N;
        public string Sess;
        [JsonExtensionData] public IDictionary<string, JToken> Extra;

        public RoomLinkCandidate ShallowCopy() => (RoomLinkCandidate)MemberwiseClone();
    }

    public class RoomLink
    {
        public double Yaw, Tx, Ty, Tz;
        public double At;              // ms since the epoch
        public string Src;             // "meta" (headset planes) or "manual" (two corners touched)
        public int? N;                 // sessions that agreed; absent = 1. Used only when >= 2, or by hand.
        public string Sess;            // the session of the last measure
        public RoomLinkCandidate Cand; // a different measure of a link not confirmed yet
        [JsonExtensionData] public IDictionary<string, JToken> Extra;

        public RoomLink ShallowCopy() => (RoomLink)MemberwiseClone();
    }

    // Our own room format; the Meta scan is only one possible source of Planes.
    public class RoomScan
    {
        public int Version = 1;
        public double SavedAt;
        public List<RoomPlane> Planes = new List<RoomPlane>();
        public List<RoomBox> Boxes;                          // absent in scans saved by older versions
        public Dictionary<string, RoomLink> Links;           // by room id (see room/layout.ts)
        [JsonExtensionData] public IDictionary<string, JToken> Extra;
    }

    // A room as a row of the "rooms" table (Supabase column names are snake_case; the data layer maps them).
    public class Room
    {
        public string Id;
        public string Name;
        public string Place;           // a project only uses rooms of one place; null = not assigned yet
        public string CreatedAt;
        public string UpdatedAt;       // ISO 8601
        public RoomScan Scan;
    }

    // A wall or a floor drawn in the PC editor, in its room's frame, on the floor level Y.
    public class Structure
    {
        public string Id;
        public string RoomId;
        public string Kind;            // "wall" | "floor"
        public Vec2 A;
        public Vec2 B;
        public double Y;
        public double Height;          // walls only
        public double Thickness;
        public string Color;
        public string Texture;         // id in the texture catalogue
        public string Align;           // wall: "left" | "center" | "right"; null = centred
        public List<Vec2> Pts;         // floor outline (>= 3 corners); null = the rectangle with corners A and B
        public Finish Finish;
        public StructureMove Xf;       // moved/turned/scaled in the headset, about the centre of its footprint
        [JsonExtensionData] public IDictionary<string, JToken> Extra;

        public Structure ShallowCopy() => (Structure)MemberwiseClone();
    }

    public class StructureMove
    {
        public Vec2? D;
        public double? Yaw;
        public double? Scale;
        [JsonExtensionData] public IDictionary<string, JToken> Extra;
    }

    // A note (point A + text) or a ruler (points A and B) left in a room.
    public class Annotation
    {
        public string Id;
        public string RoomId;          // '' = free space
        public string Kind;            // "note" | "ruler"
        public Vec3 A;
        public Vec3? B;                // rulers only
        public string Text;
        public string Color;           // '#rrggbb'
        public double? Scale;          // notes: size of the label (1 = normal)
        [JsonExtensionData] public IDictionary<string, JToken> Extra;
    }

    // A project holds the models of one or more rooms, each in its room's frame.
    public class Project
    {
        public string Id;
        public string Name;
        public string UpdatedAt;
        public List<string> RoomIds = new List<string>();
        public List<RoomModel> Models = new List<RoomModel>();
        public List<Structure> Structures = new List<Structure>();
        public List<Annotation> Annotations = new List<Annotation>();
        public int? Tone;
    }
}
