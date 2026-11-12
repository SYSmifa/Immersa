using System;
using System.Collections.Generic;
using System.Globalization;
using Immersa.Core;
using Immersa.Ui;
using UnityEngine;
using UnityEngine.UI;

namespace Immersa.Quest
{
    /// <summary>
    /// The object view of the menu (like the web headset app): the selected model's scale, turn and tilt typed with the keyboard,
    /// its colour (a wheel, a brightness bar, quick tints, one material or all) and finish (roughness / metalness sliders), and
    /// delete with a confirmation. Everything is applied live and counts as an unsaved change.
    /// </summary>
    public class ObjectPanel
    {
        public enum Page { Main, Color, ConfirmDelete }

        const float W = 900f;
        static readonly string[] PresetHex =
        {
            "#ffffff", "#c9ced6", "#7b8494", "#2b303b", "#111318", "#d6335a",
            "#f97316", "#e0a53a", "#22c55e", "#14b8a6", "#0ea5e9", "#a855f7",
        };

        readonly ProjectEditSession session;
        readonly Action refreshMenu;
        readonly Action<bool> holdRefresh;   // true while a drag is going on: the menu must not be redrawn then (it would destroy the drag area)

        public Page page = Page.Main;
        int material = -1;                   // -1 = all materials, else the index
        float hue, sat = 1f, val = 1f;
        Image swatch, valueBar;
        Text hexLabel;
        RectTransform wheelThumb, valueThumb, roughFill, metalFill;
        Texture2D valueTex;

        public ObjectPanel(ProjectEditSession session, Action refreshMenu, Action<bool> holdRefresh)
        {
            this.session = session; this.refreshMenu = refreshMenu; this.holdRefresh = holdRefresh;
        }

        public void Reset() { page = Page.Main; material = -1; }

        public void Build(RectTransform content)
        {
            var m = session.SelectedModel;
            var holder = session.Selected;
            if (m == null || holder == null) { UiKit.Label(content, 44, 40, W - 88, 60, "Nessun oggetto selezionato.", 28, UiTheme.HeaderSub); return; }
            switch (page)
            {
                case Page.Main: BuildMain(content, m, holder); break;
                case Page.Color: BuildColor(content, m, holder); break;
                case Page.ConfirmDelete: BuildConfirm(content, m); break;
            }
        }

        // ---- main page ----

        static string Num(double v, string fmt = "0.###") => v.ToString(fmt, CultureInfo.InvariantCulture);
        static bool Parse(string s, out double v) => double.TryParse((s ?? "").Replace(',', '.').Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out v);

        void BuildMain(RectTransform content, RoomModel m, GameObject holder)
        {
            UiKit.Label(content, 44, 6, W - 88, 46, m.Name, 36, UiTheme.HeaderText, TextAnchor.UpperLeft, true);
            if (!string.IsNullOrEmpty(m.Source)) UiKit.Label(content, 44, 54, W - 88, 30, "da " + m.Source, 22, UiTheme.HeaderSub);

            Field(content, 110, "Scala", Num(m.Scale), v => v > 0.001 && v < 1000, v => { m.Scale = v; Apply(m, holder); });
            Field(content, 206, "Rotazione (°)", Num(m.Yaw * Mathf.Rad2Deg, "0.#"), v => true, v => { m.Yaw = v * Mathf.Deg2Rad; Apply(m, holder); });
            Field(content, 302, "Inclinazione X (°)", Num((m.Tilt?.X ?? 0) * Mathf.Rad2Deg, "0.#"), v => true, v => { m.Tilt = new Vec2(v * Mathf.Deg2Rad, m.Tilt?.Y ?? 0); Apply(m, holder); });
            Field(content, 398, "Inclinazione Z (°)", Num((m.Tilt?.Y ?? 0) * Mathf.Rad2Deg, "0.#"), v => true, v => { m.Tilt = new Vec2(m.Tilt?.X ?? 0, v * Mathf.Deg2Rad); Apply(m, holder); });

            UiKit.Pill(content, 44, 520, W - 88, 76, "Colore e finitura", 30, UiTheme.Accent, Color.white, UiTheme.AccentHover, () => { page = Page.Color; material = -1; refreshMenu(); });
            UiKit.Pill(content, 44, 616, W - 88, 76, "Elimina", 30, UiTheme.Bad, Color.white, UiTheme.Bad, () => { page = Page.ConfirmDelete; refreshMenu(); });
        }

        void Field(RectTransform content, float y, string label, string initial, Func<double, bool> valid, Action<double> apply)
        {
            UiKit.Label(content, 44, y + 8, 420, 56, label, 28, UiTheme.HeaderSub, TextAnchor.MiddleLeft);
            new UiTextField(content, 480, y, W - 480 - 44, 72, initial, "", null, (text, ok) =>
            {
                if (!ok) return;
                if (Parse(text, out var v) && valid(v)) apply(v);
                refreshMenu();   // shows the number as stored
            }, false, false, 12);
        }

        void Apply(RoomModel m, GameObject holder)
        {
            ModelPose.ApplyTransform(m, holder.transform);
            session.Edited(m);
        }

        // ---- colour page ----

        void BuildColor(RectTransform content, RoomModel m, GameObject holder)
        {
            var mats = ModelLook.List(holder);
            string targetName = material < 0 ? "Tutti" : (material < mats.Count ? mats[material].name : "-");
            UiKit.Pill(content, 44, 4, W - 88 - 150, 64, "Materiale: " + targetName, 26, UiTheme.Glass, Color.white, UiTheme.GlassHover,
                () => { material = material + 1 >= mats.Count ? -1 : material + 1; refreshMenu(); });
            UiKit.Pill(content, W - 44 - 140, 4, 140, 64, "Indietro", 24, UiTheme.Glass, Color.white, UiTheme.GlassHover, () => { page = Page.Main; refreshMenu(); });

            // The current colour of the target.
            var current = CurrentColor(m, mats);
            Color.RGBToHSV(current, out hue, out sat, out val);

            // Hue / saturation wheel and brightness bar.
            var wheel = UiKit.NewRect(content, "Wheel", 44, 84, 280, 280);
            var wi = wheel.gameObject.AddComponent<Image>(); wi.sprite = WheelSprite(); wi.raycastTarget = false;
            UiKit.DragArea(wheel, p =>
            {
                holdRefresh(true);
                float dx = p.x * 2f - 1f, dy = 1f - p.y * 2f;
                float r = Mathf.Min(1f, Mathf.Sqrt(dx * dx + dy * dy));
                hue = (Mathf.Atan2(dy, dx) / (2f * Mathf.PI) + 1f) % 1f;
                sat = r;
                ColorChanged(m, holder, mats);
            }, () => { holdRefresh(false); refreshMenu(); });
            wheelThumb = UiKit.Box(wheel, 0, 0, 26, 26, Color.white, true, "WheelThumb").rectTransform;

            var vbar = UiKit.NewRect(content, "ValueBar", 344, 84, 48, 280);
            valueBar = vbar.gameObject.AddComponent<Image>(); valueBar.raycastTarget = false;
            valueTex = new Texture2D(1, 64, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            valueBar.sprite = Sprite.Create(valueTex, new Rect(0, 0, 1, 64), new Vector2(0.5f, 0.5f));
            UiKit.DragArea(vbar, p => { holdRefresh(true); val = 1f - p.y; ColorChanged(m, holder, mats); }, () => { holdRefresh(false); refreshMenu(); });
            valueThumb = UiKit.Box(vbar, -6, 0, 60, 14, Color.white, true, "ValueThumb").rectTransform;

            swatch = UiKit.Box(content, 420, 84, 200, 100, current, true, "Swatch");
            hexLabel = UiKit.Label(content, 420, 192, 200, 34, ModelLook.ToHex(current), 24, UiTheme.HeaderSub, TextAnchor.UpperLeft);
            UiKit.Pill(content, 640, 84, 216, 100, "Originale", 26, UiTheme.Glass, Color.white, UiTheme.GlassHover, () => { Restore(m, holder); });

            // Quick tints.
            for (int i = 0; i < PresetHex.Length; i++)
            {
                var hex = PresetHex[i];
                float x = 44 + (i % 6) * 136f, y = 384 + (i / 6) * 74f;
                var box = UiKit.Box(content, x, y, 126, 64, ModelLook.ParseHex(hex, Color.white), true, "Tint" + i);
                UiKit.Hotspot(box.rectTransform, () => { var c = ModelLook.ParseHex(hex, Color.white); Color.RGBToHSV(c, out hue, out sat, out val); ColorChanged(m, holder, mats); refreshMenu(); });
            }

            // Finish sliders.
            var fin = CurrentFinish(m, mats);
            UiKit.Label(content, 44, 540, 400, 30, "Rugosità", 24, UiTheme.HeaderSub);
            roughFill = Slider(content, 574, fin.rough, v => { SetFinish(m, holder, v, null); });
            UiKit.Label(content, 44, 624, 400, 30, "Metallico", 24, UiTheme.HeaderSub);
            metalFill = Slider(content, 658, fin.metal, v => { SetFinish(m, holder, null, v); });

            UpdateVisuals(current);
        }

        RectTransform Slider(RectTransform content, float y, float value, Action<float> onValue)
        {
            var rail = UiKit.NewRect(content, "Slider", 44, y, 812, 36);
            var ri = rail.gameObject.AddComponent<Image>(); ri.color = new Color(1, 1, 1, 0.12f); ri.sprite = UiKit.Rounded(); ri.type = Image.Type.Sliced; ri.raycastTarget = false;
            var fill = UiKit.Box(rail, 0, 0, Mathf.Max(36f, 812f * value), 36, UiTheme.Accent, true, "Fill").rectTransform;
            UiKit.DragArea(rail, p =>
            {
                holdRefresh(true);
                float v = Mathf.Clamp01(p.x);
                fill.sizeDelta = new Vector2(Mathf.Max(36f, 812f * v), 36);
                onValue(v);
            }, () => { holdRefresh(false); refreshMenu(); });
            return fill;
        }

        Color CurrentColor(RoomModel m, List<MaterialInfo> mats)
        {
            string key = material.ToString(CultureInfo.InvariantCulture);
            string hex = material >= 0 && m.MaterialColors != null && m.MaterialColors.TryGetValue(key, out var h) ? h : m.Color;
            if (!string.IsNullOrEmpty(hex)) return ModelLook.ParseHex(hex, Color.white);
            return material >= 0 && material < mats.Count ? mats[material].color : (mats.Count > 0 ? mats[0].color : Color.white);
        }

        (float rough, float metal) CurrentFinish(RoomModel m, List<MaterialInfo> mats)
        {
            string key = material.ToString(CultureInfo.InvariantCulture);
            var one = material >= 0 && m.MaterialFinish != null && m.MaterialFinish.TryGetValue(key, out var f) ? f : null;
            float rough = (float?)(one?.Roughness ?? m.Finish?.Roughness) ?? (material >= 0 && material < mats.Count ? mats[material].roughness : (mats.Count > 0 ? mats[0].roughness : 0.5f));
            float metal = (float?)(one?.Metalness ?? m.Finish?.Metalness) ?? (material >= 0 && material < mats.Count ? mats[material].metalness : (mats.Count > 0 ? mats[0].metalness : 0f));
            return (Mathf.Clamp01(rough), Mathf.Clamp01(metal));
        }

        void ColorChanged(RoomModel m, GameObject holder, List<MaterialInfo> mats)
        {
            var c = Color.HSVToRGB(hue, sat, val);
            string hex = ModelLook.ToHex(c);
            if (material < 0) { m.Color = hex; m.MaterialColors = null; }
            else { m.MaterialColors = m.MaterialColors ?? new Dictionary<string, string>(); m.MaterialColors[material.ToString(CultureInfo.InvariantCulture)] = hex; }
            ModelLook.Apply(holder, m);
            session.Edited(m);
            UpdateVisuals(c);
        }

        void SetFinish(RoomModel m, GameObject holder, float? rough, float? metal)
        {
            Finish target;
            if (material < 0) target = m.Finish = m.Finish ?? new Finish();
            else
            {
                m.MaterialFinish = m.MaterialFinish ?? new Dictionary<string, Finish>();
                string key = material.ToString(CultureInfo.InvariantCulture);
                if (!m.MaterialFinish.TryGetValue(key, out target) || target == null) m.MaterialFinish[key] = target = new Finish();
            }
            if (rough.HasValue) target.Roughness = Math.Round(rough.Value, 2);
            if (metal.HasValue) target.Metalness = Math.Round(metal.Value, 2);
            ModelLook.Apply(holder, m);
            session.Edited(m);
        }

        void Restore(RoomModel m, GameObject holder)
        {
            string key = material.ToString(CultureInfo.InvariantCulture);
            if (material < 0) { m.Color = null; m.MaterialColors = null; m.Finish = null; m.MaterialFinish = null; }
            else { m.MaterialColors?.Remove(key); m.MaterialFinish?.Remove(key); }
            if (m.MaterialColors != null && m.MaterialColors.Count == 0) m.MaterialColors = null;
            if (m.MaterialFinish != null && m.MaterialFinish.Count == 0) m.MaterialFinish = null;
            ModelLook.Apply(holder, m);
            session.Edited(m);
            refreshMenu();
        }

        void UpdateVisuals(Color c)
        {
            if (swatch != null) swatch.color = c;
            if (hexLabel != null) hexLabel.text = ModelLook.ToHex(c);
            if (wheelThumb != null)
            {
                float a = hue * 2f * Mathf.PI;
                float x = 140f + Mathf.Cos(a) * sat * 140f - 13f, y = 140f - Mathf.Sin(a) * sat * 140f - 13f;
                wheelThumb.anchoredPosition = new Vector2(x, -y);
            }
            if (valueTex != null)
            {
                for (int i = 0; i < 64; i++) valueTex.SetPixel(0, i, Color.HSVToRGB(hue, sat, i / 63f));
                valueTex.Apply();
            }
            if (valueThumb != null) valueThumb.anchoredPosition = new Vector2(-6, -(1f - val) * 266f);
        }

        // ---- delete ----

        void BuildConfirm(RectTransform content, RoomModel m)
        {
            UiKit.Label(content, 44, 120, W - 88, 160, "Eliminare \"" + m.Name + "\" dal progetto?\nLa modifica si salva con \"Salva\".", 32, UiTheme.HeaderText, TextAnchor.UpperLeft);
            UiKit.Pill(content, 44, 340, W - 88, 84, "Elimina", 32, UiTheme.Bad, Color.white, UiTheme.Bad, () => { page = Page.Main; session.Remove(m); refreshMenu(); });
            UiKit.Pill(content, 44, 444, W - 88, 84, "Annulla", 32, UiTheme.Glass, Color.white, UiTheme.GlassHover, () => { page = Page.Main; refreshMenu(); });
        }

        // ---- the colour wheel picture ----

        static Sprite wheelSprite;
        static Sprite WheelSprite()
        {
            if (wheelSprite != null) return wheelSprite;
            const int n = 256;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            var px = new Color32[n * n];
            for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float dx = (x + 0.5f) / n * 2f - 1f, dy = (y + 0.5f) / n * 2f - 1f;
                    float r = Mathf.Sqrt(dx * dx + dy * dy);
                    if (r > 1f) { px[y * n + x] = new Color32(0, 0, 0, 0); continue; }
                    float h = (Mathf.Atan2(dy, dx) / (2f * Mathf.PI) + 1f) % 1f;
                    var c = (Color32)Color.HSVToRGB(h, r, 1f);
                    c.a = (byte)(Mathf.Clamp01((1f - r) * n * 0.5f) * 255);
                    px[y * n + x] = c;
                }
            tex.SetPixels32(px);
            tex.Apply();
            wheelSprite = Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(0.5f, 0.5f));
            return wheelSprite;
        }
    }
}
