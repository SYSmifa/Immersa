using System;
using UnityEngine;

namespace Immersa.Ui
{
    /// <summary>
    /// The system keyboard of the headset (Unity's TouchScreenKeyboard; the project config has "requires system keyboard" on).
    /// One keyboard at a time: <see cref="Open"/> shows it, the text is reported while typing, and the end (OK / cancelled) once.
    /// </summary>
    public class KeyboardRouter : MonoBehaviour
    {
        static KeyboardRouter instance;
        TouchScreenKeyboard keyboard;
        Action<string> onChange;
        Action<string, bool> onDone;
        string last;
        int maxLength;

        public static bool Active => instance != null && instance.keyboard != null;

        public static void Open(string initial, bool secure, bool multiline, int maxLength, Action<string> onChange, Action<string, bool> onDone)
        {
            if (instance == null) instance = new GameObject("KeyboardRouter").AddComponent<KeyboardRouter>();
            instance.Show(initial ?? "", secure, multiline, maxLength, onChange, onDone);
        }

        /// <summary>Hides the keyboard (the end callback is not called).</summary>
        public static void Cancel()
        {
            if (instance == null || instance.keyboard == null) return;
            instance.keyboard.active = false;
            instance.keyboard = null;
        }

        void Show(string initial, bool secure, bool multiline, int max, Action<string> change, Action<string, bool> done)
        {
            if (keyboard != null) { keyboard.active = false; keyboard = null; }
            onChange = change; onDone = done; maxLength = max; last = initial;
            TouchScreenKeyboard.hideInput = false;
            keyboard = TouchScreenKeyboard.Open(initial, TouchScreenKeyboardType.Default, true, multiline, secure, false, "", max > 0 ? max : 0);
            if (keyboard == null) { Debug.LogWarning("[Keyboard] the system keyboard is not available"); onDone?.Invoke(initial, false); onDone = null; }
        }

        void Update()
        {
            if (keyboard == null) return;
            var text = keyboard.text ?? "";
            if (maxLength > 0 && text.Length > maxLength) text = text.Substring(0, maxLength);
            if (text != last) { last = text; onChange?.Invoke(text); }

            var status = keyboard.status;
            if (status == TouchScreenKeyboard.Status.Visible) return;
            bool ok = status == TouchScreenKeyboard.Status.Done;
            keyboard = null;
            var done = onDone; onDone = null;
            done?.Invoke(text, ok);
        }
    }
}
