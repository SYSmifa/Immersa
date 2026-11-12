using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Immersa.Ui
{
    /// <summary>The look of every 3D panel ("Aura"): the same tokens as src/ui3d/theme.ts (ink panel, white cards, teal accent).</summary>
    public static class UiTheme
    {
        public static Color Hex(string hex, float alpha = 1f)
        {
            ColorUtility.TryParseHtmlString(hex, out var c);
            c.a = alpha;
            return c;
        }

        public static readonly Color Bg0 = Hex("#0b0d12"), Bg1 = Hex("#141821"), Bg2 = Hex("#1d222d");
        public static readonly Color Border = new Color(1, 1, 1, 0.14f);
        public static readonly Color Text = Hex("#0f1a33"), Sub = Hex("#5b6784"), Dim = Hex("#8591ab"), Faint = Hex("#97a2ba");
        public static readonly Color Notice = Hex("#b45309"), Bad = Hex("#d6335a"), Good = Hex("#0f9d6e");
        public static readonly Color HeaderText = Color.white, HeaderSub = new Color(1, 1, 1, 0.60f);
        public static readonly Color Surface = new Color(1, 1, 1, 0.97f), SurfaceHover = Hex("#cdf3ed"), SurfaceDown = Hex("#a8e6dc");
        public static readonly Color Accent = Hex("#14b8a6"), Accent2 = Hex("#2dd4bf"), AccentHover = Hex("#27cdb9");
        public static readonly Color AccentSoft = Hex("#e1f7f4"), AccentText = Hex("#0b7f73");
        public static readonly Color Glass = new Color(1, 1, 1, 0.09f), GlassHover = new Color(1, 1, 1, 0.18f);
        public static readonly Color TextDisabled = Hex("#a8b1c6");

        /// <summary>Gradients of the project tiles (first colour is used for the flat tile).</summary>
        public static readonly (Color a, Color b)[] Tones =
        {
            (Hex("#14b8a6"), Hex("#5eead4")), (Hex("#e0a53a"), Hex("#f3d37a")), (Hex("#6366f1"), Hex("#a5b4fc")), (Hex("#f43f5e"), Hex("#fda4af")),
            (Hex("#0ea5e9"), Hex("#7dd3fc")), (Hex("#22c55e"), Hex("#86efac")), (Hex("#a855f7"), Hex("#d8b4fe")), (Hex("#f97316"), Hex("#fdba74")),
        };

        static Font regular, bold;
        public static Font Regular => regular != null ? regular : (regular = Resources.Load<Font>("Fonts/Sen-Regular") ?? Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"));
        public static Font Bold => bold != null ? bold : (bold = Resources.Load<Font>("Fonts/Sen-Bold") ?? Regular);

        // ---- project tones: a saved tone is kept, the others get a free one (port of projectTones in theme.ts) ----

        static uint HashId(string id) { uint a = 7; foreach (char ch in id) a = unchecked(a * 31 + ch); return a; }

        /// <summary>Tone per project id, deterministic and the same on every device (same algorithm as the web app).</summary>
        public static Dictionary<string, int> ProjectTones(IList<(string id, int tone)> projects)
        {
            int n = Tones.Length;
            var result = new Dictionary<string, int>();
            var count = new int[n];
            foreach (var p in projects)
                if (p.tone >= 0 && p.tone < n) { result[p.id] = p.tone; count[p.tone]++; }
            foreach (var p in projects.Where(x => !result.ContainsKey(x.id)).OrderBy(x => x.id, StringComparer.Ordinal))
            {
                int pref = (int)(HashId(p.id) % (uint)n);
                int best = pref;
                for (int k = 0; k < n; k++) if (count[(pref + k) % n] < count[best]) best = (pref + k) % n;
                result[p.id] = best;
                count[best]++;
            }
            return result;
        }
    }
}
