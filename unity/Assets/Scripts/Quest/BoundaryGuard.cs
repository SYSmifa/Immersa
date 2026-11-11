using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>
    /// Keeps the Guardian boundary suppressed (XR_META_boundary_visibility).
    /// OVRManager retries the request every frame while the wanted state differs from the
    /// system state, so this component only (re)sets the wish at start and on every resume,
    /// and logs each state change (visible with: adb logcat -s Unity | findstr Boundary).
    /// The system may refuse (e.g. when no passthrough is active); the log says so.
    /// </summary>
    [DefaultExecutionOrder(-50)]
    public class BoundaryGuard : MonoBehaviour
    {
        const string Tag = "[Boundary] ";

        OVRManager manager;
        bool? lastSuppressed;
        float nextWarn;

        /// <summary>True when the system reports the boundary as suppressed.</summary>
        public bool Suppressed => manager != null && manager.isBoundaryVisibilitySuppressed;

        void Awake()
        {
            manager = FindFirstObjectByType<OVRManager>();
            if (manager == null)
            {
                Debug.LogError(Tag + "no OVRManager in the scene");
                enabled = false;
                return;
            }
            Request("start");
        }

        void OnEnable() => OVRManager.BoundaryVisibilityChanged += OnChanged;
        void OnDisable() => OVRManager.BoundaryVisibilityChanged -= OnChanged;

        // The headset can reset the state after standby or a recenter: ask again on every resume.
        void OnApplicationFocus(bool focus) { if (focus) Request("focus"); }
        void OnApplicationPause(bool paused) { if (!paused) Request("resume"); }

        void Request(string why)
        {
            if (manager == null) return;
            manager.shouldBoundaryVisibilityBeSuppressed = true;
            Debug.Log(Tag + "requested suppression (" + why + "), system state: " + Describe(manager.isBoundaryVisibilitySuppressed));
        }

        void OnChanged(OVRPlugin.BoundaryVisibility visibility)
        {
            Debug.Log(Tag + "system event: " + visibility);
            if (visibility != OVRPlugin.BoundaryVisibility.Suppressed && manager != null)
                manager.shouldBoundaryVisibilityBeSuppressed = true; // OVRManager keeps retrying
        }

        void Update()
        {
            if (manager == null) return;
            bool now = manager.isBoundaryVisibilitySuppressed;
            if (lastSuppressed != now)
            {
                lastSuppressed = now;
                Debug.Log(Tag + "state is now " + Describe(now));
            }
            else if (!now && Time.unscaledTime > nextWarn)
            {
                nextWarn = Time.unscaledTime + 10f;
                Debug.Log(Tag + "still not suppressed (retrying every frame)");
            }
        }

        static string Describe(bool suppressed) => suppressed ? "SUPPRESSED" : "visible";
    }
}
