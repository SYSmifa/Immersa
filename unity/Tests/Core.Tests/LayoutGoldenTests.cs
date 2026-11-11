using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Immersa.Core;
using Newtonsoft.Json.Linq;

namespace Immersa.Core.Tests
{
    // The C# layout against numbers computed by the web app itself (src/room/layout.ts) on random rooms and measures.
    // Regenerate the fixture with: npx tsx docs/test-plans/gen-layout-golden.mts
    internal static class LayoutGoldenTests
    {
        const double Eps = 1e-8;

        static void Near(double expected, double actual, string what)
        {
            if (Math.Abs(expected - actual) > Eps * Math.Max(1, Math.Abs(expected)))
                throw new Exception(what + ": web " + expected + " but C# " + actual);
        }

        static Pose PoseOf(JToken t) => new Pose((double)t["yaw"], (double)t["tx"], (double)t["ty"], (double)t["tz"]);
        static void SamePose(JToken e, Pose a, string what)
        {
            Near((double)e["yaw"], a.Yaw, what + ".yaw"); Near((double)e["tx"], a.Tx, what + ".tx");
            Near((double)e["ty"], a.Ty, what + ".ty"); Near((double)e["tz"], a.Tz, what + ".tz");
        }
        static Vec3 V(JToken t) => new Vec3((double)t[0], (double)t[1], (double)t[2]);
        static void SameVec(JToken e, Vec3 a, string what) { Near((double)e[0], a.X, what + ".x"); Near((double)e[1], a.Y, what + ".y"); Near((double)e[2], a.Z, what + ".z"); }

        static void SameLink(JToken e, RoomLink l, string what)
        {
            SamePose(e, Pose.Of(l), what);
            Near((double)e["at"], l.At, what + ".at");
            Assert.Equal((string)e["src"], l.Src, what + ".src");
            Assert.Equal(e["n"] == null ? (int?)null : (int)e["n"], l.N, what + ".n");
            Assert.Equal((string)e["sess"], l.Sess, what + ".sess");
            if (e["cand"] == null) Assert.True(l.Cand == null, what + ".cand should be absent");
            else
            {
                Assert.True(l.Cand != null, what + ".cand should be there");
                SamePose(e["cand"], Pose.Of(l.Cand), what + ".cand");
                Near((double)e["cand"]["at"], l.Cand.At, what + ".cand.at");
                Assert.Equal((int)e["cand"]["n"], l.Cand.N, what + ".cand.n");
                Assert.Equal((string)e["cand"]["sess"], l.Cand.Sess, what + ".cand.sess");
            }
        }

        static string StateName(LinkState s) => s.ToString().ToLowerInvariant();

        public static void All(Action<string, Action> run)
        {
            var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "layout-golden.json");
            var data = JObject.Parse(File.ReadAllText(path));

            run("layout vs web: pose algebra", () =>
            {
                foreach (var c in (JArray)data["poses"])
                {
                    var f = PoseOf(c["f"]); var g = PoseOf(c["g"]); var p = V(c["p"]);
                    SameVec(c["apply"], Layout.Apply(f, p), "apply");
                    SamePose(c["compose"], Layout.Compose(f, g), "compose");
                    SamePose(c["invert"], Layout.Invert(f), "invert");
                    SamePose(c["relative"], Layout.Relative(f, g), "relative");
                    var d = Layout.PoseDistance(f, g);
                    Near((double)c["distance"]["m"], d.m, "distance m"); Near((double)c["distance"]["rad"], d.rad, "distance rad");
                }
            });

            run("layout vs web: 30 random worlds (placement, summaries, containment, models changing room)", () =>
            {
                int moves = 0;
                foreach (var w in (JArray)data["worlds"])
                {
                    var rooms = Json.Parse<List<Room>>(w["rooms"].ToString());
                    var byId = rooms.ToDictionary(r => r.Id);
                    var current = byId[(string)w["current"]];
                    var members = w["members"].Select(i => byId[(string)i]).ToList();
                    var models = Json.Parse<List<RoomModel>>(w["models"].ToString());
                    var exp = w["expected"];

                    var around = Layout.PlaceAround(current, members);
                    var ea = (JArray)exp["around"];
                    Assert.Equal(ea.Count, around.Count, "around count");
                    Assert.Seq(ea.Select(x => (string)x["id"]), around.Keys, "around order");
                    foreach (var x in ea)
                    {
                        var got = around.Get((string)x["id"]);
                        SamePose(x["pose"], got.Pose, "around " + x["id"]);
                        Assert.Equal((string)x["state"], got.State.ToString().ToLowerInvariant(), "around state " + x["id"]);
                    }

                    var placed = new OrderedMap<Alignment>();
                    foreach (var x in (JArray)w["placed"]) placed.Set((string)x["id"], new Alignment { Yaw = (double)x["yaw"], Tx = (double)x["tx"], Ty = (double)x["ty"], Tz = (double)x["tz"] });
                    var byLinks = Layout.PlaceByLinks(members, placed);
                    var eb = (JArray)exp["byLinks"];
                    Assert.Equal(eb.Count, byLinks.Count, "byLinks count");
                    foreach (var x in eb) SamePose(x, Pose.Of(byLinks.Get((string)x["id"])), "byLinks " + x["id"]);

                    for (int i = 0; i < rooms.Count; i++)
                    {
                        var es = (JArray)exp["summary"][i];
                        var gs = Layout.LinkSummary(rooms[i], rooms);
                        Assert.Equal(es.Count, gs.Count, "summary count");
                        for (int k = 0; k < gs.Count; k++)
                        {
                            Assert.Equal((string)es[k]["name"], gs[k].Name, "summary name");
                            Assert.Equal((string)es[k]["state"], StateName(gs[k].State), "summary state");
                        }
                    }

                    foreach (var pr in (JArray)exp["points"])
                    {
                        var room = byId[(string)pr["room"]];
                        foreach (var q in (JArray)pr["pts"])
                            Assert.Equal((bool)q["in"], Layout.RoomContains(room, V(q["p"])), "roomContains " + room.Id);
                    }

                    var mv = Layout.PlanModelMoves(current, members, models);
                    var em = (JArray)exp["moves"];
                    Assert.Equal(em.Count, mv.moves.Count, "moves count");
                    for (int i = 0; i < em.Count; i++)
                    {
                        Assert.Equal((string)em[i]["model"], mv.moves[i].Model.Id, "move model");
                        Assert.Equal((string)em[i]["to"], mv.moves[i].To.Id, "move to");
                        SameVec(em[i]["pos"], mv.moves[i].Pos, "move pos");
                        Near((double)em[i]["yaw"], mv.moves[i].Yaw, "move yaw");
                    }
                    moves += em.Count;
                    var es2 = (JArray)exp["stay"];
                    Assert.Equal(es2.Count, mv.stay.Count, "stay count");
                    for (int i = 0; i < es2.Count; i++)
                    {
                        Assert.Equal((string)es2[i]["model"], mv.stay[i].Model.Id, "stay model");
                        Assert.Equal((string)es2[i]["why"], mv.stay[i].Why.ToString().ToLowerInvariant(), "stay why");
                    }
                }
                Assert.True(moves >= 2, "some models change room (" + moves + ")");
            });

            run("layout vs web: 70 random sequences of measures (guess, confirmed, candidate, discarded, by hand)", () =>
            {
                double now = (double)data["now"];
                var notes = new HashSet<string>();
                int s = 0;
                foreach (var seq in (JArray)data["sequences"])
                {
                    var A = new Room { Id = "A", Name = "A", Place = "Casa", CreatedAt = "", UpdatedAt = "", Scan = new RoomScan { Planes = new List<RoomPlane> { new RoomPlane { Label = "floor", Pos = new Vec3(0, 0, 0) } } } };
                    var B = new Room { Id = "B", Name = "B", Place = (string)seq["placeB"], CreatedAt = "", UpdatedAt = "", Scan = new RoomScan { Planes = new List<RoomPlane> { new RoomPlane { Label = "floor", Pos = new Vec3(0, 0, 0) } } } };
                    int i = 0;
                    foreach (var step in (JArray)seq["steps"])
                    {
                        string tag = "sequence " + s + " step " + i++;
                        var res = Layout.LearnedLinks(A, B, PoseOf(step["pa"]), PoseOf(step["pb"]), (string)step["src"], (string)step["sess"], (bool)step["together"], now);
                        var er = step["result"];
                        if (er.Type == JTokenType.Null) { Assert.True(res == null, tag + ": the web says nothing"); notes.Add("null"); continue; }
                        Assert.True(res != null, tag + ": the web has something to say");
                        Assert.Equal((string)er["note"], res.Note, tag + " note");
                        notes.Add(res.Note.Contains("scartata") ? "scartata" : res.Note);
                        if (er["links"].Type == JTokenType.Null) { Assert.True(res.Links == null, tag + ": nothing to write"); continue; }
                        Assert.True(res.Links != null, tag + ": links to write");
                        SameLink(er["links"][0], res.Links[0], tag + " link a");
                        SameLink(er["links"][1], res.Links[1], tag + " link b");
                        A.Scan.Links = new Dictionary<string, RoomLink>(A.Scan.Links ?? new Dictionary<string, RoomLink>()) { ["B"] = res.Links[0] };
                        B.Scan.Links = new Dictionary<string, RoomLink>(B.Scan.Links ?? new Dictionary<string, RoomLink>()) { ["A"] = res.Links[1] };
                    }
                    s++;
                }
                Assert.True(notes.Count >= 7, "the sequences exercise most branches (" + string.Join(" | ", notes) + ")");
            });
        }
    }
}
