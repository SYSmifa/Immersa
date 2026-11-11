using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Immersa.Core;
using Newtonsoft.Json.Linq;

namespace Immersa.Core.Tests
{
    // The model parts against what the web app does with the same glTF files: three's GLTFLoader makes the object tree, parts.ts
    // finds paths and components and moves them. Regenerate the fixture with: npx tsx docs/test-plans/gen-parts-golden.mts
    internal static class PartsGoldenTests
    {
        const double Eps = 1e-8;

        static void Near(double expected, double actual, string what)
        {
            if (Math.Abs(expected - actual) > Eps * Math.Max(1, Math.Abs(expected))) throw new Exception(what + ": web " + expected + " but C# " + actual);
        }

        static void CompareTrs(JToken e, PartNode n, string what)
        {
            for (int i = 0; i < 3; i++) Near((double)e["p"][i], i == 0 ? n.Position.X : i == 1 ? n.Position.Y : n.Position.Z, what + " position " + i);
            for (int i = 0; i < 3; i++) Near((double)e["s"][i], i == 0 ? n.Scale.X : i == 1 ? n.Scale.Y : n.Scale.Z, what + " scale " + i);
            // the quaternion of a sheared matrix is not a unit one: compare the direction (a quaternion and its opposite are the same turn)
            double qx = (double)e["q"][0], qy = (double)e["q"][1], qz = (double)e["q"][2], qw = (double)e["q"][3];
            double dot = qx * n.Rotation.X + qy * n.Rotation.Y + qz * n.Rotation.Z + qw * n.Rotation.W;
            double la = Math.Sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
            double lb = Math.Sqrt(n.Rotation.X * n.Rotation.X + n.Rotation.Y * n.Rotation.Y + n.Rotation.Z * n.Rotation.Z + n.Rotation.W * n.Rotation.W);
            Near(1, Math.Abs(dot) / (la * lb), what + " rotation");
            Near(la, lb, what + " rotation length");
        }

        static void CompareDump(JArray expected, PartTree tree, string what, bool structure)
        {
            var all = tree.All().ToList();
            Assert.Equal(expected.Count, all.Count, what + " object count");
            for (int i = 0; i < all.Count; i++)
            {
                var e = expected[i];
                var n = all[i];
                string tag = what + " object " + i + " (" + (string)e["path"] + ")";
                if (structure)
                {
                    Assert.Equal((string)e["path"], tree.PathOf(n) ?? "", tag + " path");
                    Assert.Equal((bool)e["isMesh"], n.IsMesh, tag + " isMesh");
                    Assert.Equal((int)e["gltfNode"], n.GltfNode, tag + " gltfNode");
                    Assert.Equal((int)e["children"], n.Children.Count, tag + " children");
                    // names of the file's own nodes (the meshes of a primitives group get numbered names that depend on loading order)
                    if (n.GltfNode >= 0 || n == tree.Root) Assert.Equal((string)e["name"], n.Name, tag + " name");
                }
                CompareTrs(e, n, tag);
            }
        }

        public static void All(Action<string, Action> run)
        {
            run("parts vs web: 25 random glTF files (object tree, paths, picking, moving components twice)", () =>
            {
                var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "parts-golden.json");
                var scenarios = (JArray)JObject.Parse(File.ReadAllText(path))["scenarios"];
                int picksSeen = 0, moved = 0, climbed = 0;
                for (int n = 0; n < scenarios.Count; n++)
                {
                    var sc = scenarios[n];
                    string tag = "scenario " + n;
                    var tree = PartTree.Build((JObject)sc["gltf"]);

                    // the centring the app puts on the scene root, from the boxes in the file
                    var box = tree.ModelBox();
                    Assert.True(box != null, tag + " has a box");
                    var offset = PartTree.CentringOffset(box.Value.min, box.Value.max);
                    Near((double)sc["centring"][0], offset.X, tag + " centring x"); Near((double)sc["centring"][1], offset.Y, tag + " centring y"); Near((double)sc["centring"][2], offset.Z, tag + " centring z");
                    tree.SetCentring(offset);

                    CompareDump((JArray)sc["tree"], tree, tag + " tree", true);

                    foreach (var p in (JArray)sc["picks"])
                    {
                        var mesh = tree.NodeByPath((string)p["mesh"]);
                        Assert.True(mesh != null && mesh.IsMesh, tag + " the web's mesh " + p["mesh"] + " is a mesh here too");
                        var first = tree.PartFromMesh(mesh, null);
                        Assert.Equal((string)p["first"], first, tag + " pick of " + p["mesh"]);
                        var second = tree.PartFromMesh(mesh, first);
                        Assert.Equal((string)p["second"], second, tag + " pick again of " + p["mesh"]);
                        if (second != first) climbed++;
                        picksSeen++;
                    }

                    var parts1 = Json.Parse<Dictionary<string, PartEdit>>(sc["parts1"].ToString());
                    tree.Apply(parts1);
                    CompareDump((JArray)sc["after1"], tree, tag + " after the first edit", false);
                    foreach (var pv in (JArray)sc["pivots1"])
                    {
                        if (pv["pivot"].Type == JTokenType.Null) continue;
                        var node = tree.NodeByPath((string)pv["path"]);
                        var got = tree.PivotOf(node);
                        Near((double)pv["pivot"][0], got.X, tag + " pivot x of " + pv["path"]); Near((double)pv["pivot"][1], got.Y, tag + " pivot y of " + pv["path"]); Near((double)pv["pivot"][2], got.Z, tag + " pivot z of " + pv["path"]);
                        moved++;
                    }
                    var parts2 = Json.Parse<Dictionary<string, PartEdit>>(sc["parts2"].ToString());
                    tree.Apply(parts2);
                    CompareDump((JArray)sc["after2"], tree, tag + " after the second edit", false);
                }
                Assert.True(picksSeen > 50 && moved > 20, "enough components exercised (" + picksSeen + " picks, " + moved + " pivots)");
                Assert.True(climbed > 0, "picking an already chosen component goes up (" + climbed + ")");
            });
        }
    }
}
