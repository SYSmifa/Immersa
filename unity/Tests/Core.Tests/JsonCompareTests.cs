using System;
using System.Collections.Generic;
using Immersa.Core;
using Newtonsoft.Json.Linq;

namespace Immersa.Core.Tests
{
    // The headset saves a project's models by writing back what the Core types read. These tests check that this loses nothing:
    // a model with every optional field, an unknown future field, nulls and integers where the web wrote numbers.
    internal static class JsonCompareTests
    {
        public static void All(Action<string, Action> run)
        {
            run("JsonCompare: numbers, nulls, objects, arrays", Basics);
            run("models: a full model survives read + write unchanged", FullModelRoundTrip);
            run("models: a moved model differs only in its position", MovedDiffers);
        }

        const string Models = @"[
          {""id"":""m1"",""roomId"":""r1"",""name"":""divano"",""source"":""divano.fbx"",""path"":""u/abc.glb"",""pos"":[1.5,0,-2.25],""yaw"":0.7853981633974483,
           ""tilt"":[0.1,-0.2],""scale"":1.25,""color"":""#aabbcc"",""materialColors"":{""0"":""#ffffff"",""2"":""#101010""},
           ""finish"":{""roughness"":0.4,""metalness"":0},""materialFinish"":{""1"":{""roughness"":1}},
           ""parts"":{""0/2"":{""d"":[0.1,0,0],""yaw"":0.5,""scale"":1.1,""color"":""#ff0000"",""finish"":{""metalness"":0.9}}},
           ""futureField"":{""x"":[1,2,3],""label"":""keep me""}},
          {""id"":""m2"",""roomId"":"""",""name"":""scatola"",""path"":""local:box.glb"",""pos"":[0,0,0],""yaw"":0,""scale"":1,""color"":null}
        ]";

        static void Basics()
        {
            string d;
            if (!JsonCompare.Same(JToken.Parse("1"), JToken.Parse("1.0"), "n", out d)) throw new Exception("1 vs 1.0: " + d);
            if (JsonCompare.Same(JToken.Parse("1"), JToken.Parse("1.001"), "n", out d)) throw new Exception("1 vs 1.001 should differ");
            if (!JsonCompare.Same(JToken.Parse("{\"a\":1,\"b\":null}"), JToken.Parse("{\"a\":1}"), "o", out d)) throw new Exception("a null field must be ignored: " + d);
            if (JsonCompare.Same(JToken.Parse("{\"a\":1}"), JToken.Parse("{\"a\":1,\"c\":2}"), "o", out d)) throw new Exception("an extra field must differ");
            if (!d.Contains(".c")) throw new Exception("diff should name the field: " + d);
            if (JsonCompare.Same(JToken.Parse("[1,2]"), JToken.Parse("[1,2,3]"), "a", out d)) throw new Exception("array length must differ");
        }

        static void FullModelRoundTrip()
        {
            var original = JArray.Parse(Models);
            var models = Json.Parse<List<RoomModel>>(original.ToString());
            if (models.Count != 2) throw new Exception("count " + models.Count);
            var again = JArray.Parse(Json.Write(models));
            if (!JsonCompare.Same(original, again, "models", out var diff)) throw new Exception("lost on the way: " + diff);
        }

        static void MovedDiffers()
        {
            var original = JArray.Parse(Models);
            var models = Json.Parse<List<RoomModel>>(original.ToString());
            models[0].Pos = new Vec3(2.0, 0, -2.25);
            var again = JArray.Parse(Json.Write(models));
            if (JsonCompare.Same(original, again, "models", out var diff)) throw new Exception("a move was not noticed");
            if (!diff.Contains("[0].pos")) throw new Exception("the difference should be in pos: " + diff);
        }
    }
}
