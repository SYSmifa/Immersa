using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Immersa.Core
{
    // Port of src/room/annotations.ts (+ wrapLines from measureView.ts): notes and rulers left in a project, what they look like
    // as data, and how they turn into things to draw (the same lines and labels as the measures, see Measure.cs). Pure, no drawing.
    public static class Annotations
    {
        public static readonly string[] Colors = { "#ffb020", "#2dd4bf", "#ff6b6b", "#8b9cff" };
        public static string DefaultColor => Colors[0];
        const double Pin = 0.04;       // m, half size of the cross that marks a point

        static readonly Random Rng = new Random();
        const string Base36 = "0123456789abcdefghijklmnopqrstuvwxyz";

        static string ToBase36(long n)
        {
            if (n == 0) return "0";
            var s = "";
            while (n > 0) { s = Base36[(int)(n % 36)] + s; n /= 36; }
            return s;
        }

        static string NewId()
        {
            var tail = new string(Enumerable.Range(0, 4).Select(_ => Base36[Rng.Next(36)]).ToArray());
            return "a" + ToBase36(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) + tail;
        }

        public static Annotation New(string kind, string roomId, Vec3 a, Vec3? b = null, string text = "", string id = null) => new Annotation
        {
            Id = id ?? NewId(), RoomId = roomId, Kind = kind, A = a, B = kind == "ruler" ? b : null, Text = text, Color = DefaultColor,
        };

        // A ruler's length in metres; null for a note.
        public static double? Length(Annotation a) =>
            a.Kind == "ruler" && a.B != null
                ? Math.Sqrt(Math.Pow(a.B.Value.X - a.A.X, 2) + Math.Pow(a.B.Value.Y - a.A.Y, 2) + Math.Pow(a.B.Value.Z - a.A.Z, 2))
                : (double?)null;

        // What its label says: the length (and the text, if any) for a ruler, the text for a note.
        public static string Label(Annotation a)
        {
            var len = Length(a);
            var text = (a.Text ?? "").Trim();
            if (len == null) return text.Length > 0 ? text : "Nota";
            return text.Length > 0 ? Measures.FormatLength(len.Value) + " · " + text : Measures.FormatLength(len.Value);
        }

        // The name it has in lists.
        public static string Name(Annotation a)
        {
            if (a.Kind == "ruler") return "Metro " + Measures.FormatLength(Length(a) ?? 0);
            var text = (a.Text ?? "").Trim();
            if (text.Length == 0) return "Nota";
            var one = Regex.Replace(text, @"\s+", " ");
            return "Nota: " + one.Substring(0, Math.Min(24, one.Length));
        }

        static List<Measure> Cross(Vec3 p, string owner, string color)
        {
            Measure Seg(double dx, double dy, double dz) => new Measure
            {
                Kind = "pin", A = new Vec3(p.X - dx, p.Y - dy, p.Z - dz), B = new Vec3(p.X + dx, p.Y + dy, p.Z + dz), Text = "", Owner = owner, Color = color,
            };
            return new List<Measure> { Seg(Pin, 0, 0), Seg(0, Pin, 0), Seg(0, 0, Pin) };
        }

        // Things to draw for one annotation, in its room's frame.
        // anchor: for a note, the point on the floor or on the first object under it (a cross there, and a wire up to the note).
        public static List<Measure> ToMeasures(Annotation a, Vec3? anchor = null)
        {
            var color = string.IsNullOrEmpty(a.Color) ? DefaultColor : a.Color;
            if (a.Kind == "note" || a.B == null)
            {
                Vec3? foot = null;
                if (anchor != null)
                {
                    var d = Math.Sqrt(Math.Pow(anchor.Value.X - a.A.X, 2) + Math.Pow(anchor.Value.Y - a.A.Y, 2) + Math.Pow(anchor.Value.Z - a.A.Z, 2));
                    if (d > 0.02) foot = anchor;
                }
                var res = Cross(foot ?? a.A, a.Id, color);
                if (foot != null) res.Add(new Measure { Kind = "pin", A = foot.Value, B = a.A, Text = "", Owner = a.Id, Color = color });
                res.Add(new Measure { Kind = "note", A = a.A, B = a.A, Text = Label(a), Owner = a.Id, Color = color, Scale = a.Scale != null && a.Scale != 0 && a.Scale != 1 ? a.Scale : null });
                return res;
            }
            var list = Cross(a.A, a.Id, color);
            list.AddRange(Cross(a.B.Value, a.Id, color));
            list.Add(new Measure { Kind = "ruler", A = a.A, B = a.B.Value, Text = Label(a), Owner = a.Id, Color = color });
            return list;
        }

        // A copy for another project: new id, same content (nothing shared with the original).
        public static Annotation Copy(Annotation a, int i = 0, string id = null)
        {
            var c = Json.Parse<Annotation>(Json.Write(a));
            c.Id = id ?? NewId() + i;
            return c;
        }

        // ---- label line breaking (measureView.ts) ----

        public const int LinePx = 34;  // font size of a line in a note with several lines
        public const int MaxLines = 8;

        // Breaks a label into lines: where the text has a newline, and between words (or inside a very long one) when a line would
        // be wider than maxW. width(text, fontPx) measures. A single short line comes back as it is.
        public static List<string> WrapLines(string text, Func<string, double, double> width, double maxW)
        {
            var one = text.Split('\n').Select(t => t.Trim()).ToList();
            if (one.Count == 1 && width(one[0], 38) <= maxW) return one; // fits at the normal size
            var res = new List<string>();
            foreach (var para in one)
            {
                var line = "";
                foreach (var word in Regex.Split(para, @"\s+").Where(s => s.Length > 0))
                {
                    var w = word;
                    while (width(w, LinePx) > maxW && w.Length > 1)
                    {
                        // a word longer than a line: cut it where it still fits
                        int n = w.Length - 1;
                        while (n > 1 && width(w.Substring(0, n), LinePx) > maxW) n--;
                        if (line.Length > 0) res.Add(line);
                        res.Add(w.Substring(0, n));
                        line = "";
                        w = w.Substring(n);
                    }
                    var next = line.Length > 0 ? line + " " + w : w;
                    if (line.Length > 0 && width(next, LinePx) > maxW) { res.Add(line); line = w; }
                    else line = next;
                }
                res.Add(line);
            }
            if (res.Count > MaxLines)
            {
                res.RemoveRange(MaxLines, res.Count - MaxLines);
                var last = res[MaxLines - 1];
                res[MaxLines - 1] = (last.Length > 0 ? last.Substring(0, last.Length - 1) : last) + "…";
            }
            return res;
        }
    }
}
