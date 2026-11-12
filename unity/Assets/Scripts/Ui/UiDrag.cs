using System;
using Oculus.Interaction;
using UnityEngine;

namespace Immersa.Ui
{
    /// <summary>Reads the ray that holds a drag area (see UiKit.DragArea) and reports where it points on the rectangle.</summary>
    public class UiDrag : MonoBehaviour
    {
        public RayInteractable ray;
        public RectTransform rect;
        public Action<Vector2> onDrag;
        public Action onEnd;
        bool held;

        void Update()
        {
            if (ray == null) return;
            RayInteractor holder = null;
            foreach (var it in ray.SelectingInteractors) { holder = it; break; }
            if (holder == null)
            {
                if (held) { held = false; onEnd?.Invoke(); }
                return;
            }
            held = true;
            var plane = new Plane(rect.forward, rect.position);
            var r = new Ray(holder.Origin, holder.Forward);
            if (!plane.Raycast(r, out var enter)) return;
            var local = rect.InverseTransformPoint(r.GetPoint(enter));
            var size = rect.sizeDelta;
            onDrag?.Invoke(new Vector2(Mathf.Clamp01(local.x / size.x), Mathf.Clamp01(-local.y / size.y)));
        }
    }
}
