using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using GLTFast;
using Immersa.Cloud;
using Immersa.Core;
using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>
    /// Loads the GLB models of a project and places them under a frame transform, like the web app's model layer:
    /// the file keeps its real size, is centred on x/z with its base on y=0, then position / yaw / tilt / scale of the
    /// RoomModel are applied (web axes converted by <see cref="WebSpace"/>).
    /// B.4 scope: no room alignment (the frame is put in front of the user), no colours, no part edits.
    /// </summary>
    public class ProjectModelLoader
    {
        const string Tag = "[Models] ";

        readonly SupabaseClient client;
        readonly Dictionary<string, GltfImport> imports = new Dictionary<string, GltfImport>();   // one parse per file, many instances

        public ProjectModelLoader(SupabaseClient client) { this.client = client; }

        public class Result
        {
            public int total, placed;
            public List<string> problems = new List<string>();
        }

        public async Task<Result> LoadProject(ProjectInfo project, Transform frame, Action<string> progress)
        {
            var result = new Result();
            var models = await client.GetProjectModels(project.id);
            result.total = models.Count;
            Debug.Log(Tag + "project '" + project.name + "': " + models.Count + " model(s)");

            for (int i = 0; i < models.Count; i++)
            {
                var m = models[i];
                progress?.Invoke("Loading models " + (i + 1) + "/" + models.Count + "\n" + m.Name);
                Debug.Log(Tag + "model " + m.Name + " | path " + m.Path + " | room '" + m.RoomId + "' | pos (" + m.Pos.X.ToString("0.00") + ", " + m.Pos.Y.ToString("0.00") + ", " + m.Pos.Z.ToString("0.00") + ") | yaw " + m.Yaw.ToString("0.00") + " | scale " + m.Scale.ToString("0.00"));
                try
                {
                    if (string.IsNullOrEmpty(m.Path) || m.Path.StartsWith("local:") || m.Path.StartsWith("pending:"))
                    {
                        result.problems.Add(m.Name + ": file not in the cloud (" + m.Path + ")");
                        continue;
                    }
                    var go = await Place(m, frame);
                    if (go != null) result.placed++;
                    else result.problems.Add(m.Name + ": the file could not be read");
                }
                catch (Exception e)
                {
                    Debug.LogError(Tag + m.Name + ": " + e);
                    result.problems.Add(m.Name + ": " + e.Message);
                }
            }
            return result;
        }

        async Task<GameObject> Place(RoomModel m, Transform frame)
        {
            if (!imports.TryGetValue(m.Path, out var gltf))
            {
                var file = await client.DownloadModel(m.Path);
                var bytes = await Task.Run(() => File.ReadAllBytes(file));
                gltf = new GltfImport();
                if (!await gltf.LoadGltfBinary(bytes, new Uri(file))) return null;
                imports[m.Path] = gltf;
            }

            // Instantiate at the origin with identity transform, measure, then move under the frame.
            var staging = new GameObject("staging-" + m.Name);
            var content = new GameObject("content");
            content.transform.SetParent(staging.transform, false);
            content.transform.localRotation = WebSpace.ImportFix;
            if (!await gltf.InstantiateMainSceneAsync(content.transform)) { UnityEngine.Object.Destroy(staging); return null; }

            var renderers = content.GetComponentsInChildren<Renderer>();
            if (renderers.Length > 0)
            {
                var b = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++) b.Encapsulate(renderers[i].bounds);
                content.transform.localPosition = new Vector3(-b.center.x, -b.min.y, -b.center.z);   // centre on x/z, base on y=0
                Debug.Log(Tag + m.Name + " size " + b.size.x.ToString("0.00") + " x " + b.size.y.ToString("0.00") + " x " + b.size.z.ToString("0.00") + " m, " + renderers.Length + " renderer(s)");
            }

            var holder = new GameObject(string.IsNullOrEmpty(m.Name) ? "model" : m.Name);
            holder.transform.SetParent(frame, false);
            holder.transform.localPosition = WebSpace.Position(m.Pos);
            holder.transform.localRotation = WebSpace.Orientation(m.Yaw, m.Tilt);
            holder.transform.localScale = Vector3.one * (m.Scale > 0 ? (float)m.Scale : 1f);
            content.transform.SetParent(holder.transform, false);
            UnityEngine.Object.Destroy(staging);
            return holder;
        }
    }
}
