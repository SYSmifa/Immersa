using System;
using System.Collections.Generic;
using System.Text;
using Meta.XR.MRUtilityKit;
using Oculus.Interaction;
using Oculus.Interaction.Surfaces;
using UnityEngine;
using UnityEngine.UI;

namespace Immersa.Quest
{
    /// <summary>
    /// Risk prototype B.6: can the app start Meta's room scan (Space Setup) TWICE in the same session, and does the
    /// Guardian stay away? A panel shows the rooms MRUK knows and a short history of the scans; two buttons (point with
    /// the ray and pinch / trigger): SCAN starts Space Setup and then rereads the rooms, RELOAD only rereads them.
    /// Logs use the [Scan] tag (adb logcat -s Unity | findstr Scan).
    /// </summary>
    public class ScanProbe : MonoBehaviour
    {
        const string Tag = "[Scan] ";

        Text label;
        readonly List<string> history = new List<string>();
        string roomsText = "Reading rooms...";
        int scanCount;
        bool busy;
        float sessionStart;

        void Awake()
        {
            sessionStart = Time.realtimeSinceStartup;
            BuildPanel();
        }

        void Start()
        {
            var mruk = MRUK.Instance;
            if (mruk == null) { roomsText = "No MRUK in the scene."; Redraw(); return; }
            mruk.SceneLoadedEvent.AddListener(() => { Debug.Log(Tag + "scene loaded"); DescribeRooms(); });
            mruk.RoomCreatedEvent.AddListener(r => Debug.Log(Tag + "room created"));
            mruk.RoomRemovedEvent.AddListener(r => Debug.Log(Tag + "room removed"));
            DescribeRooms();
        }

        // ---- actions ----

        public async void Scan()
        {
            if (busy) return;
            busy = true;
            int n = ++scanCount;
            Add("Scan #" + n + " requested at +" + Elapsed() + " s");
            Debug.Log(Tag + "scan #" + n + " requested (session time " + Elapsed() + " s)");
            try
            {
                bool ok = await OVRScene.RequestSpaceSetup();
                Add("Scan #" + n + " returned: " + (ok ? "OK" : "FAILED") + " at +" + Elapsed() + " s");
                Debug.Log(Tag + "scan #" + n + " returned " + ok);
                await Reload("after scan #" + n);
            }
            catch (Exception e)
            {
                Add("Scan #" + n + " ERROR: " + e.Message);
                Debug.LogError(Tag + "scan #" + n + ": " + e);
            }
            busy = false;
            Redraw();
        }

        public async void ReloadButton()
        {
            if (busy) return;
            busy = true;
            try { await Reload("button"); }
            catch (Exception e) { Add("Reload ERROR: " + e.Message); Debug.LogError(Tag + e); }
            busy = false;
            Redraw();
        }

        async System.Threading.Tasks.Task Reload(string why)
        {
            var mruk = MRUK.Instance;
            if (mruk == null) { Add("No MRUK"); return; }
            var result = await mruk.LoadSceneFromDevice(false, true);
            Add("Reload (" + why + "): " + result);
            Debug.Log(Tag + "reload " + why + " -> " + result);
            DescribeRooms();
        }

        // ---- what the headset knows ----

        void DescribeRooms()
        {
            var mruk = MRUK.Instance;
            var sb = new StringBuilder();
            var rooms = mruk != null ? mruk.GetRooms() : null;
            sb.AppendLine((rooms?.Count ?? 0) + " room(s) known by the headset");
            if (rooms != null)
                for (int i = 0; i < rooms.Count; i++)
                {
                    var r = rooms[i];
                    int walls = 0, doors = 0, windows = 0, volumes = 0;
                    foreach (var a in r.Anchors)
                    {
                        if (a.HasAnyLabel(MRUKAnchor.SceneLabels.WALL_FACE)) walls++;
                        else if (a.HasAnyLabel(MRUKAnchor.SceneLabels.DOOR_FRAME)) doors++;
                        else if (a.HasAnyLabel(MRUKAnchor.SceneLabels.WINDOW_FRAME)) windows++;
                        else if (a.VolumeBounds.HasValue) volumes++;
                    }
                    string floor = "-";
                    if (r.FloorAnchor != null && r.FloorAnchor.PlaneRect.HasValue)
                        floor = r.FloorAnchor.PlaneRect.Value.width.ToString("0.0") + " x " + r.FloorAnchor.PlaneRect.Value.height.ToString("0.0") + " m";
                    string line = "Room " + (i + 1) + ": walls " + walls + ", doors " + doors + ", windows " + windows + ", furniture " + volumes + ", floor " + floor;
                    sb.AppendLine(line);
                    Debug.Log(Tag + line);
                }
            roomsText = sb.ToString();
            Redraw();
        }

        string Elapsed() => (Time.realtimeSinceStartup - sessionStart).ToString("0");

        void Add(string line)
        {
            history.Add(line);
            if (history.Count > 7) history.RemoveAt(0);
            Redraw();
        }

        void Redraw()
        {
            if (label == null) return;
            var sb = new StringBuilder(roomsText);
            sb.AppendLine();
            sb.AppendLine("Scans started: " + scanCount + (busy ? "   (working...)" : ""));
            foreach (var h in history) sb.AppendLine(h);
            label.text = sb.ToString();
        }

        // ---- panel and buttons: world-space, to the right of the Supabase panel ----

        void BuildPanel()
        {
            var canvasGo = new GameObject("ScanCanvas");
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            var rt = canvas.GetComponent<RectTransform>();
            rt.sizeDelta = new Vector2(900, 600);
            rt.localScale = Vector3.one * 0.001f;

            var bg = new GameObject("Background").AddComponent<Image>();
            bg.transform.SetParent(canvasGo.transform, false);
            bg.color = new Color(0.06f, 0.07f, 0.09f, 0.92f);
            var bgRt = bg.rectTransform;
            bgRt.anchorMin = Vector2.zero; bgRt.anchorMax = Vector2.one; bgRt.offsetMin = bgRt.offsetMax = Vector2.zero;

            var textGo = new GameObject("Text");
            textGo.transform.SetParent(canvasGo.transform, false);
            label = textGo.AddComponent<Text>();
            label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            label.fontSize = 30;
            label.color = new Color(0.85f, 0.95f, 0.95f);
            label.alignment = TextAnchor.UpperLeft;
            label.horizontalOverflow = HorizontalWrapMode.Wrap;
            label.verticalOverflow = VerticalWrapMode.Truncate;
            var tRt = label.rectTransform;
            tRt.anchorMin = Vector2.zero; tRt.anchorMax = Vector2.one;
            tRt.offsetMin = new Vector2(30, 30); tRt.offsetMax = new Vector2(-30, -30);

            Redraw();   // the text first: it must show even if a button fails

            // Two 3D buttons under the panel: SCAN and RELOAD.
            try
            {
                MakeButton("SCAN", new Vector3(-0.22f, -0.38f, -0.02f), new Color(0.1f, 0.65f, 0.65f), Scan);
                MakeButton("RELOAD", new Vector3(0.22f, -0.38f, -0.02f), new Color(0.35f, 0.4f, 0.5f), ReloadButton);
            }
            catch (Exception e)
            {
                Debug.LogError(Tag + "buttons failed: " + e);
                history.Add("Buttons failed: " + e.Message);
                Redraw();
            }
        }

        void MakeButton(string text, Vector3 localPos, Color color, Action onSelect)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = "Button-" + text;
            go.transform.SetParent(transform, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = new Vector3(0.36f, 0.12f, 0.03f);
            // The material is an asset in Resources: Shader.Find would return null in a build (the shader gets stripped).
            var rend = go.GetComponent<Renderer>();
            var baseMat = Resources.Load<Material>("ButtonUnlit");
            if (baseMat != null) rend.material = new Material(baseMat) { color = color };
            else Debug.LogError(Tag + "Resources/ButtonUnlit is missing");

            var textGo = new GameObject("Label");
            textGo.transform.SetParent(go.transform, false);
            textGo.transform.localPosition = new Vector3(0, 0, -0.55f);
            textGo.transform.localScale = new Vector3(1f / 0.36f, 1f / 0.12f, 1f / 0.03f) * 0.02f;   // undo the button's non-uniform scale
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
            var wrapper = go.AddComponent<InteractableUnityEventWrapper>();
            wrapper.InjectAllInteractableUnityEventWrapper(ray);
            wrapper.WhenSelect.AddListener(() => onSelect());
            go.SetActive(true);
        }

        // Put the panel to the right of the Supabase panel, 1.2 m in front of the head, once tracking has started.
        void LateUpdate()
        {
            if (placed || Time.realtimeSinceStartup - sessionStart < 1.5f) return;
            var cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
            if (cam == null) return;
            var fwd = cam.transform.forward; fwd.y = 0;
            fwd = fwd.sqrMagnitude < 1e-4f ? Vector3.forward : fwd.normalized;
            var right = Vector3.Cross(Vector3.up, fwd);
            transform.position = cam.transform.position + fwd * 1.2f + right * 1.0f;
            transform.rotation = Quaternion.LookRotation(fwd, Vector3.up);
            placed = true;
        }

        bool placed;
    }
}
