using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Immersa.Core;
using Newtonsoft.Json.Linq;

namespace Immersa.Core.Tests
{
    // The C# port against numbers computed by the web app itself (src/room/measure.ts) on random rooms.
    // Regenerate the fixture with: npx tsx docs/test-plans/gen-measure-golden.mts
    internal static class MeasureGoldenTests
    {
        const double Eps = 1e-8;

        static void Near(double expected, double actual, string what)
        {
            if (Math.Abs(expected - actual) > Eps * Math.Max(1, Math.Abs(expected)))
                throw new Exception(what + ": web " + expected + " but C# " + actual);
        }

        static void P(JToken t, P2 actual, string what) { Near((double)t[0], actual.X, what + ".x"); Near((double)t[1], actual.Z, what + ".z"); }
        static void V(JToken t, Vec3 actual, string what) { Near((double)t[0], actual.X, what + ".x"); Near((double)t[1], actual.Y, what + ".y"); Near((double)t[2], actual.Z, what + ".z"); }

        static void CompareSegs(JToken expected, IReadOnlyList<Seg> actual, string what)
        {
            Assert.Equal(expected.Count(), actual.Count, what + " count");
            for (int i = 0; i < actual.Count; i++)
            {
                var e = expected[i];
                P(e["a"], actual[i].A, what + "[" + i + "].a");
                P(e["b"], actual[i].B, what + "[" + i + "].b");
                Near((double)e["y0"], actual[i].Y0, what + "[" + i + "].y0");
                Near((double)e["y1"], actual[i].Y1, what + "[" + i + "].y1");
                Assert.Equal((string)e["owner"], actual[i].Owner, what + "[" + i + "].owner");
            }
        }

        static void CompareMeasures(JToken expected, IReadOnlyList<Measure> actual, string what)
        {
            string both = " (web: " + string.Join(" | ", expected.Select(x => (string)x["text"])) + "; C#: " + string.Join(" | ", actual.Select(x => x.Text)) + ")";
            Assert.Equal(expected.Count(), actual.Count, what + " count" + both);
            for (int i = 0; i < actual.Count; i++)
            {
                var e = expected[i];
                Assert.Equal((string)e["kind"], actual[i].Kind, what + "[" + i + "].kind");
                Assert.Equal((string)e["text"], actual[i].Text, what + "[" + i + "].text" + both);
                Assert.Equal((string)e["owner"], actual[i].Owner, what + "[" + i + "].owner");
                V(e["a"], actual[i].A, what + "[" + i + "].a");
                V(e["b"], actual[i].B, what + "[" + i + "].b");
            }
        }

        static void CompareSolid(JToken e, Solid s, string what)
        {
            Assert.Equal((string)e["id"], s.Id, what + ".id");
            P(e["c"], s.C, what + ".c");
            P(e["u"], s.U, what + ".u");
            Near((double)e["hu"], s.Hu, what + ".hu");
            Near((double)e["hv"], s.Hv, what + ".hv");
            Near((double)e["y0"], s.Y0, what + ".y0");
            Near((double)e["y1"], s.Y1, what + ".y1");
        }

        public static void All(Action<string, Action> run)
        {
            run("measure vs web: 25 random rooms give the same faces, solids, dimensions and distances", () =>
            {
                var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "measure-golden.json");
                var scenarios = (JArray)JObject.Parse(File.ReadAllText(path))["scenarios"];
                int checkedGaps = 0;
                for (int n = 0; n < scenarios.Count; n++)
                {
                    var inp = scenarios[n]["input"];
                    var exp = scenarios[n]["expected"];
                    string tag = "scenario " + n;
                    var walls = Json.Parse<List<Structure>>(inp["walls"].ToString());
                    var floors = Json.Parse<List<Structure>>(inp["floors"].ToString());
                    var planes = Json.Parse<List<RoomPlane>>(inp["planes"].ToString());
                    var boxes = Json.Parse<List<RoomBox>>(inp["boxes"].ToString());
                    var models = ((JArray)inp["models"]).Select(m => (
                        model: Json.Parse<RoomModel>(m["model"].ToString()),
                        lo: Json.Parse<Vec3>(m["lo"].ToString()),
                        hi: Json.Parse<Vec3>(m["hi"].ToString()))).ToList();

                    var wallFaces = walls.SelectMany(Measures.WallSegs).ToList();
                    CompareSegs(exp["wallFaces"], wallFaces, tag + " wallFaces");

                    var planeSegs = planes.Select((p, i) => Measures.PlaneSeg(p, i)).ToList();
                    var expPlane = (JArray)exp["planeSegs"];
                    Assert.Equal(expPlane.Count, planeSegs.Count, tag + " planeSegs count");
                    for (int i = 0; i < planeSegs.Count; i++)
                    {
                        if (expPlane[i].Type == JTokenType.Null) { Assert.True(planeSegs[i] == null, tag + " plane " + i + " should give no face"); continue; }
                        Assert.True(planeSegs[i] != null, tag + " plane " + i + " should give a face");
                        CompareSegs(new JArray(expPlane[i]), new[] { planeSegs[i] }, tag + " plane " + i);
                    }

                    // Walls of equal length (opposite sides of a room) tie, and which one wins depends on the last bit of the length
                    // (JavaScript's hypot and C#'s sqrt differ there): the direction can come out turned by 180 degrees. Both are the
                    // same axis, so check it up to sign, and give the distances the web's own axes so the lists compare one to one.
                    var axes = Measures.RoomAxes(wallFaces);
                    P2? webAxes = null;
                    if (exp["roomAxes"].Type == JTokenType.Null) Assert.True(axes == null, tag + " axes null");
                    else
                    {
                        Assert.True(axes != null, tag + " axes");
                        webAxes = new P2((double)exp["roomAxes"][0], (double)exp["roomAxes"][1]);
                        Near(1, Math.Abs(webAxes.Value.X * axes.Value.X + webAxes.Value.Z * axes.Value.Z), tag + " axes parallel");
                    }

                    var solids = models.Select(m => Measures.ModelSolid(m.model, m.lo, m.hi)).Concat(boxes.Select((b, i) => Measures.BoxSolid(b, i))).ToList();
                    var expSolids = (JArray)exp["solids"];
                    Assert.Equal(expSolids.Count, solids.Count, tag + " solids");
                    for (int i = 0; i < solids.Count; i++) CompareSolid(expSolids[i], solids[i], tag + " solid " + i);

                    var obstacles = wallFaces.Concat(planeSegs.Where(s => s != null)).Concat(solids.SelectMany(Measures.SolidSegs)).ToList();
                    var ctx = new MeasureContext
                    {
                        Obstacles = obstacles,
                        Axes = (string)inp["axesMode"] == "room" ? webAxes : null,
                        CeilingY = Measures.CeilingYOf(planes),
                        FloorY = Measures.FloorYOf(planes),
                        Vertical = (bool)inp["vertical"],
                        MaxRange = inp["maxRange"].Type == JTokenType.Null ? (double?)null : (double)inp["maxRange"],
                    };
                    Near((double)exp["floorY"], ctx.FloorY, tag + " floorY");
                    for (int i = 0; i < solids.Count; i++)
                    {
                        CompareMeasures(exp["dims"][i], Measures.DimsOfSolid(solids[i]), tag + " dims " + i);
                        var gaps = Measures.GapsOfSolid(solids[i], ctx);
                        // Measured along the object's own axes (no room axes) the web's result depends on rounding noise (see
                        // Measure.cs): only check the distances when the axes are the room's.
                        if (webAxes != null && (string)inp["axesMode"] == "room")
                        {
                            CompareMeasures(exp["gaps"][i], gaps, tag + " gaps " + i);
                            checkedGaps += gaps.Count;
                        }
                        else foreach (var m in gaps) Assert.True(m.Text.Length > 0, "a distance has a text");
                    }
                    var structs = walls.Concat(floors).ToList();
                    for (int i = 0; i < structs.Count; i++) CompareMeasures(exp["structDims"][i], Measures.DimsOfStructure(structs[i]), tag + " struct " + i);
                }
                Assert.True(checkedGaps > 100, "the scenarios exercise enough distances (" + checkedGaps + ")");
            });
        }
    }
}
