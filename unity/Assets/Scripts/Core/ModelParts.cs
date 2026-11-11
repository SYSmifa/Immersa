using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Immersa.Core
{
    // Port of src/room/parts.ts: the components of a model. A component is a node of the loaded file, named by its PATH: the
    // child indices from the file's scene root ("0/2" = third child of the first child). The web app loads the glTF with three's
    // GLTFLoader, and its object tree is not the node tree of the file: a mesh with several primitives becomes a group with one
    // mesh per primitive, and the node's own children come AFTER those meshes. Paths saved by the PC editor count in that tree,
    // so this file rebuilds it from the glTF JSON (`PartTree.Build`) and does the same picking and moving on it. The caller
    // (Unity) maps a path to a glTF node with `GltfNode` and applies the resulting transforms to the matching GameObject.
    // All numbers are in the web's frame and units (see README); the conversion to Unity belongs to the caller.

    public sealed class PartNode
    {
        public string Name = "";
        public PartNode Parent;
        public readonly List<PartNode> Children = new List<PartNode>();
        public bool IsMesh;                          // a mesh (a glTF primitive), not a plain group/node
        public int GltfNode = -1;                    // the glTF node it is; -1 for the scene root and for the meshes of a primitives group
        public Vec3 Position = new Vec3(0, 0, 0);    // local transform, as three keeps it (position, rotation, scale)
        public Quat Rotation = new Quat(0, 0, 0, 1);
        public Vec3 Scale = new Vec3(1, 1, 1);
        public Vec3? BoxMin, BoxMax;                 // a mesh's bounding box in its own frame (from the POSITION accessor), if known

        public Mat4 Matrix => Mat4.Compose(Position, Rotation, Scale);
        internal Mat4 Orig;                          // where it was in the file: kept the first time it is touched
        internal Vec3? Pivot;                        // bottom centre of its footprint at its original pose, kept once worked out

        public void SetMatrix(Mat4 m) { m.Decompose(out Position, out Rotation, out Scale); }
    }

    public sealed class PartTree
    {
        public PartNode Root;                        // the file's scene (gltf.scene): the app puts the centring offset on it
        List<string> edited = new List<string>();    // paths moved by the last Apply

        // The nodes of the tree in depth-first order (the root first).
        public IEnumerable<PartNode> All()
        {
            var stack = new Stack<PartNode>();
            stack.Push(Root);
            while (stack.Count > 0)
            {
                var n = stack.Pop();
                yield return n;
                for (int i = n.Children.Count - 1; i >= 0; i--) stack.Push(n.Children[i]);
            }
        }

        // ---- building the tree the way GLTFLoader does ----

        // three's PropertyBinding.sanitizeNodeName: spaces become underscores, reserved characters go.
        public static string SanitizeName(string name) => Regex.Replace(Regex.Replace(name ?? "", @"\s", "_"), @"[\[\]\.:/]", "");

        public static PartTree Build(JObject gltf)
        {
            var nodes = gltf["nodes"] as JArray ?? new JArray();
            var meshes = gltf["meshes"] as JArray ?? new JArray();
            var accessors = gltf["accessors"] as JArray ?? new JArray();
            int sceneIndex = gltf["scene"] != null ? (int)gltf["scene"] : 0;
            var scenes = gltf["scenes"] as JArray;
            var sceneDef = scenes != null && sceneIndex < scenes.Count ? scenes[sceneIndex] : null;
            var tree = new PartTree { Root = new PartNode { Name = SanitizeName((string)sceneDef?["name"]) } };

            (Vec3? min, Vec3? max) BoxOf(JToken primitive)
            {
                var pos = primitive["attributes"]?["POSITION"];
                if (pos == null) return (null, null);
                var acc = accessors[(int)pos];
                // Only plain floats have an honest min/max; quantized positions get their box from the caller (the renderers).
                if ((int)acc["componentType"] != 5126 || (bool?)acc["normalized"] == true || acc["min"] == null || acc["max"] == null) return (null, null);
                return (new Vec3((double)acc["min"][0], (double)acc["min"][1], (double)acc["min"][2]), new Vec3((double)acc["max"][0], (double)acc["max"][1], (double)acc["max"][2]));
            }

            PartNode Make(int index)
            {
                var def = nodes[index];
                PartNode node;
                var mesh = def["mesh"] != null ? meshes[(int)def["mesh"]] : null;
                var prims = mesh?["primitives"] as JArray;
                if (prims != null && prims.Count == 1)
                {
                    node = new PartNode { IsMesh = true };                      // the node IS the mesh
                    (node.BoxMin, node.BoxMax) = BoxOf(prims[0]);
                }
                else if (prims != null && prims.Count > 1)
                {
                    node = new PartNode();                                       // a group, with one mesh per primitive
                    foreach (var p in prims)
                    {
                        var m = new PartNode { IsMesh = true, Parent = node, Name = SanitizeName((string)mesh["name"]) };
                        (m.BoxMin, m.BoxMax) = BoxOf(p);
                        node.Children.Add(m);
                    }
                }
                else node = new PartNode();
                node.GltfNode = index;
                node.Name = SanitizeName((string)def["name"]);
                if (def["matrix"] != null)
                {
                    var a = ((JArray)def["matrix"]).Select(x => (double)x).ToArray();
                    var m = new Mat4();
                    Array.Copy(a, m.E, 16);
                    node.SetMatrix(m);
                }
                else
                {
                    if (def["translation"] != null) node.Position = new Vec3((double)def["translation"][0], (double)def["translation"][1], (double)def["translation"][2]);
                    if (def["rotation"] != null) node.Rotation = new Quat((double)def["rotation"][0], (double)def["rotation"][1], (double)def["rotation"][2], (double)def["rotation"][3]);
                    if (def["scale"] != null) node.Scale = new Vec3((double)def["scale"][0], (double)def["scale"][1], (double)def["scale"][2]);
                }
                if (def["children"] is JArray kids)
                    foreach (var k in kids)
                    {
                        var child = Make((int)k);
                        child.Parent = node;
                        node.Children.Add(child);                                // after the primitives' meshes
                    }
                return node;
            }

            if (sceneDef?["nodes"] is JArray roots)
                foreach (var r in roots)
                {
                    var n = Make((int)r);
                    n.Parent = tree.Root;
                    tree.Root.Children.Add(n);
                }
            return tree;
        }

        // ---- paths ----

        public string PathOf(PartNode node)
        {
            var idx = new List<int>();
            var o = node;
            while (o != null && o != Root)
            {
                if (o.Parent == null) return null;
                idx.Insert(0, o.Parent.Children.IndexOf(o));
                o = o.Parent;
            }
            return o == Root && idx.Count > 0 ? string.Join("/", idx) : null;
        }

        public PartNode NodeByPath(string path)
        {
            var o = Root;
            foreach (var part in path.Split('/'))
            {
                if (!int.TryParse(part, out int i) || i < 0 || i >= o.Children.Count) return null;
                o = o.Children[i];
            }
            return o;
        }

        // A glTF mesh with several materials loads as a group of meshes (one per material, same place): that is one component.
        static bool PrimitivesOfOne(PartNode group) =>
            group.Children.All(c => c.IsMesh && c.Position.X == 0 && c.Position.Y == 0 && c.Position.Z == 0 && c.Rotation.W == 1 && c.Scale.X == 1 && c.Scale.Y == 1 && c.Scale.Z == 1);

        // The component that a hit mesh belongs to: wrappers with a single child are skipped, so a door made of a group with one
        // panel inside is one component. Picking the component that is already chosen goes up one level (its parent), if any.
        public string PartFromMesh(PartNode mesh, string current)
        {
            var node = mesh;
            while (node.Parent != null && node.Parent != Root && (node.Parent.Children.Count == 1 || PrimitivesOfOne(node.Parent))) node = node.Parent;
            var path = PathOf(node);
            if (path != null && path == current)
            {
                var up = node.Parent != null && node.Parent != Root ? PathOf(node.Parent) : null;
                if (up != null) path = up;
            }
            return path;
        }

        // The glTF node a path stands for: -1 when the path is the scene root, or a single primitive of a group (a mesh with several
        // materials is ONE renderer in Unity: the caller should use the node above).
        public int GltfNodeOfPath(string path) => NodeByPath(path)?.GltfNode ?? -1;

        // Names for the UI: the node's own name (underscores read as spaces), else "Componente N".
        public static string PartName(PartNode node)
        {
            var n = (node.Name ?? "").Replace('_', ' ').Trim();
            if (n.Length > 0) return n;
            return ("Componente " + (node.Parent != null ? (node.Parent.Children.IndexOf(node) + 1).ToString() : "")).Trim();
        }

        // ---- moving components ----

        // The matrix of a node's frame inside the model's holder at the poses the nodes have NOW (the root's own matrix, which carries
        // the centring offset, then every node down to and including `node`).
        Mat4 WorldOf(PartNode node)
        {
            var chain = new List<PartNode>();
            for (var o = node; o != null; o = o.Parent) chain.Insert(0, o);
            var m = Mat4.Identity();
            foreach (var n in chain) m = m.Mul(n.Matrix);
            return m;
        }

        static Mat4 Original(PartNode n) => n.Orig ??= n.Matrix;

        // Bottom centre of the component's footprint, in the holder's frame, as it is in the file (a point on the floor under the
        // component, which is where its gizmo and its turning / scaling are centred). Worked out the first time it is asked, with
        // the nodes above it as they are at that moment, and kept (like the web app does).
        public Vec3 PivotOf(PartNode node)
        {
            if (node.Pivot != null) return node.Pivot.Value;
            var m0 = Original(node);
            var now = node.Matrix;
            node.SetMatrix(m0);
            double[] lo = { double.PositiveInfinity, double.PositiveInfinity, double.PositiveInfinity };
            double[] hi = { double.NegativeInfinity, double.NegativeInfinity, double.NegativeInfinity };
            bool any = false;
            foreach (var mesh in Subtree(node))
            {
                if (!mesh.IsMesh || mesh.BoxMin == null || mesh.BoxMax == null) continue;
                var w = WorldOf(mesh);
                var a = mesh.BoxMin.Value; var b = mesh.BoxMax.Value;
                foreach (var x in new[] { a.X, b.X })
                    foreach (var y in new[] { a.Y, b.Y })
                        foreach (var z in new[] { a.Z, b.Z })
                        {
                            var p = w.TransformPoint(new Vec3(x, y, z));
                            lo[0] = Math.Min(lo[0], p.X); lo[1] = Math.Min(lo[1], p.Y); lo[2] = Math.Min(lo[2], p.Z);
                            hi[0] = Math.Max(hi[0], p.X); hi[1] = Math.Max(hi[1], p.Y); hi[2] = Math.Max(hi[2], p.Z);
                            any = true;
                        }
            }
            var pivot = any ? new Vec3((lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2) : new Vec3(0, 0, 0);
            node.Pivot = pivot;
            node.SetMatrix(now);
            return pivot;
        }

        // A pivot the caller worked out itself (from the renderers' bounds in Unity), for nodes whose meshes have no honest box here.
        public void SetPivot(PartNode node, Vec3 pivot) { node.Pivot = pivot; }

        static IEnumerable<PartNode> Subtree(PartNode n)
        {
            yield return n;
            foreach (var c in n.Children)
                foreach (var d in Subtree(c)) yield return d;
        }

        // Puts every component where `parts` says (and the ones moved before, and no longer in `parts`, back where the file had
        // them). Returns the paths of the nodes it has set; read their Position/Rotation/Scale. Pass the offset the app puts on the
        // scene root with `SetCentring` first.
        public List<string> Apply(IReadOnlyDictionary<string, PartEdit> parts)
        {
            var keys = (parts ?? new Dictionary<string, PartEdit>()).Where(kv =>
            {
                var e = kv.Value;
                return e.D != null || (e.Yaw ?? 0) != 0 || (e.Scale != null && e.Scale != 1);
            }).Select(kv => kv.Key).ToList();
            // Put back what was moved before.
            foreach (var k in edited)
            {
                var n = NodeByPath(k);
                if (n != null && n.Orig != null) n.SetMatrix(n.Orig);
            }
            // Outer components first, so an inner one is moved inside its already moved parent (a stable sort, like the web's).
            var ordered = keys.Select((k, i) => (k, i)).OrderBy(t => t.k.Split('/').Length).ThenBy(t => t.i).Select(t => t.k).ToList();
            foreach (var k in ordered)
            {
                var n = NodeByPath(k);
                if (n == null || n.Parent == null) continue;
                var c = PivotOf(n);
                var e = parts[k];
                Original(n);
                var pr = WorldOf(n.Parent);                                     // the parent's frame inside the holder
                double s = e.Scale ?? 1;
                var d = e.D ?? new Vec3(0, 0, 0);
                var M = Mat4.Translation(d.X, d.Y, d.Z)
                    .Mul(Mat4.Translation(c.X, c.Y, c.Z))
                    .Mul(Mat4.RotationY(e.Yaw ?? 0))
                    .Mul(Mat4.Scaling(s, s, s))
                    .Mul(Mat4.Translation(-c.X, -c.Y, -c.Z));
                n.SetMatrix(pr.Inverse().Mul(M).Mul(pr).Mul(n.Orig));
            }
            edited = ordered;
            return ordered;
        }

        // The box of all the meshes of the file, in the scene root's own frame (the root's matrix left out), or null without boxes.
        public (Vec3 min, Vec3 max)? ModelBox()
        {
            double[] lo = { double.PositiveInfinity, double.PositiveInfinity, double.PositiveInfinity };
            double[] hi = { double.NegativeInfinity, double.NegativeInfinity, double.NegativeInfinity };
            bool any = false;
            foreach (var mesh in All())
            {
                if (!mesh.IsMesh || mesh.BoxMin == null || mesh.BoxMax == null) continue;
                var chain = new List<PartNode>();
                for (var o = mesh; o != null && o != Root; o = o.Parent) chain.Insert(0, o);
                var w = Mat4.Identity();
                foreach (var n in chain) w = w.Mul(n.Matrix);
                var a = mesh.BoxMin.Value; var b = mesh.BoxMax.Value;
                foreach (var x in new[] { a.X, b.X })
                    foreach (var y in new[] { a.Y, b.Y })
                        foreach (var z in new[] { a.Z, b.Z })
                        {
                            var p = w.TransformPoint(new Vec3(x, y, z));
                            lo[0] = Math.Min(lo[0], p.X); lo[1] = Math.Min(lo[1], p.Y); lo[2] = Math.Min(lo[2], p.Z);
                            hi[0] = Math.Max(hi[0], p.X); hi[1] = Math.Max(hi[1], p.Y); hi[2] = Math.Max(hi[2], p.Z);
                            any = true;
                        }
            }
            return any ? ((Vec3 min, Vec3 max)?)(new Vec3(lo[0], lo[1], lo[2]), new Vec3(hi[0], hi[1], hi[2])) : null;
        }

        // The model's own centring (the app moves the file's scene so that the model is centred on x/z and stands on y = 0):
        // the offset for a model whose box in the file is [min, max].
        public static Vec3 CentringOffset(Vec3 min, Vec3 max) => new Vec3(-(min.X + max.X) / 2, -min.Y, -(min.Z + max.Z) / 2);

        public void SetCentring(Vec3 offset) { Root.Position = offset; }
    }
}
