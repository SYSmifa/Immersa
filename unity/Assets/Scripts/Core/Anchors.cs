using System;
using System.Collections.Generic;
using System.Linq;

namespace Immersa.Core
{
    // Where a saved room goes in the current session: x' = c x - s z + tx, y' = y + ty, z' = s x + c z + tz (c = cos yaw,
    // s = sin yaw). Same fields and convention as `Alignment` in src/room/align.ts.
    public class Alignment
    {
        public double Yaw, Tx, Ty, Tz;
        public double Resid;           // mean distance of matched planes after alignment, metres
        public int Matched, Total;
    }

    public class PlanSeg
    {
        public double X1, Z1, X2, Z2;
        public string Kind;            // "wall" | "door" | "window"
    }

    public class CornerPlan
    {
        public Vec3 A, B;              // the two suggested corners, on the floor
        public List<PlanSeg> Segs;     // walls, doors and windows seen from above, to draw the plan
        public double FloorY;
    }

    public class TouchResult
    {
        public Alignment Alignment;
        public double Expected;        // distance between the two corners in the saved room, m
        public double Measured;        // distance between the two touches, m
        public bool Ok;                // the two distances agree: the right corners were touched
    }

    // Port of src/room/anchors.ts: manual alignment of a saved room with two touched points (no Meta planes needed).
    // The saved room suggests two of its own corners (vertical edges where two walls meet), the user touches those two corners in
    // the real room, and the room is put where the two touches say. Only the position on the floor matters.
    public static class Anchors
    {
        class Line
        {
            public double Nx, Nz, D;   // D = n . p for points on the wall
            public double T0, T1;      // extent along the tangent (-nz, nx)
            public string Kind;
            public double MinY;
        }

        const double Margin = 0.5;     // m: a corner may lie this far beyond the end of a wall (scans leave gaps at the corners)
        const double MinSpan = 1.5;    // m: the two corners must be at least this far apart to give a good rotation
        const double Tie = 1e-9;       // two corner distances closer than this are the same (a rectangle's two diagonals)

        static readonly HashSet<string> Kinds = new HashSet<string> { "wall", "door", "window" };

        // A plane's outline in the room's frame (the plan polygon, or just its centre if it has none).
        static List<Vec3> Outline(RoomPlane p)
        {
            var centre = p.Pos;
            if (p.Quat == null || p.Poly == null || p.Poly.Count < 6) return new List<Vec3> { centre };
            var q = p.Quat.Value;
            var res = new List<Vec3>();
            for (int i = 0; i + 1 < p.Poly.Count; i += 2)
            {
                var r = Rot.Apply(q, new Vec3(p.Poly[i], 0, p.Poly[i + 1]));
                res.Add(new Vec3(r.X + centre.X, r.Y + centre.Y, r.Z + centre.Z));
            }
            return res;
        }

        static List<Line> Lines(IEnumerable<RoomPlane> planes)
        {
            var res = new List<Line>();
            foreach (var p in planes)
            {
                if (p.Label == null || !Kinds.Contains(p.Label) || p.Quat == null) continue;
                var n = Rot.PlaneNormal(p.Quat.Value);
                double h = Math.Sqrt(n.X * n.X + n.Z * n.Z);
                if (h < 0.7) continue; // not a vertical plane
                double nx = n.X / h, nz = n.Z / h;
                var pts = Outline(p);
                double d = nx * p.Pos.X + nz * p.Pos.Z;
                double t0 = double.PositiveInfinity, t1 = double.NegativeInfinity, minY = double.PositiveInfinity;
                foreach (var v in pts)
                {
                    double t = -nz * v.X + nx * v.Z;
                    t0 = Math.Min(t0, t); t1 = Math.Max(t1, t);
                    minY = Math.Min(minY, v.Y);
                }
                if (t1 - t0 < 0.2) continue;
                res.Add(new Line { Nx = nx, Nz = nz, D = d, T0 = t0, T1 = t1, Kind = p.Label, MinY = minY });
            }
            return res;
        }

        // The floor height of the saved scan: the floor plane, else the lowest edge of the walls.
        public static double FloorHeight(IReadOnlyList<RoomPlane> planes)
        {
            var floors = planes.Where(p => p.Label == "floor").ToList();
            if (floors.Count > 0) return floors.Sum(p => p.Pos.Y) / floors.Count;
            var ys = Lines(planes).Where(l => l.Kind == "wall").Select(l => l.MinY).ToList();
            return ys.Count > 0 ? ys.Min() : 0;
        }

        // Two corners of the room far from each other, and the plan to show them on. null when the scan has no usable walls.
        // (Not cached here: the caller keeps the result while the same scan is shown.)
        public static CornerPlan SuggestCorners(IReadOnlyList<RoomPlane> planes)
        {
            var all = Lines(planes);
            var walls = all.Where(l => l.Kind == "wall").ToList();
            if (walls.Count < 2) return null;
            double floorY = FloorHeight(planes);
            var corners = new List<(double x, double z)>();
            for (int i = 0; i < walls.Count; i++)
            {
                for (int j = i + 1; j < walls.Count; j++)
                {
                    var a = walls[i];
                    var b = walls[j];
                    double det = a.Nx * b.Nz - a.Nz * b.Nx;
                    if (Math.Abs(det) < 0.7) continue; // nearly parallel: no corner (at least 45 degrees apart)
                    double x = (a.D * b.Nz - a.Nz * b.D) / det;
                    double z = (a.Nx * b.D - a.D * b.Nx) / det;
                    double ta = -a.Nz * x + a.Nx * z;
                    double tb = -b.Nz * x + b.Nx * z;
                    if (ta < a.T0 - Margin || ta > a.T1 + Margin || tb < b.T0 - Margin || tb > b.T1 + Margin) continue; // not where both walls are
                    if (corners.Any(c => Math.Sqrt((c.x - x) * (c.x - x) + (c.z - z) * (c.z - z)) < 0.3)) continue;
                    corners.Add((x, z));
                }
            }
            if (corners.Count < 2) return null;
            int bi = -1, bj = -1;
            double bestD = 0;
            for (int i = 0; i < corners.Count; i++)
            {
                for (int j = i + 1; j < corners.Count; j++)
                {
                    double dx = corners[i].x - corners[j].x, dz = corners[i].z - corners[j].z;
                    double d = Math.Sqrt(dx * dx + dz * dz);
                    // The web takes the first strictly larger one, so a rectangle's two (equal) diagonals are decided by rounding
                    // noise; here the first one wins unless another is really longer.
                    if (d > bestD + Tie) { bestD = d; bi = i; bj = j; }
                }
            }
            if (bi < 0 || bestD < MinSpan) return null;
            var ca = corners[bi];
            var cb = corners[bj];
            var segs = all.Select(l => new PlanSeg
            {
                X1 = l.Nx * l.D + -l.Nz * l.T0, Z1 = l.Nz * l.D + l.Nx * l.T0,
                X2 = l.Nx * l.D + -l.Nz * l.T1, Z2 = l.Nz * l.D + l.Nx * l.T1,
                Kind = l.Kind,
            }).ToList();
            return new CornerPlan { A = new Vec3(ca.x, floorY, ca.z), B = new Vec3(cb.x, floorY, cb.z), Segs = segs, FloorY = floorY };
        }

        // Where the saved room goes, given its two corners (a, b: room frame) and the two touched points (ta, tb: session frame).
        // floorLive: the real floor's height in the session (null: keep the saved floor height, the caller does not know it).
        public static TouchResult AlignFromTouches(Vec3 a, Vec3 b, Vec3 ta, Vec3 tb, double? floorLive)
        {
            double vx = b.X - a.X, vz = b.Z - a.Z;
            double wx = tb.X - ta.X, wz = tb.Z - ta.Z;
            double yaw = Math.Atan2(vx * wz - vz * wx, vx * wx + vz * wz);
            double c = Math.Cos(yaw), s = Math.Sin(yaw);
            // the two corners land on the touches as well as they can: the midpoints coincide
            double mx = (a.X + b.X) / 2, mz = (a.Z + b.Z) / 2;
            double tx = (ta.X + tb.X) / 2 - (c * mx - s * mz);
            double tz = (ta.Z + tb.Z) / 2 - (s * mx + c * mz);
            double expected = Math.Sqrt(vx * vx + vz * vz);
            double measured = Math.Sqrt(wx * wx + wz * wz);
            double err = Math.Abs(measured - expected);
            double ty = floorLive == null ? 0 : floorLive.Value - a.Y;
            return new TouchResult
            {
                Alignment = new Alignment { Yaw = yaw, Tx = tx, Ty = ty, Tz = tz, Resid = err / 2, Matched = 2, Total = 2 },
                Expected = expected,
                Measured = measured,
                Ok = err <= Math.Max(0.15, 0.06 * expected),
            };
        }
    }
}
