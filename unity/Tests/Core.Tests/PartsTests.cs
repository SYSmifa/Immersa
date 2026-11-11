using System;
using System.Linq;
using Immersa.Core;
using Newtonsoft.Json.Linq;

namespace Immersa.Core.Tests
{
    // A small file, to show how a path counts (the same file, loaded by three's GLTFLoader, gives the tree in the comments).
    internal static class PartsTests
    {
        const string Gltf = @"{
          ""asset"": { ""version"": ""2.0"" }, ""scene"": 0, ""scenes"": [ { ""nodes"": [0, 2] } ],
          ""nodes"": [ { ""name"": ""n0"", ""mesh"": 0, ""children"": [1] }, { ""name"": ""n1"", ""mesh"": 1, ""translation"": [0, 1, 0] }, { ""name"": ""cassetto bianco"", ""translation"": [1, 2, 3] } ],
          ""meshes"": [ { ""name"": ""m0"", ""primitives"": [ { ""attributes"": { ""POSITION"": 0 } }, { ""attributes"": { ""POSITION"": 0 } } ] },
                        { ""name"": ""m1"", ""primitives"": [ { ""attributes"": { ""POSITION"": 0 } } ] } ],
          ""accessors"": [ { ""componentType"": 5126, ""count"": 3, ""type"": ""VEC3"", ""min"": [0, 0, 0], ""max"": [1, 1, 0] } ]
        }";
        // Group ""n0""                       path 0      (a mesh with two primitives and a child node)
        //   Mesh ""m0""                      path 0/0
        //   Mesh ""m0_1""                    path 0/1
        //   Mesh ""n1""                      path 0/2    (the child node comes AFTER the primitives' meshes)
        // Object3D ""cassetto_bianco""       path 1

        public static void All(Action<string, Action> run)
        {
            run("parts: a mesh with several primitives is a group, and its child nodes come after the primitives", () =>
            {
                var tree = PartTree.Build(JObject.Parse(Gltf));
                var n0 = tree.NodeByPath("0");
                Assert.Equal(3, n0.Children.Count);
                Assert.True(!n0.IsMesh && n0.GltfNode == 0, "the node is the group");
                Assert.True(n0.Children[0].IsMesh && n0.Children[0].GltfNode == -1 && n0.Children[1].IsMesh, "primitives are meshes of no node");
                Assert.Equal(1, tree.GltfNodeOfPath("0/2"), "the child node n1 is at 0/2, not 0/0");
                Assert.Equal("0/2", tree.PathOf(tree.NodeByPath("0/2")));
                Assert.Equal(-1, tree.GltfNodeOfPath("0/1"), "a primitive of a group is no node: use the node above");
                Assert.Equal(2, tree.GltfNodeOfPath("1"));
                Assert.Equal("cassetto bianco", PartTree.PartName(tree.NodeByPath("1")));
                Assert.Equal("m0", PartTree.PartName(tree.NodeByPath("0/0")), "a primitive is named after its mesh");
            });
            run("parts: picking a mesh gives its component; picking it again goes up one level", () =>
            {
                var tree = PartTree.Build(JObject.Parse(Gltf));
                // the group has a child that is a mesh but not at the origin (the node n1), so its primitives are not "one component": each one is
                Assert.Equal("0/0", tree.PartFromMesh(tree.NodeByPath("0/0"), null));
                Assert.Equal("0", tree.PartFromMesh(tree.NodeByPath("0/0"), "0/0"), "again: the parent");
                // the single mesh n1 is a component; again goes up to n0
                Assert.Equal("0/2", tree.PartFromMesh(tree.NodeByPath("0/2"), null));
                Assert.Equal("0", tree.PartFromMesh(tree.NodeByPath("0/2"), "0/2"));
            });
            run("parts: moving a component, then putting it back", () =>
            {
                var tree = PartTree.Build(JObject.Parse(Gltf));
                var box = tree.ModelBox().Value;
                tree.SetCentring(PartTree.CentringOffset(box.min, box.max));
                var edits = new System.Collections.Generic.Dictionary<string, PartEdit> { ["1"] = new PartEdit { D = new Vec3(0, 0.5, 0) } };
                tree.Apply(edits);
                Assert.True(Math.Abs(tree.NodeByPath("1").Position.Y - 2.5) < 1e-9, "moved up by 0.5");
                tree.Apply(new System.Collections.Generic.Dictionary<string, PartEdit>());
                Assert.True(Math.Abs(tree.NodeByPath("1").Position.Y - 2) < 1e-9, "back where the file had it");
            });
        }
    }
}
