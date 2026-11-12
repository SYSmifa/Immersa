using UnityEngine;

namespace Immersa.Ui
{
    /// <summary>
    /// The loading logo: a wireframe cube (a room) that draws itself edge by edge while it turns, then undraws, in cycles of 3.6 s
    /// (same sequence as src/ui3d/loader.ts: floor first, then the corners going up, then the roof).
    /// </summary>
    public class WireCube : MonoBehaviour
    {
        const float Cycle = 3.6f;
        static readonly Vector3[] Verts =
        {
            new Vector3(-1,-1,-1), new Vector3(1,-1,-1), new Vector3(1,1,-1), new Vector3(-1,1,-1),
            new Vector3(-1,-1,1), new Vector3(1,-1,1), new Vector3(1,1,1), new Vector3(-1,1,1),
        };
        static readonly int[,] Edges = { { 0, 1 }, { 1, 2 }, { 2, 3 }, { 3, 0 }, { 4, 5 }, { 5, 6 }, { 6, 7 }, { 7, 4 }, { 0, 4 }, { 1, 5 }, { 2, 6 }, { 3, 7 } };
        static readonly int[] Order = { 3, 2, 1, 0, 11, 10, 9, 8, 6, 5, 4, 7 };

        LineRenderer[] lines;
        float half;
        float t0;
        float scale = 1f;

        public static WireCube Create(Transform parent, float size)
        {
            var go = new GameObject("WireCube");
            go.transform.SetParent(parent, false);
            var c = go.AddComponent<WireCube>();
            c.Build(size);
            return c;
        }

        void Build(float size)
        {
            half = size * 0.5f;
            t0 = Time.unscaledTime;
            var baseMat = Resources.Load<Material>("ButtonUnlit");
            lines = new LineRenderer[12];
            for (int i = 0; i < 12; i++)
            {
                var go = new GameObject("Edge" + i);
                go.transform.SetParent(transform, false);
                var lr = go.AddComponent<LineRenderer>();
                lr.useWorldSpace = false;
                lr.positionCount = 2;
                lr.widthMultiplier = size * 0.035f;
                lr.numCapVertices = 2;
                var color = i % 2 == 0 ? UiTheme.Accent : UiTheme.Accent2;
                if (baseMat != null) lr.material = new Material(baseMat) { color = color };
                lr.startColor = lr.endColor = color;
                lines[i] = lr;
            }
            transform.localRotation = Quaternion.Euler(28f, 0f, 0f);
        }

        /// <summary>Scale of the whole cube (0 hides it): used to make it vanish at the end of the splash.</summary>
        public void SetScale(float s) { scale = s; }

        void Update()
        {
            if (lines == null) return;
            float t = Time.unscaledTime - t0;
            float u = (t % Cycle) / Cycle;
            transform.localRotation = Quaternion.Euler(28f, t * 0.85f * Mathf.Rad2Deg, 0f);
            for (int k = 0; k < 12; k++)
            {
                int e = Order[k];
                float start = k / 12f * 0.5f;                       // the edges come one after another during the first half
                float grow = Mathf.Clamp01((u - start) / 0.07f);
                float undraw = Mathf.Clamp01((u - 0.88f) / 0.12f);   // and go away at the end of the cycle
                float len = Mathf.SmoothStep(0, 1, grow) * (1f - Mathf.SmoothStep(0, 1, undraw));
                var a = Verts[Edges[e, 0]] * half * scale;
                var b = Verts[Edges[e, 1]] * half * scale;
                lines[e].SetPosition(0, a);
                lines[e].SetPosition(1, Vector3.Lerp(a, b, len));
                lines[e].enabled = len > 0.001f && scale > 0.001f;
            }
        }
    }
}
