using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Immersa.Core
{
    // Plain value types for the JSON the web app saves: points and quaternions are arrays of numbers there.
    // They carry no UnityEngine types so this folder compiles (and is tested) outside Unity. Convert at the edge.
    // Axes are the WEB's (three.js, right-handed, y up). Unity is left-handed: convert in one place only (see README).

    [JsonConverter(typeof(Vec2Converter))]
    public readonly struct Vec2
    {
        public readonly double X, Y;
        public Vec2(double x, double y) { X = x; Y = y; }
    }

    [JsonConverter(typeof(Vec3Converter))]
    public readonly struct Vec3
    {
        public readonly double X, Y, Z;
        public Vec3(double x, double y, double z) { X = x; Y = y; Z = z; }
    }

    // Quaternion as (x, y, z, w), the order used in the saved scans.
    [JsonConverter(typeof(QuatConverter))]
    public readonly struct Quat
    {
        public readonly double X, Y, Z, W;
        public Quat(double x, double y, double z, double w) { X = x; Y = y; Z = z; W = w; }
    }

    internal static class ArrayJson
    {
        public static double[] Read(JsonReader reader, int n, string what)
        {
            var arr = JArray.Load(reader);
            if (arr.Count != n) throw new JsonSerializationException(what + " needs " + n + " numbers, got " + arr.Count);
            var v = new double[n];
            for (int i = 0; i < n; i++) v[i] = arr[i].Value<double>();
            return v;
        }

        public static void Write(JsonWriter writer, params double[] v)
        {
            writer.WriteStartArray();
            foreach (var d in v) writer.WriteValue(d);
            writer.WriteEndArray();
        }
    }

    internal sealed class Vec2Converter : JsonConverter
    {
        public override bool CanConvert(Type t) => t == typeof(Vec2);
        public override object ReadJson(JsonReader r, Type t, object existing, JsonSerializer s) { var v = ArrayJson.Read(r, 2, "Vec2"); return new Vec2(v[0], v[1]); }
        public override void WriteJson(JsonWriter w, object value, JsonSerializer s) { var v = (Vec2)value; ArrayJson.Write(w, v.X, v.Y); }
    }

    internal sealed class Vec3Converter : JsonConverter
    {
        public override bool CanConvert(Type t) => t == typeof(Vec3);
        public override object ReadJson(JsonReader r, Type t, object existing, JsonSerializer s) { var v = ArrayJson.Read(r, 3, "Vec3"); return new Vec3(v[0], v[1], v[2]); }
        public override void WriteJson(JsonWriter w, object value, JsonSerializer s) { var v = (Vec3)value; ArrayJson.Write(w, v.X, v.Y, v.Z); }
    }

    internal sealed class QuatConverter : JsonConverter
    {
        public override bool CanConvert(Type t) => t == typeof(Quat);
        public override object ReadJson(JsonReader r, Type t, object existing, JsonSerializer s) { var v = ArrayJson.Read(r, 4, "Quat"); return new Quat(v[0], v[1], v[2], v[3]); }
        public override void WriteJson(JsonWriter w, object value, JsonSerializer s) { var v = (Quat)value; ArrayJson.Write(w, v.X, v.Y, v.Z, v.W); }
    }
}
