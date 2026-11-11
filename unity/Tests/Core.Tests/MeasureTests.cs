using System;
using System.Collections.Generic;
using System.Linq;
using Immersa.Core;

namespace Immersa.Core.Tests
{
    // Port of docs/test-plans/measure.test.mts (numbers worked out by hand, see the comments there).
    internal static class MeasureTests
    {
        static void Near(double a, double b, double eps = 1e-3) => Assert.True(Math.Abs(a - b) < eps, a + " is not " + b);

        static Structure Wall(string id, double ax, double az, double bx, double bz) =>
            new Structure { Id = id, RoomId = "r", Kind = "wall", A = new Vec2(ax, az), B = new Vec2(bx, bz), Y = 0, Height = 2.7, Thickness = 0.1 };

        static RoomModel Model(string id, double x, double y, double z, double yaw = 0) =>
            new RoomModel { Id = id, RoomId = "r", Name = id, Path = "x", Pos = new Vec3(x, y, z), Yaw = yaw, Scale = 1 };

        static readonly Vec3 Lo = new Vec3(-0.5, 0, -0.25);
        static readonly Vec3 Hi = new Vec3(0.5, 2, 0.25);   // 1 x 2 x 0.5 m

        static string[] Texts(IEnumerable<Measure> ms) => ms.Select(m => m.Text).OrderBy(t => t, StringComparer.Ordinal).ToArray();

        public static void All(Action<string, Action> run)
        {
            // A 5 x 4 m room, walls 10 cm thick centred on the lines: inner faces at x = 0.05 and 4.95, z = 0.05 and 3.95.
            var walls = new[] { Wall("w1", 0, 0, 5, 0), Wall("w2", 5, 0, 5, 4), Wall("w3", 5, 4, 0, 4), Wall("w4", 0, 4, 0, 0) };
            var wallFaces = walls.SelectMany(Measures.WallSegs).ToList();
            MeasureContext Ctx(Action<MeasureContext> tweak = null)
            {
                var c = new MeasureContext { Obstacles = wallFaces, Axes = Measures.RoomAxes(wallFaces), CeilingY = 2.7, FloorY = 0 };
                tweak?.Invoke(c);
                return c;
            }
            string[] Sorted(params string[] t) => t.OrderBy(x => x, StringComparer.Ordinal).ToArray();
            var a = Measures.ModelSolid(Model("a", 2, 0, 1.5), Lo, Hi);

            run("measure: formatting", () =>
            {
                Assert.Equal("1,24 m", Measures.FormatLength(1.236));
                Assert.Equal("85 cm", Measures.FormatLength(0.85));
                Assert.Equal("5,5 cm", Measures.FormatLength(0.055));
                Assert.Equal("8 mm", Measures.FormatLength(0.008));
                Assert.Equal("6,00 m²", Measures.FormatArea(6));
            });
            run("measure: a model on the room's axes: free distances to the walls and the ceiling", () =>
            {
                Near(a.Hu, 0.5);
                Near(a.Hv, 0.25);
                Assert.Seq(Sorted("1,20 m", "1,45 m", "2,20 m", "2,45 m", "70 cm"), Texts(Measures.GapsOfSolid(a, Ctx())));
            });
            run("measure: dimensions", () => Assert.Seq(new[] { "1,00 m", "50 cm", "2,00 m" }, Measures.DimsOfSolid(a).Select(m => m.Text)));
            run("measure: turned by 30 degrees, measured along the room's axes", () =>
            {
                var turned = Measures.ModelSolid(Model("t", 2, 0, 1.5, Math.PI / 6), Lo, Hi);
                var left = Measures.GapsOfSolid(turned, Ctx()).FirstOrDefault(m => !(m.A.X < m.B.X) && Math.Abs(m.A.Z - m.B.Z) < 1e-6 && m.B.X < m.A.X);
                Assert.True(left != null, "a gap towards -x");
                Near(Math.Abs(left.B.X - left.A.X), 2 - (0.5 * Math.Cos(Math.PI / 6) + 0.25 * Math.Sin(Math.PI / 6)) - 0.05);
            });
            run("measure: another object in the way: the gap is to its side", () =>
            {
                var b = Measures.ModelSolid(Model("b", 3.5, 0, 1.5), new Vec3(-0.2, 0, -0.25), new Vec3(0.2, 1.5, 0.25));
                var ctx = Ctx(c => c.Obstacles = wallFaces.Concat(Measures.SolidSegs(b)).ToList());
                Assert.True(Texts(Measures.GapsOfSolid(a, ctx)).Contains("80 cm"), "2.5 -> 3.3");
            });
            run("measure: an object that does not overlap in height is ignored", () =>
            {
                var raised = Measures.ModelSolid(Model("r", 2, 1.6, 1.5), Lo, Hi);
                var low = Measures.ModelSolid(Model("low", 3.5, 0, 1.5), new Vec3(-0.2, 0, -0.25), new Vec3(0.2, 1.5, 0.25));
                var g = Texts(Measures.GapsOfSolid(raised, Ctx(c => { c.Obstacles = wallFaces.Concat(Measures.SolidSegs(low)).ToList(); c.CeilingY = 4; })));
                Assert.True(g.Contains("2,45 m") && g.Contains("1,60 m"), string.Join(", ", g));
            });
            run("measure: a wall: length, thickness and height", () =>
                Assert.Seq(new[] { "5,00 m · sp. 10 cm", "2,70 m" }, Measures.DimsOfStructure(walls[0]).Select(m => m.Text)));
            run("measure: roomAxes is the longest wall's direction", () =>
            {
                var ax = Measures.RoomAxes(wallFaces).Value;
                Near(Math.Abs(ax.X) + Math.Abs(ax.Z), 1);
            });
            run("measure: a wall plane of the scan is a face 4 m long, 2.7 m high, at x = 0", () =>
            {
                double s = Math.Sin(-Math.PI / 4), c = Math.Cos(-Math.PI / 4);   // about z by -90 degrees
                var plane = new RoomPlane { Label = "wall", Pos = new Vec3(0, 1.35, 2), Quat = new Quat(0, 0, s, c), Poly = new List<double> { -1.35, -2, 1.35, -2, 1.35, 2, -1.35, 2 } };
                var seg = Measures.PlaneSeg(plane, 0);
                Assert.True(seg != null, "a vertical plane gives a wall face");
                Near(Math.Sqrt(Math.Pow(seg.B.X - seg.A.X, 2) + Math.Pow(seg.B.Z - seg.A.Z, 2)), 4);
                Near(seg.Y1 - seg.Y0, 2.7);
                Near(seg.A.X, 0);
                Assert.True(Measures.PlaneSeg(new RoomPlane { Label = "floor", Pos = new Vec3(0, 0, 0), Quat = new Quat(0, 0, 0, 1), Poly = plane.Poly }, 1) == null, "a floor is not a wall");
            });
            run("measure: a furniture box of the scan, turned 90 degrees about y", () =>
            {
                var bs = Measures.BoxSolid(new RoomBox { Label = "table", Pos = new Vec3(1, 0, 1), Quat = new Quat(0, Math.Sin(Math.PI / 4), 0, Math.Cos(Math.PI / 4)), Min = new Vec3(-1, 0, -0.5), Max = new Vec3(1, 0.8, 0.5) }, 0);
                Near(bs.Hu, 1);
                Near(bs.Hv, 0.5);
                Near(bs.Y1, 0.8);
            });
            run("measure: the height line stands where the width and the depth meet", () =>
            {
                var d = Measures.DimsOfSolid(a);
                Assert.Equal(d[0].B, d[1].A);
                Assert.Equal(d[2].A, d[1].A);
            });
            run("measure: walls only, no vertical distances", () =>
                Assert.Seq(Sorted("1,20 m", "1,45 m", "2,20 m", "2,45 m"), Texts(Measures.GapsOfSolid(a, Ctx(c => { c.Vertical = false; c.CeilingY = null; })))));
            run("measure: the distances to the walls lie at the base height", () =>
            {
                double y = Measures.DimsOfSolid(a)[0].A.Y;
                foreach (var m in Measures.GapsOfSolid(a, Ctx(c => { c.Vertical = false; c.CeilingY = null; })))
                    Assert.True(Math.Abs(m.A.Y - y) < 1e-9 && Math.Abs(m.B.Y - y) < 1e-9, "gap line height");
            });
            run("measure: a floor gives its edges and its area", () =>
            {
                var floor = new Structure { Id = "f", RoomId = "r", Kind = "floor", A = new Vec2(0, 0), B = new Vec2(3, 2), Y = 0, Thickness = 0.1 };
                var d = Measures.DimsOfStructure(floor);
                Assert.Equal(5, d.Count);
                Assert.Equal("6,00 m²", d[4].Text);
                Assert.Equal("3,00 m", d[0].Text);
            });
            run("measure: a turned object measured along its own axes is symmetric in a centred, symmetric room", () =>
            {
                // No room axes: the object's own axes are used, so its corners tie with the measuring axes. The web's
                // exact comparison is noisy there; this port must give the same distance both ways, and the same on both sides.
                var sq = new[] { Wall("n", 0, 0, 4, 0), Wall("e", 4, 0, 4, 4), Wall("s", 4, 4, 0, 4), Wall("w", 0, 4, 0, 0) };
                var faces = sq.SelectMany(Measures.WallSegs).ToList();
                foreach (var yaw in new[] { 0.3, 0.7, 1.1, 2.0, 2.9 })
                {
                    var s = Measures.ModelSolid(Model("c", 2, 0, 2, yaw), Lo, Hi);
                    var g = Measures.GapsOfSolid(s, new MeasureContext { Obstacles = faces, Axes = null, CeilingY = null, FloorY = 0, Vertical = false });
                    Assert.Equal(4, g.Count, "four distances at yaw " + yaw);
                    Assert.Equal(g[0].Text, g[1].Text, "+u and -u at yaw " + yaw);
                    Assert.Equal(g[2].Text, g[3].Text, "+v and -v at yaw " + yaw);
                }
            });
            run("structures: headset move/turn/scale is applied about the pivot", () =>
            {
                var w = Wall("w", 0, 0, 2, 0);
                w.Xf = new StructureMove { D = new Vec2(1, 1), Scale = 2 };
                var e = Structures.Effective(w);
                // pivot (1, 0): the line 0..2 becomes -1..3 on x (scale 2 about 1), then moved by (1, 1)
                Near(e.A.X, 0); Near(e.B.X, 4); Near(e.A.Y, 1);
                Near(e.Height, 5.4);
            });
        }
    }
}
