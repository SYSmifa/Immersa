using System;
using System.Collections.Generic;
using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>
    /// Handedness helpers: the hand chosen in Options is the dominant one (ray, selection, grab); the other one has no ray and
    /// only opens and closes the menu with its pinch (like the web app). The Interaction SDK rig gives both hands a ray, so the
    /// secondary hand's far interactors (ray and distance grab, hand versions only) are switched off here.
    /// </summary>
    public static class SecondaryHand
    {
        const string Tag = "[Hands] ";

        struct Entry { public Behaviour component; public bool left; }
        static List<Entry> entries;
        static int lastRigCount = -1;

        /// <summary>True when the transform belongs to the left hand (an ancestor is named ...Left... / ..._L), false for the right one.</summary>
        public static bool IsLeft(Transform t)
        {
            for (var p = t; p != null; p = p.parent)
            {
                var n = p.name;
                if (n.IndexOf("Left", StringComparison.OrdinalIgnoreCase) >= 0 || n.EndsWith("_L", StringComparison.Ordinal)) return true;
                if (n.IndexOf("Right", StringComparison.OrdinalIgnoreCase) >= 0 || n.EndsWith("_R", StringComparison.Ordinal)) return false;
            }
            return false;
        }

        static string PathOf(Transform t)
        {
            var s = t.name;
            for (var p = t.parent; p != null; p = p.parent) s = p.name + "/" + s;
            return s;
        }

        /// <summary>Enables the far interactors of the dominant hand and disables the ones of the secondary hand.</summary>
        public static void Apply(bool dominantRight)
        {
            if (entries == null) Find();
            if (entries == null) return;
            bool leftIsSecondary = dominantRight;
            foreach (var e in entries)
            {
                if (e.component == null) continue;
                bool secondary = e.left == leftIsSecondary;
                if (e.component.enabled == secondary) e.component.enabled = !secondary;
            }
        }

        static void Find()
        {
            var rig = GameObject.Find("OVRComprehensiveInteractionRig");
            if (rig == null) return;
            // The rig brings locomotion (smooth movement, tunneling, teleport, turn) that we do not use; its parts also assert on missing references.
            foreach (var t in rig.GetComponentsInChildren<Transform>(true))
            {
                var n = t.name;
                if (t.gameObject.activeSelf && (n == "PlayerController" || n.IndexOf("Tunneling", StringComparison.Ordinal) >= 0 || n.IndexOf("Locomotion", StringComparison.Ordinal) >= 0 || n.IndexOf("Teleport", StringComparison.Ordinal) >= 0))
                { t.gameObject.SetActive(false); Debug.Log(Tag + "locomotion switched off: " + PathOf(t)); }
            }
            var list = new List<Entry>();
            foreach (var mb in rig.GetComponentsInChildren<MonoBehaviour>(true))
            {
                if (mb == null) continue;
                var type = mb.GetType().Name;
                if (type.IndexOf("Interactor", StringComparison.Ordinal) < 0) continue;
                var path = PathOf(mb.transform);
                bool far = type.IndexOf("RayInteractor", StringComparison.Ordinal) >= 0 || type.IndexOf("DistanceHandGrabInteractor", StringComparison.Ordinal) >= 0;
                bool hand = path.IndexOf("Hand and No Controller", StringComparison.OrdinalIgnoreCase) >= 0 || mb.gameObject.name.StartsWith("Hand", StringComparison.Ordinal);
                Debug.Log(Tag + type + " at " + path + (far && hand ? "  -> switched by handedness" : ""));
                if (far && hand) list.Add(new Entry { component = mb, left = IsLeft(mb.transform) });
            }
            entries = list;
            Debug.Log(Tag + list.Count + " far interactor(s) of the hands found");
        }
    }
}
