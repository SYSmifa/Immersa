using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Immersa.Core
{
    // Port of src/room/measure.ts: measures and distances worked out from the room's data alone (no drawing).
    // Everything is in the room's frame, plan = (x, z), up = y. Axes are the web's (see README).

    // A vertical wall face seen from above: a segment in plan with the heights it covers.
    public class Seg
    {
        public P2 A, B;
        public double Y0, Y1;
        public string Owner;           // what it belongs to (a measure never stops on its own object)
    }

    // An oriented rectangle in plan with a height range: a model, or a furniture box of the scan.
    public class Solid
    {
        public string Id, Name;
        public P2 C;                   // centre
        public P2 U;                   // unit axis of its width (the other axis is U turned a quarter)
        public double Hu;              // half width, along U
        public double Hv;              // half depth, along V = (-U.z, U.x)
        public double Y0, Y1;
    }

    // Kinds: "dim" a line with its size, "gap" a free distance to the next thing, "label" a text at a point (A == B);
    // annotations are drawn through the same renderers: "ruler", "note", "pin".
    public class Measure
    {
        public string Kind;
        public Vec3 A, B;
        public string Text;
        public string Owner;
        public string Color;           // '#rrggbb', annotations only
        public double? Scale;          // annotation labels: size factor
        public bool Selected;          // annotations: drawn with the azure outline of selected objects
    }

    public class MeasureContext
    {
        public List<Seg> Obstacles = new List<Seg>();   // wall faces and other objects' sides
        public P2? Axes;               // the room's own directions (along its walls); null: use the object's axes
        public double? CeilingY;
        public double FloorY;
        public double? MaxRange;       // free distances farther than this are not shown
        public bool Vertical = true;   // false: no distance up to the ceiling or down to the floor
    }

    public static class Measures
    {
        const int Samples = 9;         // rays across an object's side
        const double MaxRange = 3;
        const double Tie = 1e-9;       // projections closer than this (m) are the same

        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        static string Comma(double n, int d) => n.ToString("F" + d, Inv).Replace('.', ',');

        public static string FormatLength(double m)
        {
            if (m >= 1) return Comma(m, 2) + " m";
            if (m >= 0.1) return Rot.JsRound(m * 100).ToString("0", Inv) + " cm";
            if (m >= 0.01) return Comma(m * 100, 1) + " cm";
            return Rot.JsRound(m * 1000).ToString("0", Inv) + " mm";
        }

        public static string FormatArea(double m2) => Comma(m2, 2) + " m²";

        static P2 Perp(P2 u) => new P2(-u.Z, u.X);
        static Vec3 V3(double x, double y, double z) => new Vec3(x, y, z);

        // ---- turning the room's data into solids and wall faces ----

        static Solid SolidFromCorners(string id, string name, IEnumerable<Vec3> corners, P2 u)
        {
            var v = Perp(u);
            double u0 = double.PositiveInfinity, u1 = double.NegativeInfinity, v0 = double.PositiveInfinity, v1 = double.NegativeInfinity;
            double y0 = double.PositiveInfinity, y1 = double.NegativeInfinity;
            foreach (var p in corners)
            {
                double pu = p.X * u.X + p.Z * u.Z;
                double pv = p.X * v.X + p.Z * v.Z;
                u0 = Math.Min(u0, pu); u1 = Math.Max(u1, pu);
                v0 = Math.Min(v0, pv); v1 = Math.Max(v1, pv);
                y0 = Math.Min(y0, p.Y); y1 = Math.Max(y1, p.Y);
            }
            double cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
            return new Solid
            {
                Id = id, Name = name,
                C = new P2(u.X * cu + v.X * cv, u.Z * cu + v.Z * cv),
                U = u, Hu = (u1 - u0) / 2, Hv = (v1 - v0) / 2, Y0 = y0, Y1 = y1,
            };
        }

        static List<Vec3> CornersOf(Vec3 lo, Vec3 hi, Func<Vec3, Vec3> transform)
        {
            var out_ = new List<Vec3>();
            foreach (var x in new[] { lo.X, hi.X })
                foreach (var y in new[] { lo.Y, hi.Y })
                    foreach (var z in new[] { lo.Z, hi.Z })
                        out_.Add(transform(new Vec3(x, y, z)));
            return out_;
        }

        // A placed model. lo/hi: its box in its own frame at scale 1 (as the loaded file is, centred on x/z, base at y = 0).
        public static Solid ModelSolid(RoomModel m, Vec3 lo, Vec3 hi)
        {
            var q = Rot.FromEulerYXZ(m.Tilt?.X ?? 0, m.Yaw, m.Tilt?.Y ?? 0);
            Vec3 Tr(Vec3 p)
            {
                var r = Rot.Apply(q, V3(p.X * m.Scale, p.Y * m.Scale, p.Z * m.Scale));
                return V3(r.X + m.Pos.X, r.Y + m.Pos.Y, r.Z + m.Pos.Z);
            }
            return SolidFromCorners(m.Id, m.Name, CornersOf(lo, hi, Tr), new P2(Math.Cos(m.Yaw), -Math.Sin(m.Yaw)));
        }

        // A furniture box of the scan (an oriented box in the scan's frame).
        public static Solid BoxSolid(RoomBox b, int index)
        {
            Vec3 Tr(Vec3 p) { var r = Rot.Apply(b.Quat, p); return V3(r.X + b.Pos.X, r.Y + b.Pos.Y, r.Z + b.Pos.Z); }
            var x = Rot.Apply(b.Quat, V3(1, 0, 0));
            double len = Math.Sqrt(x.X * x.X + x.Z * x.Z);
            var u = len > 0.05 ? new P2(x.X / len, x.Z / len) : new P2(1, 0);
            return SolidFromCorners("box:" + index, b.Label, CornersOf(b.Min, b.Max, Tr), u);
        }

        // The four sides of a solid as wall faces.
        public static List<Seg> SolidSegs(Solid s)
        {
            var v = Perp(s.U);
            P2 P(double a, double b) => new P2(s.C.X + s.U.X * a * s.Hu + v.X * b * s.Hv, s.C.Z + s.U.Z * a * s.Hu + v.Z * b * s.Hv);
            var k = new[] { P(-1, -1), P(1, -1), P(1, 1), P(-1, 1) };
            var segs = new List<Seg>();
            for (int i = 0; i < 4; i++) segs.Add(new Seg { A = k[i], B = k[(i + 1) % 4], Y0 = s.Y0, Y1 = s.Y1, Owner = s.Id });
            return segs;
        }

        // A wall built in the editor: its four sides (it has a thickness).
        public static List<Seg> WallSegs(Structure st)
        {
            if (st.Kind != "wall") return new List<Seg>();
            var s = Structures.Effective(st);
            double dx = s.B.X - s.A.X, dz = s.B.Y - s.A.Y;
            double len = Math.Max(0.01, Math.Sqrt(dx * dx + dz * dz));
            double off = s.Align == "left" ? s.Thickness / 2 : s.Align == "right" ? -s.Thickness / 2 : 0;
            var c = new P2((s.A.X + s.B.X) / 2 + (dz / len) * off, (s.A.Y + s.B.Y) / 2 - (dx / len) * off);
            var solid = new Solid { Id = s.Id, Name = "parete", C = c, U = new P2(dx / len, dz / len), Hu = len / 2, Hv = s.Thickness / 2, Y0 = s.Y, Y1 = s.Y + s.Height };
            return SolidSegs(solid);
        }

        static readonly HashSet<string> WallLabels = new HashSet<string> { "wall", "wall face" };

        // A wall plane of the scan: a vertical polygon, seen from above it is a segment.
        public static Seg PlaneSeg(RoomPlane p, int index)
        {
            if (!WallLabels.Contains(p.Label) || p.Quat == null || p.Poly == null || p.Poly.Count < 6) return null;
            var q = p.Quat.Value;
            var n = Rot.PlaneNormal(q);
            if (Math.Abs(n.Y) > 0.5) return null;      // not vertical
            var pts = new List<Vec3>();
            for (int i = 0; i + 1 < p.Poly.Count; i += 2)
            {
                var r = Rot.Apply(q, V3(p.Poly[i], 0, p.Poly[i + 1]));
                pts.Add(V3(r.X + p.Pos.X, r.Y + p.Pos.Y, r.Z + p.Pos.Z));
            }
            double nl = Math.Sqrt(n.X * n.X + n.Z * n.Z);
            if (nl == 0) nl = 1;
            var d = new P2(-n.Z / nl, n.X / nl);        // along the wall
            double t0 = double.PositiveInfinity, t1 = double.NegativeInfinity, y0 = double.PositiveInfinity, y1 = double.NegativeInfinity, off = 0;
            foreach (var p3 in pts)
            {
                double t = p3.X * d.X + p3.Z * d.Z;
                t0 = Math.Min(t0, t); t1 = Math.Max(t1, t);
                y0 = Math.Min(y0, p3.Y); y1 = Math.Max(y1, p3.Y);
                off += p3.X * (n.X / nl) + p3.Z * (n.Z / nl);
            }
            off /= pts.Count;
            if (t1 - t0 < 0.1) return null;
            var nn = new P2(n.X / nl, n.Z / nl);
            return new Seg
            {
                A = new P2(d.X * t0 + nn.X * off, d.Z * t0 + nn.Z * off),
                B = new P2(d.X * t1 + nn.X * off, d.Z * t1 + nn.Z * off),
                Y0 = y0, Y1 = y1, Owner = "plane:" + index,
            };
        }

        public static double? CeilingYOf(IEnumerable<RoomPlane> planes) => planes.FirstOrDefault(p => p.Label == "ceiling")?.Pos.Y;
        public static double FloorYOf(IEnumerable<RoomPlane> planes) => planes.FirstOrDefault(p => p.Label == "floor")?.Pos.Y ?? 0;

        // The room's own direction: along its longest wall (any multiple of 90° is the same), null without walls.
        public static P2? RoomAxes(IEnumerable<Seg> walls)
        {
            Seg best = null;
            double bestLen = 0;
            foreach (var s in walls)
            {
                double len = Math.Sqrt((s.B.X - s.A.X) * (s.B.X - s.A.X) + (s.B.Z - s.A.Z) * (s.B.Z - s.A.Z));
                if (len > bestLen) { best = s; bestLen = len; }
            }
            if (best == null || bestLen < 0.5) return null;
            return new P2((best.B.X - best.A.X) / bestLen, (best.B.Z - best.A.Z) / bestLen);
        }

        // ---- rays ----

        // First wall face hit by a ray in plan from o along d, among faces that cover some of the heights y0..y1.
        static double? Cast(P2 o, P2 d, List<Seg> segs, double y0, double y1, string skip)
        {
            double? best = null;
            foreach (var s in segs)
            {
                if (s.Owner == skip || s.Y1 <= y0 + 0.02 || s.Y0 >= y1 - 0.02) continue;
                double rx = s.B.X - s.A.X, rz = s.B.Z - s.A.Z;
                double den = d.X * rz - d.Z * rx;
                if (Math.Abs(den) < 1e-9) continue;
                double wx = s.A.X - o.X, wz = s.A.Z - o.Z;
                double t = (wx * rz - wz * rx) / den;
                double k = (wx * d.Z - wz * d.X) / den;
                if (t > 1e-4 && k >= 0 && k <= 1 && (best == null || t < best)) best = t;
            }
            return best;
        }

        // ---- what to show ----

        // Width, depth and height of a solid, drawn along two bottom edges and the vertical edge at the corner where they meet.
        public static List<Measure> DimsOfSolid(Solid s)
        {
            var v = Perp(s.U);
            Vec3 At(double a, double b, double y) => V3(s.C.X + s.U.X * a * s.Hu + v.X * b * s.Hv, y, s.C.Z + s.U.Z * a * s.Hu + v.Z * b * s.Hv);
            return new List<Measure>
            {
                new Measure { Kind = "dim", A = At(-1, -1, s.Y0), B = At(1, -1, s.Y0), Text = FormatLength(2 * s.Hu), Owner = s.Id },
                new Measure { Kind = "dim", A = At(1, -1, s.Y0), B = At(1, 1, s.Y0), Text = FormatLength(2 * s.Hv), Owner = s.Id },
                new Measure { Kind = "dim", A = At(1, -1, s.Y0), B = At(1, -1, s.Y1), Text = FormatLength(s.Y1 - s.Y0), Owner = s.Id }, // where width and depth meet
            };
        }

        // Length and height of a wall; edges and area of a floor.
        public static List<Measure> DimsOfStructure(Structure st)
        {
            var s = Structures.Effective(st);
            if (s.Kind == "wall")
            {
                double len = Math.Sqrt((s.B.X - s.A.X) * (s.B.X - s.A.X) + (s.B.Y - s.A.Y) * (s.B.Y - s.A.Y));
                double dx = (s.B.X - s.A.X) / (len == 0 ? 1 : len);
                double dz = (s.B.Y - s.A.Y) / (len == 0 ? 1 : len);
                double off = s.Align == "left" ? s.Thickness / 2 : s.Align == "right" ? -s.Thickness / 2 : 0;
                double ox = dz * off, oz = -dx * off;
                double top = s.Y + s.Height;
                return new List<Measure>
                {
                    new Measure { Kind = "dim", A = V3(s.A.X + ox, top, s.A.Y + oz), B = V3(s.B.X + ox, top, s.B.Y + oz), Text = FormatLength(len) + " · sp. " + FormatLength(s.Thickness), Owner = s.Id },
                    new Measure { Kind = "dim", A = V3(s.A.X + ox, s.Y, s.A.Y + oz), B = V3(s.A.X + ox, top, s.A.Y + oz), Text = FormatLength(s.Height), Owner = s.Id },
                };
            }
            var pts = Structures.FloorPoints(s);
            var res = new List<Measure>();
            for (int i = 0; i < pts.Count; i++)
            {
                var p = pts[i];
                var q = pts[(i + 1) % pts.Count];
                res.Add(new Measure
                {
                    Kind = "dim", A = V3(p.X, s.Y + s.Thickness, p.Y), B = V3(q.X, s.Y + s.Thickness, q.Y),
                    Text = FormatLength(Math.Sqrt((q.X - p.X) * (q.X - p.X) + (q.Y - p.Y) * (q.Y - p.Y))), Owner = s.Id,
                });
            }
            double cx = pts.Sum(p => p.X) / pts.Count, cz = pts.Sum(p => p.Y) / pts.Count;
            res.Add(new Measure { Kind = "label", A = V3(cx, s.Y + s.Thickness, cz), B = V3(cx, s.Y + s.Thickness, cz), Text = FormatArea(Math.Abs(Structures.PolygonArea(pts))), Owner = s.Id });
            return res;
        }

        // Free distances from a solid to the next wall face or object in four directions (along the room's own directions, else
        // its own), and up to the ceiling / down to the floor.
        public static List<Measure> GapsOfSolid(Solid s, MeasureContext ctx)
        {
            double range = ctx.MaxRange ?? MaxRange;
            var e1 = ctx.Axes ?? s.U;
            var res = new List<Measure>();
            var corners = SolidSegs(s).Select(q => q.A).ToList();
            double yLine = s.Y0;   // the same height as the width and depth lines (the object's base)
            foreach (var d in new[] { e1, -e1, Perp(e1), -Perp(e1) })
            {
                var p = Perp(d);
                var pc = corners.Select(q => q.X * p.X + q.Z * p.Z).ToList();
                double pmin = pc.Min(), pmax = pc.Max();
                double bestT = 0;
                P2 bestFrom = default;
                bool found = false;
                // Rays across the side, and one from each corner: the nearest point of a turned object is a corner.
                var ts = new List<double>(pc);
                for (int k = 0; k < Samples; k++) ts.Add(pmin + ((k + 0.5) / Samples) * (pmax - pmin));
                foreach (var t in ts)
                {
                    // the far side of the solid in direction d, at this height across
                    double dmax = double.NegativeInfinity;
                    for (int i = 0; i < 4; i++)
                    {
                        var a = corners[i];
                        var b = corners[(i + 1) % 4];
                        double pa = a.X * p.X + a.Z * p.Z;
                        double pb = b.X * p.X + b.Z * p.Z;
                        // Parallel edges are skipped and the crossing test has a tolerance: the web version compares exactly, so for a
                        // solid whose axes are the measuring axes (corners with the same projection) the last bit of rounding
                        // decides which side counts as "far" and a ray can start from the back of the object.
                        if (Math.Abs(pa - pb) < Tie) continue;
                        if (t < Math.Min(pa, pb) - Tie || t > Math.Max(pa, pb) + Tie) continue;
                        double f = Math.Max(0, Math.Min(1, (t - pa) / (pb - pa)));
                        dmax = Math.Max(dmax, (a.X + (b.X - a.X) * f) * d.X + (a.Z + (b.Z - a.Z) * f) * d.Z);
                    }
                    if (double.IsNegativeInfinity(dmax)) continue;
                    var from = new P2(d.X * dmax + p.X * t, d.Z * dmax + p.Z * t);
                    var hit = Cast(from, d, ctx.Obstacles, s.Y0, s.Y1, s.Id);
                    if (hit != null && (!found || hit.Value < bestT)) { found = true; bestT = hit.Value; bestFrom = from; }
                }
                if (found && bestT > 0.005 && bestT <= range)
                {
                    res.Add(new Measure
                    {
                        Kind = "gap", A = V3(bestFrom.X, yLine, bestFrom.Z),
                        B = V3(bestFrom.X + d.X * bestT, yLine, bestFrom.Z + d.Z * bestT), Text = FormatLength(bestT), Owner = s.Id,
                    });
                }
            }
            if (ctx.Vertical && ctx.CeilingY != null)
            {
                double h = ctx.CeilingY.Value - s.Y1;
                if (h > 0.01 && h <= range)
                    res.Add(new Measure { Kind = "gap", A = V3(s.C.X, s.Y1, s.C.Z), B = V3(s.C.X, ctx.CeilingY.Value, s.C.Z), Text = FormatLength(h), Owner = s.Id });
            }
            if (ctx.Vertical && s.Y0 - ctx.FloorY > 0.02)
                res.Add(new Measure { Kind = "gap", A = V3(s.C.X, ctx.FloorY, s.C.Z), B = V3(s.C.X, s.Y0, s.C.Z), Text = FormatLength(s.Y0 - ctx.FloorY), Owner = s.Id });
            return res;
        }
    }
}
