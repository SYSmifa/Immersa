using System;
using Immersa.Ui;
using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>
    /// The round button with three bars that appears next to the selected model and opens its menu. Where it goes (like the web
    /// app's headHeightSpot): at eye height, 0.15 m in front of the face of the model nearest to you, so much closer to the object
    /// than to you (never in the half towards you, at most 6 m away). It stays put until the selection or the position of the model
    /// changes, or you go more than 7 m away from it.
    /// </summary>
    public class ObjectButton : MonoBehaviour
    {
        RectTransform canvas;
        GameObject current;
        Vector3 lastModelPos;
        Vector3 spot;
        bool hasSpot;

        public void Init(Action onPress)
        {
            canvas = UiKit.NewCanvas("ObjectButtonCanvas", transform, 140, 140);
            var bg = UiKit.Box(canvas, 0, 0, 140, 140, UiTheme.Accent, true, "Round");
            for (int i = 0; i < 3; i++) UiKit.Box(bg.transform, 36, 38 + i * 22, 68, 10, Color.white, true, "Bar" + i);
            UiKit.Hotspot(bg.rectTransform, onPress, bg, UiTheme.AccentHover, UiTheme.Accent);
            canvas.gameObject.SetActive(false);
        }

        /// <summary>Shows the button for the selected model (null hides it). Call again after the model moved.</summary>
        public void Show(GameObject holder)
        {
            if (holder == null) { current = null; hasSpot = false; if (canvas != null) canvas.gameObject.SetActive(false); return; }
            bool moved = current == holder && (holder.transform.position - lastModelPos).sqrMagnitude > 0.0025f;
            if (current != holder || moved || !hasSpot) { current = holder; lastModelPos = holder.transform.position; hasSpot = ComputeSpot(holder); }
            canvas.gameObject.SetActive(hasSpot);
        }

        static Camera Cam() => Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();

        bool ComputeSpot(GameObject holder)
        {
            var cam = Cam();
            if (cam == null) return false;
            Bounds b = default; bool first = true;
            foreach (var r in holder.GetComponentsInChildren<Renderer>())
            {
                if (r is LineRenderer) continue;
                if (first) { b = r.bounds; first = false; } else b.Encapsulate(r.bounds);
            }
            if (first) return false;

            var head = cam.transform.position;
            var eye = new Vector3(b.center.x, head.y, b.center.z);          // the model's centre at eye height
            var ray = new Ray(head, (eye - head).normalized);
            float distance = Vector3.Distance(head, eye);
            float face = b.IntersectRay(ray, out var enter) ? enter : distance;   // the face of the model nearest to you
            float d = Mathf.Max(face - 0.15f, face * 0.5f);                  // 0.15 m in front of it, never in the half towards you
            d = Mathf.Min(d, 6f);
            spot = head + ray.direction * d;
            return true;
        }

        void LateUpdate()
        {
            if (current == null || canvas == null || !canvas.gameObject.activeSelf) return;
            var cam = Cam();
            if (cam == null) return;
            if ((cam.transform.position - spot).magnitude > 7f) hasSpot = ComputeSpot(current);
            canvas.position = spot;
            var toHead = cam.transform.position - spot; toHead.y = 0;
            if (toHead.sqrMagnitude > 1e-4f) canvas.rotation = Quaternion.LookRotation(-toHead.normalized, Vector3.up);   // a canvas reads correctly when its +Z points away from the viewer
        }
    }
}
