using System;
using Oculus.Interaction;
using Oculus.Interaction.Surfaces;
using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>
    /// A 3D button for the headset: a coloured box with a label, selected with the ray (pinch / trigger) through the
    /// Interaction SDK. Temporary look: the Aura UI replaces it later.
    /// </summary>
    public static class UiButton
    {
        public static GameObject Create(Transform parent, string text, Vector3 localPos, Vector3 size, Color color, Action onSelect)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = "Button-" + text;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = size;

            // The material is an asset in Resources: Shader.Find would return null in a build (the shader gets stripped).
            var rend = go.GetComponent<Renderer>();
            var baseMat = Resources.Load<Material>("ButtonUnlit");
            if (baseMat != null) rend.material = new Material(baseMat) { color = color };
            else Debug.LogError("[Ui] Resources/ButtonUnlit is missing");

            var textGo = new GameObject("Label");
            textGo.transform.SetParent(go.transform, false);
            textGo.transform.localPosition = new Vector3(0, 0, -0.55f);
            textGo.transform.localScale = new Vector3(1f / size.x, 1f / size.y, 1f / size.z) * 0.02f;   // undo the button's non-uniform scale
            var tm = textGo.AddComponent<TextMesh>();
            tm.text = text;
            tm.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            tm.GetComponent<MeshRenderer>().sharedMaterial = tm.font.material;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.alignment = TextAlignment.Center;
            tm.fontSize = 60;
            tm.characterSize = 0.12f;
            tm.color = Color.white;

            // Interaction SDK ray target: built inactive, injected, then activated.
            go.SetActive(false);
            var box = go.GetComponent<BoxCollider>();
            var surface = go.AddComponent<ColliderSurface>();
            surface.InjectAllColliderSurface(box);
            var ray = go.AddComponent<RayInteractable>();
            ray.InjectAllRayInteractable(surface);
            // (InteractableUnityEventWrapper is not used: its UnityEvents are null when the component is added from code.)
            ray.WhenStateChanged += args =>
            {
                if (args.NewState == InteractableState.Select && args.PreviousState != InteractableState.Select) onSelect?.Invoke();
            };
            go.SetActive(true);
            return go;
        }
    }
}
