using System;
using Oculus.Interaction;
using Oculus.Interaction.Surfaces;
using UnityEngine;
using UnityEngine.UI;

namespace Immersa.Ui
{
    /// <summary>
    /// Small toolkit to build world-space panels: positions are in canvas pixels from the top-left corner (like the web's
    /// canvas panels), rounded boxes, labels, and "hotspots" that the ray (pinch / trigger) can select through the
    /// Interaction SDK. One pixel is 1 mm (the canvas is scaled by 0.001).
    /// </summary>
    public static class UiKit
    {
        public const float PixelsToMetres = 0.001f;
        static Sprite rounded;

        /// <summary>A white rounded rectangle, 9-sliced, to be tinted by Image.color.</summary>
        public static Sprite Rounded()
        {
            if (rounded != null) return rounded;
            const int size = 64, radius = 24;
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            var px = new Color32[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    // distance to the corner circle, anti-aliased by one pixel
                    float cx = x < radius ? radius - 0.5f : (x >= size - radius ? size - radius - 0.5f : x);
                    float cy = y < radius ? radius - 0.5f : (y >= size - radius ? size - radius - 0.5f : y);
                    float d = Mathf.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
                    float a = Mathf.Clamp01(radius - d + 0.5f);
                    px[y * size + x] = new Color32(255, 255, 255, (byte)(a * 255));
                }
            tex.SetPixels32(px);
            tex.Apply();
            rounded = Sprite.Create(tex, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100f, 0, SpriteMeshType.FullRect, new Vector4(radius, radius, radius, radius));
            return rounded;
        }

        /// <summary>A world-space canvas of <paramref name="w"/> x <paramref name="h"/> pixels (= mm), centred on its transform.</summary>
        public static RectTransform NewCanvas(string name, Transform parent, float w, float h)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var canvas = go.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            // The text is drawn from a dynamic font: without this the glyphs are rasterized at the tiny world scale and look blurry.
            var scaler = go.AddComponent<CanvasScaler>();
            scaler.dynamicPixelsPerUnit = 4f;
            var rt = go.GetComponent<RectTransform>();
            rt.sizeDelta = new Vector2(w, h);
            rt.localScale = Vector3.one * PixelsToMetres;
            return rt;
        }

        /// <summary>An empty rectangle at (x, y) from the top-left of the parent, size w x h.</summary>
        public static RectTransform NewRect(Transform parent, string name, float x, float y, float w, float h)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var rt = (RectTransform)go.transform;
            rt.anchorMin = rt.anchorMax = new Vector2(0, 1);
            rt.pivot = new Vector2(0, 1);
            rt.anchoredPosition = new Vector2(x, -y);
            rt.sizeDelta = new Vector2(w, h);
            return rt;
        }

        public static Image Box(Transform parent, float x, float y, float w, float h, Color color, bool round = true, string name = "Box")
        {
            var rt = NewRect(parent, name, x, y, w, h);
            var img = rt.gameObject.AddComponent<Image>();
            img.color = color;
            if (round) { img.sprite = Rounded(); img.type = Image.Type.Sliced; }
            img.raycastTarget = false;
            return img;
        }

        public static Text Label(Transform parent, float x, float y, float w, float h, string text, int size, Color color, TextAnchor anchor = TextAnchor.UpperLeft, bool bold = false, string name = "Label")
        {
            var rt = NewRect(parent, name, x, y, w, h);
            var t = rt.gameObject.AddComponent<Text>();
            t.font = bold ? UiTheme.Bold : UiTheme.Regular;
            t.fontSize = size;
            t.color = color;
            t.alignment = anchor;
            t.text = text;
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.verticalOverflow = VerticalWrapMode.Truncate;
            t.raycastTarget = false;
            t.supportRichText = false;
            return t;
        }

        /// <summary>
        /// Makes <paramref name="rect"/> selectable with the ray: a thin box collider over it. When <paramref name="tint"/> is given
        /// it changes colour while the ray is on it. The select fires when the pinch / trigger goes down.
        /// </summary>
        public static void Hotspot(RectTransform rect, Action onSelect, Image tint = null, Color? hover = null, Color? normal = null)
        {
            var go = rect.gameObject;
            bool wasActive = go.activeSelf;
            go.SetActive(false);   // the Interaction SDK components assert their fields in Start: inject before they run

            var box = go.AddComponent<BoxCollider>();
            var size = rect.sizeDelta;
            box.center = new Vector3(size.x * 0.5f, -size.y * 0.5f, 0f);
            box.size = new Vector3(size.x, size.y, 20f);

            var surface = go.AddComponent<ColliderSurface>();
            surface.InjectAllColliderSurface(box);
            var ray = go.AddComponent<RayInteractable>();
            ray.InjectAllRayInteractable(surface);
            Color idle = normal ?? (tint != null ? tint.color : Color.white);
            ray.WhenStateChanged += args =>
            {
                if (tint != null && hover.HasValue)
                    tint.color = args.NewState == InteractableState.Hover || args.NewState == InteractableState.Select ? hover.Value : idle;
                if (args.NewState == InteractableState.Select && args.PreviousState != InteractableState.Select) onSelect?.Invoke();
            };
            go.SetActive(wasActive);
        }

        /// <summary>A pill button: rounded box with a centred label and a hotspot. Returns the box (to restyle it).</summary>
        public static Image Pill(Transform parent, float x, float y, float w, float h, string text, int size, Color fill, Color textColor, Color hoverFill, Action onSelect, bool bold = true)
        {
            var img = Box(parent, x, y, w, h, fill, true, "Pill-" + text);
            Label(img.transform, 0, 0, w, h, text, size, textColor, TextAnchor.MiddleCenter, bold);
            if (onSelect != null) Hotspot(img.rectTransform, onSelect, img, hoverFill, fill);
            return img;
        }
    }
}
