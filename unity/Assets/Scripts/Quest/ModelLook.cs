using System;
using System.Collections.Generic;
using System.Globalization;
using Immersa.Core;
using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>What the menu shows about one material of a model (the index is what the project stores).</summary>
    public class MaterialInfo
    {
        public string name;
        public Color color;      // as in the file
        public float roughness;
        public float metalness;
    }

    /// <summary>Remembers the original materials of a placed model, so a look can always be applied from the file's own look.</summary>
    public class ModelLookState : MonoBehaviour
    {
        public List<Renderer> renderers = new List<Renderer>();
        public List<Material[]> originals = new List<Material[]>();
        public List<Material> distinct = new List<Material>();   // the distinct materials in order of first appearance: the index stored in the project
        public List<Material> created = new List<Material>();    // the copies made for the current look (destroyed when the look changes)
    }

    /// <summary>
    /// Colours and finish of a model, like paintModel in src/room/selection.ts: `color` (a '#rrggbb') replaces the colour factor of
    /// every material (the textures stay), `materialColors[i]` overrides it for material i; `finish` sets roughness / metalness for
    /// every material, `materialFinish[i]` for material i. Nothing set: the file's own look. Materials are copied per model, because
    /// glTFast shares them between all instances of a file.
    /// </summary>
    public static class ModelLook
    {
        static readonly int BaseColor = Shader.PropertyToID("baseColorFactor");
        static readonly int Metallic = Shader.PropertyToID("metallicFactor");
        static readonly int Roughness = Shader.PropertyToID("roughnessFactor");

        public static ModelLookState Capture(GameObject holder)
        {
            var state = holder.GetComponent<ModelLookState>() ?? holder.AddComponent<ModelLookState>();
            state.renderers.Clear(); state.originals.Clear(); state.distinct.Clear();
            foreach (var r in holder.GetComponentsInChildren<Renderer>())
            {
                if (r is LineRenderer || r.GetComponentInParent<SelectionBoxMarker>() != null) continue;   // the selection box is not part of the model
                var shared = r.sharedMaterials;
                state.renderers.Add(r);
                state.originals.Add(shared);
                foreach (var m in shared) if (m != null && !state.distinct.Contains(m)) state.distinct.Add(m);
            }
            return state;
        }

        public static List<MaterialInfo> List(GameObject holder)
        {
            var state = holder.GetComponent<ModelLookState>() ?? Capture(holder);
            var list = new List<MaterialInfo>();
            for (int i = 0; i < state.distinct.Count; i++)
            {
                var m = state.distinct[i];
                var v = m.HasProperty(BaseColor) ? m.GetVector(BaseColor) : Vector4.one;
                list.Add(new MaterialInfo
                {
                    name = string.IsNullOrEmpty(m.name) ? "Materiale " + (i + 1) : (i + 1) + " · " + CleanName(m.name),
                    color = new Color(v.x, v.y, v.z, 1f),
                    roughness = m.HasProperty(Roughness) ? m.GetFloat(Roughness) : 0.5f,
                    metalness = m.HasProperty(Metallic) ? m.GetFloat(Metallic) : 0f,
                });
            }
            return list;
        }

        static string CleanName(string n) => n.Replace("(Instance)", "").Trim();

        public static Color ParseHex(string hex, Color fallback)
        {
            if (string.IsNullOrEmpty(hex)) return fallback;
            return ColorUtility.TryParseHtmlString(hex.StartsWith("#") ? hex : "#" + hex, out var c) ? c : fallback;
        }

        public static string ToHex(Color c) => "#" + ColorUtility.ToHtmlStringRGB(c).ToLowerInvariant();

        /// <summary>Puts the model's look on its materials (copies); with no colour and no finish the original materials are back.</summary>
        public static void Apply(GameObject holder, RoomModel m)
        {
            var state = holder.GetComponent<ModelLookState>() ?? Capture(holder);
            foreach (var old in state.created) if (old != null) UnityEngine.Object.Destroy(old);
            state.created.Clear();

            bool any = !string.IsNullOrEmpty(m.Color) || (m.MaterialColors != null && m.MaterialColors.Count > 0)
                       || HasFinish(m.Finish) || (m.MaterialFinish != null && m.MaterialFinish.Count > 0);
            for (int k = 0; k < state.renderers.Count; k++)
            {
                var r = state.renderers[k];
                if (r == null) continue;
                var originals = state.originals[k];
                if (!any) { r.sharedMaterials = originals; continue; }
                var copy = new Material[originals.Length];
                for (int j = 0; j < originals.Length; j++)
                {
                    var src = originals[j];
                    if (src == null) { copy[j] = null; continue; }
                    int idx = state.distinct.IndexOf(src);
                    var mat = new Material(src);
                    state.created.Add(mat);
                    string key = idx.ToString(CultureInfo.InvariantCulture);
                    string hex = m.MaterialColors != null && m.MaterialColors.TryGetValue(key, out var h) ? h : m.Color;
                    if (!string.IsNullOrEmpty(hex) && mat.HasProperty(BaseColor)) mat.SetColor(BaseColor, ParseHex(hex, Color.white));   // the property is a colour: Unity converts it to linear
                    var fin = Merge(m.Finish, m.MaterialFinish != null && m.MaterialFinish.TryGetValue(key, out var f) ? f : null);
                    if (fin.Roughness.HasValue && mat.HasProperty(Roughness)) mat.SetFloat(Roughness, (float)fin.Roughness.Value);
                    if (fin.Metalness.HasValue && mat.HasProperty(Metallic)) mat.SetFloat(Metallic, (float)fin.Metalness.Value);
                    copy[j] = mat;
                }
                r.sharedMaterials = copy;
            }
        }

        static bool HasFinish(Finish f) => f != null && (f.Roughness.HasValue || f.Metalness.HasValue);

        static Finish Merge(Finish all, Finish one)
        {
            var r = new Finish { Roughness = all?.Roughness, Metalness = all?.Metalness };
            if (one != null) { if (one.Roughness.HasValue) r.Roughness = one.Roughness; if (one.Metalness.HasValue) r.Metalness = one.Metalness; }
            return r;
        }
    }

    /// <summary>Marks the selection box so the look code does not treat it as part of the model.</summary>
    public class SelectionBoxMarker : MonoBehaviour { }

    /// <summary>Position, turn and size of a placed model from its data (web axes converted by <see cref="WebSpace"/>).</summary>
    public static class ModelPose
    {
        public static void ApplyTransform(RoomModel m, Transform holder)
        {
            holder.localRotation = WebSpace.Orientation(m.Yaw, m.Tilt);
            holder.localScale = Vector3.one * (m.Scale > 0 ? (float)m.Scale : 1f);
        }
    }
}
