using System.Collections.Generic;
using System.Linq;

namespace Immersa.Core
{
    // Port of src/room/floor.ts.
    public static class Floor
    {
        // Middle of the floor, on the floor (falls back to the lowest plane when no floor is labelled).
        public static Vec3 Centre(IReadOnlyList<RoomPlane> planes)
        {
            var floors = planes.Where(p => p.Label == "floor").ToList();
            var src = floors.Count > 0 ? floors : planes.ToList();
            if (src.Count == 0) return new Vec3(0, 0, 0);
            double x = src.Sum(p => p.Pos.X) / src.Count;
            double z = src.Sum(p => p.Pos.Z) / src.Count;
            double y = floors.Count > 0 ? src.Sum(p => p.Pos.Y) / src.Count : src.Min(p => p.Pos.Y);
            return new Vec3(x, y, z);
        }
    }
}
