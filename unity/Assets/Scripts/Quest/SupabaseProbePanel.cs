using System;
using System.IO;
using System.Text;
using Immersa.Cloud;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace Immersa.Quest
{
    /// <summary>
    /// Risk-prototype panel (B.2/B.3): signs in to Supabase and lists the projects in front of you.
    /// Sign-in order: saved session, else a code shown here and approved on the PC
    /// (editor: "Collega un visore"), the same flow as the web headset app. No password is typed
    /// or stored. Logs use the [Supabase] tag.
    /// </summary>
    public class SupabaseProbePanel : MonoBehaviour
    {
        const string Tag = "[Supabase] ";
        static readonly string[] ToneNames = { "teal", "blue", "violet", "pink", "orange", "amber", "green", "grey" };

        public SupabaseConfig config;

        Text label;
        readonly StringBuilder lines = new StringBuilder();

        void Awake() => BuildPanel();

        async void Start()
        {
            try { await Run(); }
            catch (Exception e)
            {
                Debug.LogError(Tag + e);
                Show("ERROR\n" + e.Message);
            }
        }

        async System.Threading.Tasks.Task Run()
        {
            if (config == null || string.IsNullOrEmpty(config.url) || string.IsNullOrEmpty(config.anonKey))
            {
                Show("Supabase is not configured:\nAssets/Config/LocalSupabaseConfig is missing or empty.");
                return;
            }
            var client = new SupabaseClient(config);
            Show("Connecting to Supabase...");

            bool ok = await client.RestoreSession();
            if (ok) Debug.Log(Tag + "restored saved session for " + client.Email);
            else if (!await SignInWithPcCode(client)) return;

            Show("Signed in as " + client.Email + "\nLoading projects...");
            var projects = await client.ListProjects();
            Debug.Log(Tag + projects.Count + " projects");

            var sb = new StringBuilder();
            sb.AppendLine("Signed in as " + client.Email);
            sb.AppendLine(projects.Count + " project(s)");
            sb.AppendLine();
            for (int i = 0; i < projects.Count && i < 9; i++)
            {
                var p = projects[i];
                var tone = p.tone >= 0 && p.tone < ToneNames.Length ? ToneNames[p.tone] : "-";
                var initial = string.IsNullOrEmpty(p.name) ? "?" : p.name.Substring(0, 1).ToUpperInvariant();
                sb.AppendLine(initial + "  " + p.name + "   [" + p.roomCount + " room(s), " + tone + "]");
                Debug.Log(Tag + "project: " + p.name + " | rooms " + p.roomCount + " | tone " + p.tone);
            }
            if (projects.Count > 9) sb.AppendLine("... +" + (projects.Count - 9) + " more");
            Show(sb.ToString());
        }

        /// <summary>
        /// Shows a code and waits for the PC (editor: "Collega un visore") to approve it.
        /// A new code is requested when it expires. False when something failed for good.
        /// </summary>
        async System.Threading.Tasks.Task<bool> SignInWithPcCode(SupabaseClient client)
        {
            while (this != null)
            {
                var link = await client.StartDeviceLink();
                if (link.error != null)
                {
                    Show("Cannot get a code:\n" + link.error);
                    Debug.LogWarning(Tag + "start failed: " + link.error);
                    return false;
                }
                Debug.Log(Tag + "device code " + link.code + " (waiting for the PC)");
                Show("Sign in with a code from the PC\n\n<size=110><b>" + link.code + "</b></size>\n\nOn the PC: open Immersa, sign in,\nclick \"Collega un visore\" and approve this code.");

                while (this != null)
                {
                    await System.Threading.Tasks.Task.Delay(2000);
                    var (status, error) = await client.PollDeviceLink(link);
                    if (status == SupabaseClient.LinkStatus.SignedIn) { Debug.Log(Tag + "signed in as " + client.Email); return true; }
                    if (status == SupabaseClient.LinkStatus.Expired) { Debug.Log(Tag + "code expired, asking for a new one"); break; }
                    if (status == SupabaseClient.LinkStatus.Error)
                    {
                        Show("Sign-in failed:\n" + error);
                        Debug.LogWarning(Tag + "poll failed: " + error);
                        return false;
                    }
                }
            }
            return false;
        }

        void Show(string text)
        {
            lines.Clear();
            lines.Append(text);
            if (label != null) label.text = lines.ToString();
        }

        // ---- a plain world-space panel placed in front of the head once tracking has started ----

        void BuildPanel()
        {
            var canvasGo = new GameObject("SupabaseProbeCanvas");
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            var rt = canvas.GetComponent<RectTransform>();
            rt.sizeDelta = new Vector2(900, 600);
            rt.localScale = Vector3.one * 0.001f;   // 0.9 m x 0.6 m

            var bg = new GameObject("Background").AddComponent<Image>();
            bg.transform.SetParent(canvasGo.transform, false);
            bg.color = new Color(0.06f, 0.07f, 0.09f, 0.92f);
            var bgRt = bg.rectTransform;
            bgRt.anchorMin = Vector2.zero; bgRt.anchorMax = Vector2.one; bgRt.offsetMin = bgRt.offsetMax = Vector2.zero;

            var textGo = new GameObject("Text");
            textGo.transform.SetParent(canvasGo.transform, false);
            label = textGo.AddComponent<Text>();
            label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            label.fontSize = 34;
            label.color = new Color(0.85f, 0.95f, 0.95f);
            label.alignment = TextAnchor.UpperLeft;
            label.horizontalOverflow = HorizontalWrapMode.Wrap;
            label.verticalOverflow = VerticalWrapMode.Truncate;
            var tRt = label.rectTransform;
            tRt.anchorMin = Vector2.zero; tRt.anchorMax = Vector2.one;
            tRt.offsetMin = new Vector2(30, 30); tRt.offsetMax = new Vector2(-30, -30);

            StartCoroutine(PlaceInFrontOfHead());
        }

        System.Collections.IEnumerator PlaceInFrontOfHead()
        {
            yield return new WaitForSeconds(1.0f);   // let the tracking settle
            var cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
            if (cam == null) yield break;
            var fwd = cam.transform.forward; fwd.y = 0;
            fwd = fwd.sqrMagnitude < 1e-4f ? Vector3.forward : fwd.normalized;
            transform.position = cam.transform.position + fwd * 1.2f;
            // A world-space canvas reads correctly when its +Z points away from the viewer.
            transform.rotation = Quaternion.LookRotation(fwd, Vector3.up);
        }
    }
}
