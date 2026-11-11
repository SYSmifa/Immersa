using Oculus.Interaction;
using Oculus.Interaction.Surfaces;
using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>
    /// Makes a placed model grabbable with the Meta Interaction SDK: point the ray at it and pinch (hands) or press
    /// the trigger (controllers), then move it. One hand only, and the model slides on the horizontal plane of its
    /// frame (height stays), like the web app's "pinch held = move on the floor". Two-hand scale/rotation come later.
    /// Logs use the [Grab] tag (adb logcat -s Unity | findstr Grab).
    /// </summary>
    public static class ModelGrab
    {
        const string Tag = "[Grab] ";

        /// <summary>Adds a box collider from the renderers' bounds, a Grabbable and a RayInteractable to <paramref name="holder"/>.</summary>
        public static void Make(GameObject holder)
        {
            var renderers = holder.GetComponentsInChildren<Renderer>();
            if (renderers.Length == 0) return;

            // Bounds in the holder's local space (the holder carries the model's scale).
            var world = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) world.Encapsulate(renderers[i].bounds);
            var toLocal = holder.transform.worldToLocalMatrix;
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            for (int i = 0; i < 8; i++)
            {
                var corner = world.center + Vector3.Scale(world.extents, new Vector3((i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1));
                var p = toLocal.MultiplyPoint3x4(corner);
                min = Vector3.Min(min, p);
                max = Vector3.Max(max, p);
            }

            // The Interaction SDK components assert their fields in Start: build them inactive, inject, then activate.
            bool wasActive = holder.activeSelf;
            holder.SetActive(false);

            var box = holder.AddComponent<BoxCollider>();
            box.center = (min + max) * 0.5f;
            box.size = max - min;

            var surface = holder.AddComponent<ColliderSurface>();
            surface.InjectAllColliderSurface(box);

            // Slide on the horizontal plane: the height relative to where the grab started cannot change.
            var mover = holder.AddComponent<OneGrabTranslateTransformer>();
            mover.Constraints = new OneGrabTranslateTransformer.OneGrabTranslateConstraints
            {
                ConstraintsAreRelative = true,
                MinX = new FloatConstraint(), MaxX = new FloatConstraint(),
                MinY = new FloatConstraint { Constrain = true, Value = 0f },
                MaxY = new FloatConstraint { Constrain = true, Value = 0f },
                MinZ = new FloatConstraint(), MaxZ = new FloatConstraint(),
            };

            var grabbable = holder.AddComponent<Grabbable>();
            grabbable.InjectOptionalOneGrabTransformer(mover);
            grabbable.InjectOptionalTargetTransform(holder.transform);
            grabbable.WhenPointerEventRaised += e =>
            {
                if (e.Type == PointerEventType.Select || e.Type == PointerEventType.Unselect || e.Type == PointerEventType.Cancel)
                    Debug.Log(Tag + e.Type + " " + holder.name + " at " + holder.transform.position.ToString("0.00"));
            };

            var ray = holder.AddComponent<RayInteractable>();
            ray.InjectAllRayInteractable(surface);
            ray.InjectOptionalPointableElement(grabbable);

            holder.SetActive(wasActive);
            Debug.Log(Tag + holder.name + " is grabbable (box " + box.size.ToString("0.00") + ")");
        }
    }
}
