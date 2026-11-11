using System;
using System.Collections.Generic;
using System.Linq;

namespace Immersa.Core
{
    // The parts of src/room/structures.ts that are plain geometry (no drawing).
    public static class Structures
    {
        // The outline of a floor: its own corners, or the rectangle a-b of the first floors.
        public static List<Vec2> FloorPoints(Structure s)
        {
            if (s.Pts != null && s.Pts.Count >= 3) return s.Pts;
            return new List<Vec2> { new Vec2(s.A.X, s.A.Y), new Vec2(s.B.X, s.A.Y), new Vec2(s.B.X, s.B.Y), new Vec2(s.A.X, s.B.Y) };
        }

        // The point a headset move / turn / scale is about: the middle of a wall's line, the centre of a floor's outline.
        public static Vec2 Pivot(Structure s)
        {
            if (s.Kind == "wall") return new Vec2((s.A.X + s.B.X) / 2, (s.A.Y + s.B.Y) / 2);
            var p = FloorPoints(s);
            return new Vec2(p.Sum(q => q.X) / p.Count, p.Sum(q => q.Y) / p.Count);
        }

        public static bool HasXf(Structure s) =>
            s.Xf != null && (s.Xf.D != null || (s.Xf.Yaw ?? 0) != 0 || (s.Xf.Scale != null && s.Xf.Scale != 1));

        // The structure as it is drawn: its own shape with the headset's move, turn and scale applied.
        public static Structure Effective(Structure s)
        {
            if (!HasXf(s)) return s;
            var c = Pivot(s);
            double k = s.Xf.Scale ?? 1;
            double cs = Math.Cos(s.Xf.Yaw ?? 0), sn = Math.Sin(s.Xf.Yaw ?? 0);
            var d = s.Xf.D ?? new Vec2(0, 0);
            Vec2 Map(Vec2 p) => new Vec2(
                c.X + ((p.X - c.X) * cs + (p.Y - c.Y) * sn) * k + d.X,
                c.Y + (-(p.X - c.X) * sn + (p.Y - c.Y) * cs) * k + d.Y);
            var e = s.ShallowCopy();
            e.A = Map(s.A);
            e.B = Map(s.B);
            e.Pts = s.Kind == "floor" ? FloorPoints(s).Select(Map).ToList() : s.Pts;
            e.Height = s.Height * k;
            e.Thickness = s.Thickness * k;
            return e;
        }

        public static double PolygonArea(IReadOnlyList<Vec2> pts)
        {
            double a = 0;
            for (int i = 0; i < pts.Count; i++)
            {
                var p = pts[i];
                var q = pts[(i + 1) % pts.Count];
                a += p.X * q.Y - q.X * p.Y;
            }
            return Math.Abs(a) / 2;
        }
    }
}
