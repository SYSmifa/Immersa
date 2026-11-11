using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Immersa.Core;
using Newtonsoft.Json.Linq;

namespace Immersa.Core.Tests
{
    // Port of docs/test-plans/anchors.test.mts, plus a comparison with numbers computed by the web app (anchors-golden.json,
    // regenerate with: npx tsx docs/test-plans/gen-anchors-golden.mts).
    internal static class AnchorsTests
    {
        static void Near(double a, double b, string what, double eps = 1e-6)
        {
            if (Math.Abs(a - b) > eps * Math.Max(1, Math.Abs(a))) throw new Exception(what + ": " + a + " vs " + b);
        }

        // A wall plane at `pos`, facing `normal` (horizontal), 2.5 m high and `len` long. The plane's local Y points along `normal`.
        static RoomPlane Wall(Vec3 pos, Vec3 normal, double len)
        {
            // rotation taking (0,1,0) to the horizontal `normal`: about the axis (nz, 0, -nx) by 90 degrees
            double s = Math.Sqrt(0.5);
            var q = new Quat(normal.Z * s, 0, -normal.X * s, s);
            return new RoomPlane { Label = "wall", Pos = pos, Quat = q, Poly = new List<double> { -len / 2, -1.25, len / 2, -1.25, len / 2, 1.25, -len / 2, 1.25 } };
        }

        public static void All(Action<string, Action> run)
        {
            // A 5 x 3 m room: north (z = -1.5) faces +z, south faces -z, east faces -x, west faces +x.
            var room = new List<RoomPlane>
            {
                Wall(new Vec3(0, 1.25, -1.5), new Vec3(0, 0, 1), 5),
                Wall(new Vec3(0, 1.25, 1.5), new Vec3(0, 0, -1), 5),
                Wall(new Vec3(2.5, 1.25, 0), new Vec3(-1, 0, 0), 3),
                Wall(new Vec3(-2.5, 1.25, 0), new Vec3(1, 0, 0), 3),
                new RoomPlane { Label = "floor", Pos = new Vec3(0, 0.02, 0), Quat = new Quat(0, 0, 0, 1), Poly = new List<double> { -2.5, -1.5, 2.5, -1.5, 2.5, 1.5, -2.5, 1.5 } },
            };

            run("anchors: the corners suggested for a 5 x 3 m room are the far ones", () =>
            {
                var plan = Anchors.SuggestCorners(room);
                Assert.True(plan != null, "corners found");
                double d = Math.Sqrt(Math.Pow(plan.A.X - plan.B.X, 2) + Math.Pow(plan.A.Z - plan.B.Z, 2));
                Near(Math.Sqrt(34), d, "the diagonal", 0.05);
                Near(0.02, plan.FloorY, "floor height");
                Assert.Equal(4, plan.Segs.Count);
            });
            run("anchors: touching the corners at a known pose gives that pose back", () =>
            {
                var plan = Anchors.SuggestCorners(room);
                double yaw = Math.PI / 6;
                Vec3 Put(Vec3 p) => new Vec3(Math.Cos(yaw) * p.X - Math.Sin(yaw) * p.Z + 1, p.Y + 0.1, Math.Sin(yaw) * p.X + Math.Cos(yaw) * p.Z - 2);
                var r = Anchors.AlignFromTouches(plan.A, plan.B, Put(plan.A), Put(plan.B), 0.12);
                Assert.True(r.Ok, "consistent touches");
                Near(yaw, r.Alignment.Yaw, "yaw");
                Near(1, r.Alignment.Tx, "tx");
                Near(-2, r.Alignment.Tz, "tz");
                Near(0.1, r.Alignment.Ty, "ty");
                var off = Put(plan.B);
                off = new Vec3(off.X + 0.03, off.Y, off.Z);
                Assert.True(Anchors.AlignFromTouches(plan.A, plan.B, Put(plan.A), off, null).Ok, "3 cm off is still fine");
                var near = Anchors.AlignFromTouches(plan.A, plan.B, Put(plan.A), Put(new Vec3(plan.A.X + 2, 0, plan.A.Z)), null);
                Assert.True(!near.Ok, "wrong corner caught");
            });
            run("anchors: a room with no usable walls gives no corners", () =>
            {
                Assert.True(Anchors.SuggestCorners(new List<RoomPlane>()) == null, "empty");
                Assert.True(Anchors.SuggestCorners(new List<RoomPlane> { room[4] }) == null, "floor only");
                Assert.True(Anchors.SuggestCorners(new List<RoomPlane> { room[0], room[1] }) == null, "parallel walls make no corner");
            });
            run("anchors vs web: 25 random rooms give the same corners, plan and alignment", () =>
            {
                var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "anchors-golden.json");
                var scenarios = (JArray)JObject.Parse(File.ReadAllText(path))["scenarios"];
                int withCorners = 0, wrong = 0;
                for (int n = 0; n < scenarios.Count; n++)
                {
                    string tag = "scenario " + n;
                    var planes = Json.Parse<List<RoomPlane>>(scenarios[n]["planes"].ToString());
                    var exp = scenarios[n]["expected"];
                    Near((double)exp["floorHeight"], Anchors.FloorHeight(planes), tag + " floorHeight");
                    var plan = Anchors.SuggestCorners(planes);
                    if (exp["plan"].Type == JTokenType.Null) { Assert.True(plan == null, tag + ": no corners in the web"); continue; }
                    Assert.True(plan != null, tag + ": the web finds corners");
                    withCorners++;
                    var ep = exp["plan"];
                    Near((double)ep["a"][0], plan.A.X, tag + " a.x"); Near((double)ep["a"][1], plan.A.Y, tag + " a.y"); Near((double)ep["a"][2], plan.A.Z, tag + " a.z");
                    Near((double)ep["b"][0], plan.B.X, tag + " b.x"); Near((double)ep["b"][1], plan.B.Y, tag + " b.y"); Near((double)ep["b"][2], plan.B.Z, tag + " b.z");
                    Near((double)ep["floorY"], plan.FloorY, tag + " floorY");
                    var es = (JArray)ep["segs"];
                    Assert.Equal(es.Count, plan.Segs.Count, tag + " segs");
                    for (int i = 0; i < es.Count; i++)
                    {
                        Assert.Equal((string)es[i]["kind"], plan.Segs[i].Kind, tag + " seg kind");
                        Near((double)es[i]["x1"], plan.Segs[i].X1, tag + " seg x1"); Near((double)es[i]["z1"], plan.Segs[i].Z1, tag + " seg z1");
                        Near((double)es[i]["x2"], plan.Segs[i].X2, tag + " seg x2"); Near((double)es[i]["z2"], plan.Segs[i].Z2, tag + " seg z2");
                    }
                    var t = exp["touches"];
                    var res = Anchors.AlignFromTouches(plan.A, plan.B, Json.Parse<Vec3>(t["ta"].ToString()), Json.Parse<Vec3>(t["tb"].ToString()),
                        t["floorLive"].Type == JTokenType.Null ? (double?)null : (double)t["floorLive"]);
                    var er = t["result"];
                    Assert.Equal((bool)er["ok"], res.Ok, tag + " ok");
                    if (!res.Ok) wrong++;
                    Near((double)er["expected"], res.Expected, tag + " expected"); Near((double)er["measured"], res.Measured, tag + " measured");
                    var ea = er["alignment"];
                    Near((double)ea["yaw"], res.Alignment.Yaw, tag + " yaw"); Near((double)ea["tx"], res.Alignment.Tx, tag + " tx");
                    Near((double)ea["ty"], res.Alignment.Ty, tag + " ty"); Near((double)ea["tz"], res.Alignment.Tz, tag + " tz");
                    Near((double)ea["resid"], res.Alignment.Resid, tag + " resid");
                }
                Assert.True(withCorners >= 20, "most rooms give corners (" + withCorners + ")");
                Assert.True(wrong >= 1, "some wrong touches are caught (" + wrong + ")");
            });
        }
    }
}
