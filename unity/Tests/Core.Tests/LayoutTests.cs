using System;
using System.Collections.Generic;
using System.Linq;
using Immersa.Core;

namespace Immersa.Core.Tests
{
    // Port of docs/test-plans/layout.test.mts.
    internal static class LayoutTests
    {
        static bool Near(double a, double b, double eps = 1e-9) => Math.Abs(a - b) < eps;
        static void P3(Vec3 a, Vec3 b, string what, double eps = 1e-9) =>
            Assert.True(Near(a.X, b.X, eps) && Near(a.Y, b.Y, eps) && Near(a.Z, b.Z, eps), what + ": (" + a.X + "," + a.Y + "," + a.Z + ") vs (" + b.X + "," + b.Y + "," + b.Z + ")");

        static Room R(string id, string place, Dictionary<string, RoomLink> links = null) =>
            new Room { Id = id, Name = id, Place = place, CreatedAt = "", UpdatedAt = "", Scan = new RoomScan { Planes = new List<RoomPlane> { new RoomPlane { Label = "floor", Pos = new Vec3(0, 0, 0) } }, Links = links } };

        static Room WithLinks(Room r, RoomLink[] l, string other, bool second)
        {
            if (l == null) return r;
            var links = r.Scan.Links != null ? new Dictionary<string, RoomLink>(r.Scan.Links) : new Dictionary<string, RoomLink>();
            links[other] = l[second ? 1 : 0];
            return R(r.Id, r.Place, links);
        }

        static RoomLink L(double yaw, double tx, double ty, double tz, string src, int n) => new RoomLink { Yaw = yaw, Tx = tx, Ty = ty, Tz = tz, At = 0, Src = src, N = n };

        static OrderedMap<Alignment> Placed(string id, Pose p)
        {
            var m = new OrderedMap<Alignment>();
            m.Set(id, new Alignment { Yaw = p.Yaw, Tx = p.Tx, Ty = p.Ty, Tz = p.Tz });
            return m;
        }

        static Room BoxRoom(string id, Dictionary<string, RoomLink> links = null) => new Room
        {
            Id = id, Name = id, Place = "Casa", CreatedAt = "", UpdatedAt = "",
            Scan = new RoomScan
            {
                Planes = new List<RoomPlane>
                {
                    new RoomPlane { Label = "floor", Pos = new Vec3(0, 0, 0), Quat = new Quat(0, 0, 0, 1), Poly = new List<double> { -2.5, -2, 2.5, -2, 2.5, 2, -2.5, 2 } },
                    new RoomPlane { Label = "ceiling", Pos = new Vec3(0, 2.6, 0), Quat = new Quat(0, 0, 0, 1) },
                },
                Links = links,
            },
        };

        static RoomModel Mdl(string id, string room, Vec3 pos, double yaw = 0.4) => new RoomModel { Id = id, RoomId = room, Name = id, Path = "p", Pos = pos, Yaw = yaw, Scale = 1 };

        public static void All(Action<string, Action> run)
        {
            var f = new Pose(0.7, 1, 0.1, -2);
            var g = new Pose(-1.9, -3, 0.02, 0.5);
            var pt = new Vec3(1.2, 0.3, -0.8);

            run("layout: compose is apply twice, invert undoes", () =>
            {
                P3(Layout.Apply(Layout.Compose(f, g), pt), Layout.Apply(f, Layout.Apply(g, pt)), "compose");
                P3(Layout.Apply(Layout.Invert(f), Layout.Apply(f, pt)), pt, "invert");
            });

            run("layout: a link is a guess, then confirmed, discarded, replaced by hand", () =>
            {
                var sessionA = new Pose(0.3, 5, 0, 5);
                var bInA = new Pose(0, 6, 0, 0);
                var sessionB = Layout.Compose(sessionA, bInA);
                var wrongB = Layout.Compose(sessionA, new Pose(0, 7, 0, 0.4));   // the headset moved B by a metre in another session
                var A = R("A", "Casa");
                var B = R("B", "Casa");
                void Apply2(Learned l)
                {
                    Assert.True(l != null && l.Links != null, "something to write");
                    A = WithLinks(A, l.Links, "B", false);
                    B = WithLinks(B, l.Links, "A", true);
                }
                // 1. first measure from the headset: a guess, not used
                Apply2(Layout.LearnedLinks(A, B, sessionA, sessionB, "meta", "s1"));
                Assert.Equal(LinkState.Tentative, Layout.StateOf(A.Scan.Links["B"]));
                Assert.Equal(0, Layout.PlaceByLinks(new[] { A, B }, Placed("A", sessionA)).Count, "a guess places nothing");
                Assert.True(Layout.LearnedLinks(A, B, sessionA, sessionB, "meta", "s1") == null, "the same session counts once");
                // 2. the same in another session: confirmed, and then it places B
                Apply2(Layout.LearnedLinks(A, B, sessionA, sessionB, "meta", "s2"));
                Assert.Equal(LinkState.Confirmed, Layout.StateOf(A.Scan.Links["B"]));
                Assert.True(Layout.IsConfirmed(Layout.LinkBetween(B, A).Link), "seen from B too");
                var placed = Layout.PlaceByLinks(new[] { A, B }, Placed("A", sessionA));
                Assert.True(placed.Has("B"), "B placed from A");
                P3(Layout.Apply(Pose.Of(placed.Get("B")), new Vec3(0, 0, 0)), Layout.Apply(sessionB, new Vec3(0, 0, 0)), "B where it should be");
                // 3. a measure a metre off against a confirmed link is thrown away, with a note
                var l3 = Layout.LearnedLinks(A, B, sessionA, wrongB, "meta", "s3");
                Assert.True(l3 != null && l3.Links == null && l3.Note.Contains("scartata"), "discarded");
                // 5. scanned together: confirmed at once
                var tog = Layout.LearnedLinks(R("E", "Casa"), R("F", "Casa"), sessionA, sessionB, "meta", "s1", true);
                Assert.Equal(LinkState.Confirmed, Layout.StateOf(tog.Links[0]));
                // 6. by hand: trusted, replaces the headset's (even a confirmed one), and the headset never replaces it
                var l6 = Layout.LearnedLinks(A, B, sessionA, wrongB, "manual", "s4");
                Assert.True(l6 != null && l6.Links != null, "hand measure");
                A = WithLinks(A, l6.Links, "B", false);
                B = WithLinks(B, l6.Links, "A", true);
                Assert.Equal(LinkState.Manual, Layout.StateOf(A.Scan.Links["B"]));
                Assert.True(Near(A.Scan.Links["B"].Tx, 7, 1e-6), "tx 7");
                Assert.True(Layout.LearnedLinks(A, B, sessionA, sessionB, "meta", "s5") == null, "the headset does not replace a hand link");
                // 7. summaries for the lists
                var sum = Layout.LinkSummary(A, new[] { A, B, R("Z", "Altrove") });
                Assert.Equal(1, sum.Count);
                Assert.True(sum[0].Name == "B" && sum[0].State == LinkState.Manual, "summary");
                Assert.True(Near(Layout.Relative(sessionA, sessionB).Tx, 6, 1e-9), "relative");
            });

            run("layout: a guess against a different measure is a candidate; a later session that agrees wins", () =>
            {
                var C = R("C", "Casa");
                var D = R("D", "Casa");
                var sessionC = new Pose(-0.4, -2, 0, 3);
                var dRight = Layout.Compose(sessionC, new Pose(0, 4, 0, 0));
                var dWrong = Layout.Compose(sessionC, new Pose(0, 5.2, 0, 0));   // first session: the headset had it a metre off
                void Apply3(Learned r)
                {
                    Assert.True(r != null && r.Links != null, "something to write");
                    C = WithLinks(C, r.Links, "D", false);
                    D = WithLinks(D, r.Links, "C", true);
                }
                Apply3(Layout.LearnedLinks(C, D, sessionC, dWrong, "meta", "s1"));
                Apply3(Layout.LearnedLinks(C, D, sessionC, dRight, "meta", "s2"));   // differs: a candidate
                Assert.Equal(LinkState.Tentative, Layout.StateOf(C.Scan.Links["D"]));
                Assert.True(C.Scan.Links["D"].Cand != null, "candidate kept");
                Apply3(Layout.LearnedLinks(C, D, sessionC, dRight, "meta", "s3"));   // agrees with the candidate: it wins
                Assert.Equal(LinkState.Confirmed, Layout.StateOf(C.Scan.Links["D"]));
                Assert.True(Near(C.Scan.Links["D"].Tx, 4, 1e-9), "the repeated measure is the link");
            });

            run("layout: the editor's view: manual, tentative, and rooms put aside", () =>
            {
                var Bm = R("B", "Casa", new Dictionary<string, RoomLink> { ["A"] = L(0, -7, 0, 0, "manual", 2) });
                var Cg = R("C", "Casa", new Dictionary<string, RoomLink> { ["B"] = L(0, 0, 0, 4, "meta", 1) });
                var Dn = R("D", "Casa");
                var Am = R("A", "Casa", new Dictionary<string, RoomLink> { ["B"] = L(0, 7, 0, 0, "manual", 2) });
                var around = Layout.PlaceAround(Am, new[] { Am, Bm, Cg, Dn });
                Assert.Equal(PlaceState.Manual, around.Get("B").State);
                Assert.True(Near(around.Get("B").Pose.Tx, 7, 1e-6), "B where the hand link says");
                Assert.Equal(PlaceState.Tentative, around.Get("C").State, "the weakest link on the way counts");
                Assert.True(Near(around.Get("C").Pose.Tz, -4, 1e-6) && Near(around.Get("C").Pose.Tx, 7, 1e-6), "C is where the inverted link puts it: B is 4 m from C");
                Assert.Equal(PlaceState.Unknown, around.Get("D").State);
                Assert.True(around.Get("D").Pose.Tx > 2, "unknown rooms go aside, to the east");
            });

            run("layout: roomContains", () =>
            {
                var S = BoxRoom("S");
                Assert.True(Layout.RoomContains(S, new Vec3(0, 0, 0)), "inside");
                Assert.True(!Layout.RoomContains(S, new Vec3(3.5, 0, 0)), "outside");
                Assert.True(Layout.RoomContains(S, new Vec3(2.6, 0, 0)), "in the wall thickness");
                Assert.True(!Layout.RoomContains(S, new Vec3(0, 3.5, 0)), "above the ceiling");
            });

            run("layout: models change room only into a sure room", () =>
            {
                var S = BoxRoom("S", new Dictionary<string, RoomLink>
                {
                    ["K"] = L(0.3, 6, 0, 1, "meta", 2), ["T"] = L(0, -6, 0, 0, "meta", 1), ["X"] = L(0, 1, 0, 0, "meta", 2),
                });
                var K = BoxRoom("K");
                var inK = Layout.Apply(new Pose(0.3, 6, 0, 1), new Vec3(0.5, 0, -0.5));   // a point of K, in S's frame
                var o = Layout.PlanModelMoves(S, new[] { S, K }, new[] { Mdl("stays", "S", new Vec3(0, 0, 0)), Mdl("goes", "S", inK), Mdl("alone", "S", new Vec3(20, 0, 20)), Mdl("elsewhere", "Z", inK) });
                Assert.Seq(new[] { "goes" }, o.moves.Select(m => m.Model.Id), "only the model whose pivot left the room, into a sure room");
                P3(o.moves[0].Pos, new Vec3(0.5, 0, -0.5), "its pivot in K");
                Assert.True(Near(o.moves[0].Yaw, 0.4 + 0.3, 1e-9), "its yaw in K");
                Assert.Equal(0, o.stay.Count, "a pivot in no room, and models of other rooms, are left alone");
                var inT = Layout.Apply(new Pose(0, -6, 0, 0), new Vec3(0, 0, 0));
                var guess = Layout.PlanModelMoves(S, new[] { S, BoxRoom("T") }, new[] { Mdl("g", "S", inT) });
                Assert.True(guess.moves.Count == 0 && guess.stay[0].Why == StayWhy.Tentative, "a guess does not take a model");
                var S2 = BoxRoom("S2", new Dictionary<string, RoomLink> { ["X1"] = L(0, 6, 0, 0, "meta", 2), ["X2"] = L(0, 6.5, 0, 0, "meta", 2) });
                var both = Layout.PlanModelMoves(S2, new[] { S2, BoxRoom("X1"), BoxRoom("X2") }, new[] { Mdl("b", "S2", new Vec3(6, 0, 0)) });
                Assert.True(both.moves.Count == 0 && both.stay.Count == 1 && both.stay[0].Why == StayWhy.Ambiguous, "an overlap leaves the model, with a warning");
            });
        }
    }
}
