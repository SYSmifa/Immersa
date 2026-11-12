using System;
using System.Collections.Generic;
using System.Linq;
using Immersa.Core;

namespace Immersa.Core.Tests
{
    // Tiny test runner without dependencies: each test throws on failure. Run: dotnet run --project unity/Tests/Core.Tests
    internal static class Program
    {
        static int failed;

        static void Run(string name, Action test)
        {
            try { test(); Console.WriteLine("ok    " + name); }
            catch (Exception e) { failed++; Console.WriteLine("FAIL  " + name + ": " + e.Message); }
        }

        static int Main()
        {
            PlacesTests.All(Run);
            JsonTests.All(Run);
            MeasureTests.All(Run);
            MeasureGoldenTests.All(Run);
            AnchorsTests.All(Run);
            LayoutTests.All(Run);
            LayoutGoldenTests.All(Run);
            AnnotationsTests.All(Run);
            PartsTests.All(Run);
            PartsGoldenTests.All(Run);
            PlaneAlignTests.All(Run);
            JsonCompareTests.All(Run);
            Console.WriteLine(failed == 0 ? "all ok" : failed + " failed");
            return failed == 0 ? 0 : 1;
        }
    }

    internal static class Assert
    {
        public static void Equal<T>(T expected, T actual, string what = "")
        {
            if (!EqualityComparer<T>.Default.Equals(expected, actual))
                throw new Exception(what + " expected <" + expected + "> but was <" + actual + ">");
        }

        public static void Seq(IEnumerable<string> expected, IEnumerable<string> actual, string what = "")
        {
            if (!expected.SequenceEqual(actual))
                throw new Exception(what + " expected [" + string.Join(", ", expected) + "] but was [" + string.Join(", ", actual) + "]");
        }

        public static void True(bool cond, string what = "") { if (!cond) throw new Exception(what + " expected true"); }
    }

    // Port of docs/test-plans/places.test.mts.
    internal static class PlacesTests
    {
        static Room R(string id, string place = null, string at = "2026-01-01T00:00:00Z") =>
            new Room { Id = id, Name = id.ToUpperInvariant(), CreatedAt = at, UpdatedAt = at, Scan = new RoomScan(), Place = place };

        static Project P(string id, params string[] roomIds) => new Project { Id = id, Name = "P" + id, RoomIds = roomIds.ToList() };

        public static void All(Action<string, Action> run)
        {
            var a1 = R("a1", "Casa mia", "2026-02-01T00:00:00Z");
            var a2 = R("a2", " casa MIA ", "2026-03-01T00:00:00Z");
            var b1 = R("b1", "Capannone");
            var n1 = R("n1");

            run("places: same place under different spellings counts once, newest spelling first", () =>
                Assert.Seq(new[] { "casa MIA", "Capannone" }, Places.Known(new[] { a1, a2, b1, n1 })));
            run("places: placeOfRooms", () =>
            {
                Assert.Equal("casa MIA", Places.OfRooms(new[] { a1, a2 }));
                Assert.Equal<string>(null, Places.OfRooms(new[] { a1, b1 }), "two places: none");
            });
            run("places: addRoomError", () =>
            {
                Assert.Equal("", Places.AddRoomError(new[] { a1 }, a2), "same place");
                Assert.True(Places.AddRoomError(new[] { a1 }, b1).Contains("un solo luogo"), "other place refused");
                Assert.True(Places.AddRoomError(new[] { a1 }, n1).Contains("non ha un luogo"), "room without a place");
                Assert.Equal("", Places.AddRoomError(new Room[0], b1), "first room: anything");
                Assert.Equal("", Places.AddRoomError(new[] { n1 }, b1), "no place yet in the project");
            });
            run("places: compatibleRooms", () =>
            {
                Assert.Seq(new[] { "a1", "a2", "n1" }, Places.Compatible(new[] { a1 }, new[] { a1, a2, b1, n1 }).Select(r => r.Id));
                Assert.Equal(2, Places.Compatible(new Room[0], new[] { a1, b1 }).Count);
            });
            run("places: placeChangeConflict", () =>
            {
                Assert.Equal("P1", Places.PlaceChangeConflict("a2", "Capannone", new[] { a1, a2, b1 }, new[] { P("1", "a1", "a2") }), "moving a2 would split project 1");
                Assert.Equal("", Places.PlaceChangeConflict("b1", "Casa mia", new[] { a1, a2, b1 }, new[] { P("2", "b1") }), "b1 is alone in its project");
            });
        }
    }

    // The saved JSON must read and write exactly like the web app's.
    internal static class JsonTests
    {
        const string RoomJson = @"{
          ""version"": 1, ""savedAt"": 1760000000000,
          ""planes"": [ { ""label"": ""wall"", ""pos"": [1, 1.2, -2], ""quat"": [0, 0.7071, 0, 0.7071], ""poly"": [0, 0, 2, 0, 2, 2] },
                        { ""label"": ""floor"", ""pos"": [0, 0, 0] } ],
          ""boxes"": [ { ""label"": ""table"", ""pos"": [1, 0, 1], ""quat"": [0, 0, 0, 1], ""min"": [-0.5, 0, -0.3], ""max"": [0.5, 0.8, 0.3] } ],
          ""links"": { ""r2"": { ""yaw"": 1.5, ""tx"": 3, ""ty"": 0, ""tz"": -4, ""at"": 1760000001000, ""src"": ""meta"", ""n"": 2, ""sess"": ""s1"",
                      ""cand"": { ""yaw"": 1.6, ""tx"": 3.1, ""ty"": 0, ""tz"": -4.1, ""at"": 1760000002000, ""n"": 1, ""sess"": ""s2"" } } },
          ""futureField"": { ""kept"": true }
        }";

        const string ModelJson = @"{
          ""id"": ""m1"", ""roomId"": ""r1"", ""name"": ""scatola"", ""source"": ""scatola.fbx"", ""path"": ""u1/abc.glb"",
          ""pos"": [1, 0, 2], ""yaw"": 0.5, ""tilt"": [0.1, -0.2], ""scale"": 1.5, ""color"": ""#ff8800"",
          ""materialColors"": { ""0"": ""#112233"" }, ""finish"": { ""roughness"": 0.4 },
          ""materialFinish"": { ""1"": { ""metalness"": 1 } },
          ""parts"": { ""0/2"": { ""d"": [0, 0.1, 0], ""yaw"": 0.3, ""scale"": 2, ""color"": ""#abcdef"", ""finish"": { ""roughness"": 0.9 } } }
        }";

        public static void All(Action<string, Action> run)
        {
            run("json: room scan reads like the web (arrays, optional fields, links)", () =>
            {
                var scan = Json.Parse<RoomScan>(RoomJson);
                Assert.Equal(2, scan.Planes.Count);
                Assert.Equal(1.2, scan.Planes[0].Pos.Y);
                Assert.Equal(0.7071, scan.Planes[0].Quat.Value.W);
                Assert.True(scan.Planes[1].Quat == null, "absent quat stays null");
                Assert.Equal(6, scan.Planes[0].Poly.Count);
                Assert.Equal(0.8, scan.Boxes[0].Max.Y);
                var link = scan.Links["r2"];
                Assert.Equal("meta", link.Src);
                Assert.Equal(2, link.N.Value);
                Assert.Equal(1.6, link.Cand.Yaw);
            });
            run("json: round trip keeps every value and the fields it does not know", () =>
            {
                var back = Json.Parse<RoomScan>(Json.Write(Json.Parse<RoomScan>(RoomJson)));
                Assert.Equal(1760000002000, back.Links["r2"].Cand.At);
                Assert.True(back.Extra.ContainsKey("futureField"), "unknown field kept");
                Assert.True((bool)back.Extra["futureField"]["kept"], "unknown field content kept");
                Assert.True(back.Planes[1].Quat == null && back.Boxes.Count == 1, "optional parts unchanged");
            });
            run("json: absent optional fields are not written", () =>
            {
                var text = Json.Write(new RoomModel { Id = "m", RoomId = "", Name = "n", Path = "p", Pos = new Vec3(0, 0, 0), Scale = 1 });
                Assert.True(!text.Contains("tilt") && !text.Contains("color") && !text.Contains("parts") && !text.Contains("null"), text);
                Assert.True(text.Contains("\"roomId\":\"\""), "empty roomId (free space) is kept");
            });
            run("json: model with colours, finish and part edits", () =>
            {
                var m = Json.Parse<RoomModel>(ModelJson);
                Assert.Equal(0.1, m.Tilt.Value.X);
                Assert.Equal(-0.2, m.Tilt.Value.Y);
                Assert.Equal("#112233", m.MaterialColors["0"]);
                Assert.Equal(1.0, m.MaterialFinish["1"].Metalness.Value);
                Assert.Equal(0.1, m.Parts["0/2"].D.Value.Y);
                Assert.Equal(2.0, m.Parts["0/2"].Scale.Value);
                var again = Json.Parse<RoomModel>(Json.Write(m));
                Assert.Equal(0.9, again.Parts["0/2"].Finish.Roughness.Value);
            });
            run("json: structures and annotations", () =>
            {
                var s = Json.Parse<Structure>(@"{ ""id"": ""s1"", ""roomId"": ""r1"", ""kind"": ""floor"", ""a"": [0, 0], ""b"": [2, 3], ""y"": 0, ""height"": 0, ""thickness"": 0.1,
                    ""pts"": [[0, 0], [2, 0], [2, 3]], ""xf"": { ""d"": [0.5, 0], ""yaw"": 0.2 } }");
                Assert.Equal(3, s.Pts.Count);
                Assert.Equal(3.0, s.B.Y);
                Assert.Equal(0.5, s.Xf.D.Value.X);
                Assert.True(s.Align == null && s.Texture == null, "absent stays null");
                var r = Json.Parse<Annotation>(@"{ ""id"": ""a1"", ""roomId"": """", ""kind"": ""ruler"", ""a"": [0, 0, 0], ""b"": [1, 0, 0], ""text"": ""x"", ""color"": ""#ffcc00"" }");
                Assert.Equal(1.0, r.B.Value.X);
                Assert.True(r.Scale == null, "scale absent");
            });
            run("json: project lists default to empty", () =>
            {
                var p = Json.Parse<Project>(@"{ ""id"": ""p"", ""name"": ""P"", ""updatedAt"": ""2026-01-01T00:00:00Z"", ""roomIds"": [""r1""], ""models"": [], ""structures"": [], ""annotations"": [] }");
                Assert.Equal(1, p.RoomIds.Count);
                Assert.True(p.Tone == null, "tone absent");
            });
            run("json: wrong array length is refused with a clear message", () =>
            {
                try { Json.Parse<RoomModel>(@"{ ""id"": ""m"", ""pos"": [1, 2] }"); throw new Exception("no error"); }
                catch (Newtonsoft.Json.JsonSerializationException e) { Assert.True(e.Message.Contains("Vec3 needs 3"), e.Message); }
            });
        }
    }
}
