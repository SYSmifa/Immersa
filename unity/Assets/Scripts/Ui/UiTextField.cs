using System;
using UnityEngine;
using UnityEngine.UI;

namespace Immersa.Ui
{
    /// <summary>
    /// A text field of a 3D panel: a white box with the text (or a grey hint when empty). Selecting it with the ray opens the
    /// system keyboard; the text changes live while typing. A password shows dots.
    /// </summary>
    public class UiTextField
    {
        readonly Text label;
        readonly Image box;
        readonly bool secure;
        readonly string hint;
        string value;
        bool editing;

        public string Value => value;

        public UiTextField(Transform parent, float x, float y, float w, float h, string initial, string hint, Action<string> onChanged, Action<string, bool> onDone = null,
            bool secure = false, bool multiline = false, int maxLength = 0, int fontSize = 30)
        {
            this.secure = secure;
            this.hint = hint;
            value = initial ?? "";
            box = UiKit.Box(parent, x, y, w, h, UiTheme.Surface, true, "Field");
            label = UiKit.Label(box.transform, 20, 0, w - 40, h, "", fontSize, UiTheme.Text, multiline ? TextAnchor.UpperLeft : TextAnchor.MiddleLeft, false, "Text");
            Redraw();
            UiKit.Hotspot(box.rectTransform, () =>
            {
                editing = true;
                Redraw();
                KeyboardRouter.Open(value, secure, multiline, maxLength,
                    t => { value = t; Redraw(); onChanged?.Invoke(t); },
                    (t, ok) => { editing = false; value = t; Redraw(); onDone?.Invoke(t, ok); });
            }, box, UiTheme.SurfaceHover, UiTheme.Surface);
        }

        void Redraw()
        {
            if (label == null || box == null) return;   // the panel was redrawn while the keyboard was open
            bool empty = string.IsNullOrEmpty(value);
            label.text = empty ? hint : (secure ? new string('*', value.Length) : value);
            label.color = empty ? UiTheme.Faint : UiTheme.Text;
            box.color = editing ? UiTheme.AccentSoft : UiTheme.Surface;
        }
    }
}
