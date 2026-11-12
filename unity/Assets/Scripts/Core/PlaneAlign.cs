using System;
using System.Collections.Generic;
using System.Linq;

namespace Immersa.Core
{
    // Port of the plane alignment of src/room/align.ts (alignPlanes): where does a SAVED room go in the live scan?
    // Rough fit on the plane centres (ICP seeded with 24 yaw guesses), then a precise fit on the planes themselves
    // (distance along the live normal, Gauss-Newton on yaw and translation). Same numbers and thresholds as the web app.
    // The result uses the Alignment convention: x' = c x - s z + tx, y' = y + ty, z' = s x + c z + tz.
    public static class PlaneAlign
    {
        const double Inlier = 0.15;   // m
        const double Matched = 0.05;  // m: a plane counts as found when it lies within this of its partner

        // Walls, floor, ceiling, doors and windows stay put; furniture gets moved and re-classified.
        static readonly HashSet<string> Structure = new HashSet<string> { "floor", "ceiling", "wall", "door", "window", "wall face", "invisible wall" };

        static List<RoomPlane> Structural(IList<RoomPlane> planes)
        {
            var s = planes.Where(p => Structure.Contains(p.Label)).ToList();
            return s.Count >= 4 ? s : planes.ToList();
        }

        static double Dist(Vec3 a, Vec3 b) => Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y) + (a.Z - b.Z) * (a.Z - b.Z));
        static double Mean(IEnumerable<double> v) { var l = v.ToList(); return l.Sum() / l.Count; }

        struct Seed { public Alignment A; public double Cost; }

        // First pass, rough: plane centres.
        static List<Alignment> AlignByCentres(List<RoomPlane> from, List<RoomPlane> to)
        {
            var found = new List<Seed>();
            if (from.Count == 0 || to.Count == 0) return new List<Alignment>();

            for (int deg = 0; deg < 360; deg += 15)
            {
                double th = deg * Math.PI / 180;
                double caX = Mean(from.Select(p => p.Pos.X)), caZ = Mean(from.Select(p => p.Pos.Z));
                double cbX = Mean(to.Select(p => p.Pos.X)), cbZ = Mean(to.Select(p => p.Pos.Z));
                double tx = cbX - (Math.Cos(th) * caX - Math.Sin(th) * caZ);
                double tz = cbZ - (Math.Sin(th) * caX + Math.Cos(th) * caZ);
                double ty = 0;

                Vec3 Apply(Vec3 p)
                {
                    double c = Math.Cos(th), s = Math.Sin(th);
                    return new Vec3(c * p.X - s * p.Z + tx, p.Y + ty, s * p.X + c * p.Z + tz);
                }

                for (int it = 0; it < 12; it++)
                {
                    double gate = Math.Max(Inlier, 2 * Math.Pow(0.7, it));   // tightens as the fit improves
                    var pairs = new List<(Vec3 a, Vec3 b)>();
                    foreach (var p in from)
                    {
                        var t = Apply(p.Pos);
                        RoomPlane bestC = null;
                        double bestD = double.PositiveInfinity;
                        foreach (var c in to)
                        {
                            double d = c.Label == p.Label ? Dist(t, c.Pos) : double.PositiveInfinity;
                            if (d < bestD) { bestD = d; bestC = c; }
                        }
                        if (bestC != null && bestD < gate) pairs.Add((p.Pos, bestC.Pos));
                    }
                    if (pairs.Count < 2) break;
                    double maX = Mean(pairs.Select(q => q.a.X)), maZ = Mean(pairs.Select(q => q.a.Z));
                    double mbX = Mean(pairs.Select(q => q.b.X)), mbZ = Mean(pairs.Select(q => q.b.Z));
                    double cross = 0, dot = 0;
                    foreach (var (a, b) in pairs)
                    {
                        double ax = a.X - maX, az = a.Z - maZ, bx = b.X - mbX, bz = b.Z - mbZ;
                        cross += ax * bz - az * bx;
                        dot += ax * bx + az * bz;
                    }
                    th = Math.Atan2(cross, dot);
                    tx = mbX - (Math.Cos(th) * maX - Math.Sin(th) * maZ);
                    tz = mbZ - (Math.Sin(th) * maX + Math.Cos(th) * maZ);
                    ty = Mean(pairs.Select(q => q.b.Y - q.a.Y));
                }

                // Truncated cost over all saved planes: unmatched ones count as 0.3 m.
                double cost = 0;
                var inliers = new List<double>();
                foreach (var p in from)
                {
                    var t = Apply(p.Pos);
                    double d = double.PositiveInfinity;
                    foreach (var c in to) if (c.Label == p.Label) d = Math.Min(d, Dist(t, c.Pos));
                    cost += Math.Min(d, 0.3);
                    if (d < Inlier) inliers.Add(d);
                }
                if (inliers.Count >= 1)
                    found.Add(new Seed { A = new Alignment { Yaw = th, Tx = tx, Ty = ty, Tz = tz, Resid = Mean(inliers), Matched = inliers.Count, Total = from.Count }, Cost = cost });
            }
            return found.OrderBy(x => x.Cost).Select(x => x.A).ToList();
        }

        // Second pass, precise: the distance of the saved plane from the live one measured along the live normal.
        static Alignment Refine(List<RoomPlane> from, List<RoomPlane> to, Alignment start)
        {
            var fromQ = from.Where(p => p.Quat.HasValue).ToList();
            var toQ = to.Where(p => p.Quat.HasValue).ToList();
            if (fromQ.Count < 3 || toQ.Count < 3) return start;
            double yaw = start.Yaw, tx = start.Tx, ty = start.Ty, tz = start.Tz;

            for (int it = 0; it < 8; it++)
            {
                double gate = Math.Max(0.1, 1.5 * Math.Pow(0.6, it));
                double c = Math.Cos(yaw), s = Math.Sin(yaw);
                var A = new double[4, 4];
                var b = new double[4];
                int pairs = 0;
                foreach (var p in fromQ)
                {
                    double rx = c * p.Pos.X - s * p.Pos.Z;
                    double rz = s * p.Pos.X + c * p.Pos.Z;
                    var P = new Vec3(rx + tx, p.Pos.Y + ty, rz + tz);
                    var n0 = Rot.PlaneNormal(p.Quat.Value);
                    var n = new Vec3(c * n0.X - s * n0.Z, n0.Y, s * n0.X + c * n0.Z);
                    Vec3? bestM = null; double bestR = 0;
                    foreach (var q in toQ)
                    {
                        if (q.Label != p.Label) continue;
                        var m = Rot.PlaneNormal(q.Quat.Value);
                        if (Math.Abs(n.X * m.X + n.Y * m.Y + n.Z * m.Z) < 0.9) continue;   // not the same orientation
                        double r = m.X * (P.X - q.Pos.X) + m.Y * (P.Y - q.Pos.Y) + m.Z * (P.Z - q.Pos.Z);
                        if (Math.Abs(r) < gate && (!bestM.HasValue || Math.Abs(r) < Math.Abs(bestR))) { bestM = m; bestR = r; }
                    }
                    if (!bestM.HasValue) continue;
                    var bm = bestM.Value;
                    pairs++;
                    var g = new[] { -bm.X * rz + bm.Z * rx, bm.X, bm.Y, bm.Z };   // d(error) / d(yaw, tx, ty, tz)
                    for (int i = 0; i < 4; i++)
                    {
                        b[i] -= bestR * g[i];
                        for (int j = 0; j < 4; j++) A[i, j] += g[i] * g[j];
                    }
                }
                if (pairs < 3) break;
                for (int i = 0; i < 4; i++) A[i, i] += 1e-6;   // a direction no plane constrains stays put
                var d = Solve4(A, b);
                if (d == null) break;
                yaw += d[0]; tx += d[1]; ty += d[2]; tz += d[3];
                if (Math.Sqrt(d[1] * d[1] + d[2] * d[2] + d[3] * d[3]) < 1e-4 && Math.Abs(d[0]) < 1e-5) break;
            }

            // Score: how many saved planes now lie on a live plane, and how far off they are.
            double cc = Math.Cos(yaw), ss = Math.Sin(yaw);
            var errors = new List<double>();
            foreach (var p in fromQ)
            {
                var P = new Vec3(cc * p.Pos.X - ss * p.Pos.Z + tx, p.Pos.Y + ty, ss * p.Pos.X + cc * p.Pos.Z + tz);
                var n0 = Rot.PlaneNormal(p.Quat.Value);
                var n = new Vec3(cc * n0.X - ss * n0.Z, n0.Y, ss * n0.X + cc * n0.Z);
                double e = double.PositiveInfinity;
                foreach (var q in toQ)
                {
                    if (q.Label != p.Label) continue;
                    var m = Rot.PlaneNormal(q.Quat.Value);
                    if (Math.Abs(n.X * m.X + n.Y * m.Y + n.Z * m.Z) < 0.9) continue;
                    e = Math.Min(e, Math.Abs(m.X * (P.X - q.Pos.X) + m.Y * (P.Y - q.Pos.Y) + m.Z * (P.Z - q.Pos.Z)));
                }
                if (e < Matched) errors.Add(e);
            }
            if (errors.Count == 0) return start;
            return new Alignment { Yaw = yaw, Tx = tx, Ty = ty, Tz = tz, Resid = Mean(errors), Matched = errors.Count, Total = from.Count };
        }

        // Gaussian elimination for a 4x4 system; null if singular.
        static double[] Solve4(double[,] A, double[] b)
        {
            var M = new double[4, 5];
            for (int i = 0; i < 4; i++) { for (int j = 0; j < 4; j++) M[i, j] = A[i, j]; M[i, 4] = b[i]; }
            for (int i = 0; i < 4; i++)
            {
                int piv = i;
                for (int r = i + 1; r < 4; r++) if (Math.Abs(M[r, i]) > Math.Abs(M[piv, i])) piv = r;
                if (Math.Abs(M[piv, i]) < 1e-12) return null;
                if (piv != i) for (int k = 0; k < 5; k++) { var tmp = M[i, k]; M[i, k] = M[piv, k]; M[piv, k] = tmp; }
                for (int r = i + 1; r < 4; r++)
                {
                    double f = M[r, i] / M[i, i];
                    for (int k = i; k < 5; k++) M[r, k] -= f * M[i, k];
                }
            }
            var x = new double[4];
            for (int i = 3; i >= 0; i--)
            {
                double sum = M[i, 4];
                for (int k = i + 1; k < 4; k++) sum -= M[i, k] * x[k];
                x[i] = sum / M[i, i];
            }
            return x;
        }

        /// <summary>
        /// Which saved planes are the live ones, and how is the saved room placed? Structural planes only: rough fit on the
        /// centres, then precise on the planes. Null if nothing matches.
        /// </summary>
        public static Alignment AlignPlanes(IList<RoomPlane> from, IList<RoomPlane> to)
        {
            var f = Structural(from);
            var t = Structural(to);
            var seeds = AlignByCentres(f, t);
            if (seeds.Count == 0) return null;

            // A box-shaped room looks the same turned by 180 degrees, so the best centre fit can be the wrong way round:
            // refine the best few and keep the one in which the most planes are found (doors and windows tell them apart).
            Alignment best = null;
            double bestScore = double.NegativeInfinity;
            foreach (var seed in seeds.Take(8))
            {
                var start = new Alignment { Yaw = seed.Yaw, Tx = seed.Tx, Ty = seed.Ty, Tz = seed.Tz, Resid = seed.Resid, Matched = seed.Matched, Total = f.Count };
                var fine = Refine(f, t, start);
                fine.Total = f.Count;
                double score = fine.Matched - fine.Resid * 5;
                if (score > bestScore) { bestScore = score; best = fine; }
            }
            return best;
        }
    }
}
