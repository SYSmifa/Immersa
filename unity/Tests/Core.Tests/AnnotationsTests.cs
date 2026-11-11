using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Immersa.Core;
using Newtonsoft.Json.Linq;

namespace Immersa.Core.Tests
{
    // Ports of docs/test-plans/annotations.test.mts and wrap.test.mts, plus a comparison with numbers computed by the web app
    // (annotations-golden.json, regenerate with: npx tsx docs/test-plans/gen-annotations-golden.mts).
    internal static class AnnotationsTests
    {
        static double Width(string t, double px) => t.Length * px * 0.5;   // 17 px per character at 34 px
        const double Max = 348;

        static void Near(double expected, double actual, string what)
        {
            if (Math.Abs(expected - actual) > 1e-9 * Math.Max(1, Math.Abs(expected))) throw new Exception(what + ": web " + expected + " but C# " + actual);
        }

        static void SameVec(JToken e, Vec3 a, string what) { Near((double)e[0], a.X, what + ".x"); Near((double)e[1], a.Y, what + ".y"); Near((double)e[2], a.Z, what + ".z"); }

        public static void All(Action<string, Action> run)
        {
            run("annotations: a ruler (3-4-5), its label, name and drawing", () =>
            {
                var r = Annotations.New("ruler", "room1", new Vec3(0, 0, 0), new Vec3(3, 4, 0));
                Near(5, Annotations.Length(r).Value, "length");
                Assert.Equal("5,00 m", Annotations.Label(r));
                Assert.Equal("Metro 5,00 m", Annotations.Name(r));
                r.Text = "cavo";
                Assert.Equal("5,00 m · cavo", Annotations.Label(r));
                var m = Annotations.ToMeasures(r);
                Assert.Equal(6, m.Count(x => x.Kind == "pin"));
                var line = m.First(x => x.Kind == "ruler");
                Assert.Equal(new Vec3(0, 0, 0), line.A);
                Assert.Equal(new Vec3(3, 4, 0), line.B);
                Assert.Equal("5,00 m · cavo", line.Text);
                Assert.True(m.All(x => x.Owner == r.Id && x.Color == r.Color), "owner and colour");
            });
            run("annotations: a note, empty text still says something", () =>
            {
                var n = Annotations.New("note", "", new Vec3(1, 2, 3));
                Assert.True(Annotations.Length(n) == null, "a note has no length");
                Assert.Equal("Nota", Annotations.Label(n));
                n.Text = "  passa il cavo qui ";
                Assert.Equal("passa il cavo qui", Annotations.Label(n));
                Assert.Equal("Nota: passa il cavo qui", Annotations.Name(n));
                var nm = Annotations.ToMeasures(n);
                Assert.Equal(3, nm.Count(x => x.Kind == "pin"));
                Assert.Equal(new Vec3(1, 2, 3), nm.First(x => x.Kind == "note").A);
                var anchored = Annotations.ToMeasures(n, new Vec3(1, 0, 3));
                Assert.Equal(4, anchored.Count(x => x.Kind == "pin"));   // 3 for the cross on the floor + the wire up to the note
            });
            run("annotations: a copy keeps the content, gets its own id and shares nothing", () =>
            {
                var r = Annotations.New("ruler", "room1", new Vec3(0, 0, 0), new Vec3(3, 4, 0), "cavo");
                var c = Annotations.Copy(r, 1);
                Assert.True(c.Id != r.Id, "own id");
                Assert.Equal(r.Text, c.Text);
                Assert.Equal(r.A, c.A);
                c.Text = "altro";
                Assert.Equal("cavo", r.Text);
            });
            run("wrap: newlines, wrapping, long words, the limit of 8 lines", () =>
            {
                Assert.Seq(new[] { "Ciao" }, Annotations.WrapLines("Ciao", Width, Max), "short text stays one line");
                Assert.Seq(new[] { "uno", "due" }, Annotations.WrapLines("uno\ndue", Width, Max), "an explicit newline breaks");
                var lng = Annotations.WrapLines("questa nota è molto lunga e deve andare a capo da sola", Width, Max);
                Assert.True(lng.Count > 1 && lng.All(l => Width(l, 34) <= Max), "wrapped: " + string.Join("|", lng));
                var word = Annotations.WrapLines(new string('x', 60), Width, Max);
                Assert.True(word.Count > 1 && word.All(l => Width(l, 34) <= Max), "a very long word is cut");
                var many = Annotations.WrapLines(string.Join("\n", Enumerable.Range(0, 30).Select(i => "riga" + i)), Width, Max);
                Assert.Equal(8, many.Count, "at most 8 lines");
                Assert.True(many[7].EndsWith("…"), "ellipsis");
            });
            run("annotations vs web: 60 random notes and rulers (labels, names, drawing) and 80 texts to wrap", () =>
            {
                var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "annotations-golden.json");
                var data = JObject.Parse(File.ReadAllText(path));
                foreach (var e in (JArray)data["annotations"])
                {
                    var a = Json.Parse<Annotation>(e["annotation"].ToString());
                    string tag = "annotation " + a.Id;
                    if (e["length"].Type == JTokenType.Null) Assert.True(Annotations.Length(a) == null, tag + " no length");
                    else Near((double)e["length"], Annotations.Length(a).Value, tag + " length");
                    Assert.Equal((string)e["label"], Annotations.Label(a), tag + " label");
                    Assert.Equal((string)e["name"], Annotations.Name(a), tag + " name");
                    Vec3? anchor = e["anchor"].Type == JTokenType.Null ? (Vec3?)null : Json.Parse<Vec3>(e["anchor"].ToString());
                    var got = Annotations.ToMeasures(a, anchor);
                    var exp = (JArray)e["measures"];
                    Assert.Equal(exp.Count, got.Count, tag + " measures");
                    for (int i = 0; i < got.Count; i++)
                    {
                        Assert.Equal((string)exp[i]["kind"], got[i].Kind, tag + " kind " + i);
                        Assert.Equal((string)exp[i]["text"], got[i].Text, tag + " text " + i);
                        Assert.Equal((string)exp[i]["owner"], got[i].Owner, tag + " owner " + i);
                        Assert.Equal((string)exp[i]["color"], got[i].Color, tag + " color " + i);
                        SameVec(exp[i]["a"], got[i].A, tag + " a " + i);
                        SameVec(exp[i]["b"], got[i].B, tag + " b " + i);
                        if (exp[i]["scale"] == null) Assert.True(got[i].Scale == null, tag + " scale absent " + i);
                        else Near((double)exp[i]["scale"], got[i].Scale.Value, tag + " scale " + i);
                    }
                }
                foreach (var w in (JArray)data["wraps"])
                {
                    var lines = Annotations.WrapLines((string)w["text"], Width, (double)w["maxW"]);
                    var exp = w["lines"].Select(x => (string)x).ToList();
                    Assert.Seq(exp, lines, "wrap of \"" + ((string)w["text"]).Replace("\n", "\\n") + "\" at " + w["maxW"]);
                }
            });
        }
    }
}
