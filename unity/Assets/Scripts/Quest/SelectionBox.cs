using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>
    /// Temporary selection look: a light-blue box around the selected model (the web app uses a translucent blue outline per
    /// object; that needs a shader and comes with the Aura rendering). The box follows the model because it is its child.
    /// </summary>
    public static class SelectionBox
    {
        const string Name = "SelectionBox";
        static readonly Color Cyan = new Color(0.25f, 0.85f, 1f);

        public static void Show(GameObject holder, bool on)
        {
            var existing = holder.transform.Find(Name);
            if (!on) { if (existing != null) existing.gameObject.SetActive(false); return; }
            if (existing != null) { existing.gameObject.SetActive(true); return; }

            var col = holder.GetComponent<BoxCollider>();
            if (col == null) return;
            var go = new GameObject(Name);
            go.transform.SetParent(holder.transform, false);
            var lr = go.AddComponent<LineRenderer>();
            lr.useWorldSpace = false;
            lr.loop = false;
            var mat = Resources.Load<Material>("ButtonUnlit");
            if (mat != null) lr.material = new Material(mat) { color = Cyan };
            lr.startColor = lr.endColor = Cyan;
            // A box as one path: bottom square, up, top square, then the other three edges.
            var c = col.center; var h = col.size * 0.5f;
            Vector3 P(int sx, int sy, int sz) => c + new Vector3(sx * h.x, sy * h.y, sz * h.z);
            var path = new[]
            {
                P(-1,-1,-1), P(1,-1,-1), P(1,-1,1), P(-1,-1,1), P(-1,-1,-1), P(-1,1,-1), P(1,1,-1), P(1,-1,-1), P(1,1,-1),
                P(1,1,1), P(1,-1,1), P(1,1,1), P(-1,1,1), P(-1,-1,1), P(-1,1,1), P(-1,1,-1)
            };
            lr.positionCount = path.Length;
            lr.SetPositions(path);
            // Constant width in the world whatever the model's scale.
            float s = Mathf.Max(0.0001f, holder.transform.lossyScale.x);
            lr.widthMultiplier = 0.012f / s;
        }
    }
}
