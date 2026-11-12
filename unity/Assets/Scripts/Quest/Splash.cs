using System.Threading.Tasks;
using Immersa.Ui;
using UnityEngine;
using UnityEngine.UI;

namespace Immersa.Quest
{
    /// <summary>
    /// The start screen: the animated wireframe cube with the Immersa logo in front of the user, no background, for at least
    /// 2.4 s (like the web app). Hide it with <see cref="Hide"/>: the cube shrinks away.
    /// </summary>
    public class Splash : MonoBehaviour
    {
        public const float MinSeconds = 2.4f;

        RectTransform logo;
        WireCube cube;
        float shownAt;
        bool placed, hiding;
        float hideStart;

        public static Splash Create(Transform parent)
        {
            var go = new GameObject("Splash");
            go.transform.SetParent(parent, false);
            var s = go.AddComponent<Splash>();
            s.Build();
            return s;
        }

        void Build()
        {
            shownAt = Time.unscaledTime;
            cube = WireCube.Create(transform, 0.30f);
            cube.transform.localPosition = new Vector3(0f, 0.12f, 0f);

            logo = UiKit.NewCanvas("LogoCanvas", transform, 700, 156);
            logo.localPosition = new Vector3(0f, -0.16f, 0f);
            var tex = Resources.Load<Texture2D>("logo-immersa");
            if (tex != null)
            {
                var img = new GameObject("Logo", typeof(RectTransform)).AddComponent<Image>();
                img.transform.SetParent(logo, false);
                var rt = (RectTransform)img.transform;
                rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one; rt.offsetMin = rt.offsetMax = Vector2.zero;
                img.sprite = Sprite.Create(tex, new Rect(0, 0, tex.width, tex.height), new Vector2(0.5f, 0.5f), 100f);
                img.preserveAspect = true;
                img.raycastTarget = false;
            }
        }

        void LateUpdate()
        {
            if (!placed)
            {
                var cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
                if (cam == null) return;
                var fwd = cam.transform.forward; fwd.y = 0;
                fwd = fwd.sqrMagnitude < 1e-4f ? Vector3.forward : fwd.normalized;
                transform.position = cam.transform.position + fwd * 1.3f;
                transform.rotation = Quaternion.LookRotation(fwd, Vector3.up);
                placed = true;
            }
            if (hiding)
            {
                float k = 1f - Mathf.Clamp01((Time.unscaledTime - hideStart) / 0.5f);
                cube.SetScale(k);
                if (k <= 0f) Destroy(gameObject);
            }
        }

        /// <summary>Waits until the splash has been on screen for at least 2.4 s, then makes it vanish.</summary>
        public async Task Hide()
        {
            float left = MinSeconds - (Time.unscaledTime - shownAt);
            if (left > 0) await Task.Delay((int)(left * 1000));
            if (this == null) return;
            hiding = true;
            hideStart = Time.unscaledTime;
            if (logo != null) logo.gameObject.SetActive(false);
        }
    }
}
