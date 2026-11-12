using System;
using System.Collections.Generic;
using System.Linq;
using Immersa.Cloud;
using Immersa.Ui;
using UnityEngine;
using UnityEngine.UI;

namespace Immersa.Quest
{
    /// <summary>
    /// The headset menu ("Aura"): a panel that follows the head with a title, a content page and a bottom bar
    /// (Progetti / Stanza / Opzioni / Account). It opens and closes with the pinch of the hand that is NOT the dominant one,
    /// or with the controller buttons A/B/X/Y, like the web app. Texts are in Italian like the web UI.
    /// </summary>
    public class AppMenu : MonoBehaviour
    {
        public enum Tab { Projects, Room, Options, Account }

        const float W = 900f, H = 1000f;
        const float Distance = 1.1f;
        const float FollowAngle = 43f;      // the head turns this far before the menu follows (like the web app)
        static readonly string[] Months = { "gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic" };

        AppController app;
        RectTransform canvas, root;
        Tab tab = Tab.Projects;
        bool rebuild = true;
        float menuYaw, menuY;
        bool following;
        bool wasPinching;
        bool objectView;                 // the object view of the selected model instead of a tab
        ObjectPanel objectPanel;
        ProjectEditSession panelSession;
        bool hold;                       // a drag is going on: do not redraw
        OVRHand[] hands;
        float handsRefresh;

        public bool IsOpen => canvas != null && canvas.gameObject.activeSelf;

        public void Init(AppController owner)
        {
            app = owner;
            canvas = UiKit.NewCanvas("MenuCanvas", transform, W, H);
            canvas.gameObject.SetActive(false);
        }

        public void Open(Tab? goTo = null)
        {
            if (goTo.HasValue) tab = goTo.Value;
            if (canvas.gameObject.activeSelf && !goTo.HasValue) return;
            var cam = Head();
            if (cam != null) { menuYaw = cam.eulerAngles.y; menuY = cam.position.y - 0.08f; following = false; Place(cam, true); }
            canvas.gameObject.SetActive(true);
            rebuild = true;
        }

        public void Close() { if (canvas != null) canvas.gameObject.SetActive(false); }
        public void Toggle() { if (IsOpen) Close(); else Open(); }

        /// <summary>Redraw the current page (next frame: the call may come from a button of the page itself).</summary>
        public void Refresh() { rebuild = true; }

        /// <summary>While a drag is going on (a colour wheel, a slider) the page must not be redrawn: it would destroy the drag area.</summary>
        public void Hold(bool on) { hold = on; if (!on) rebuild = true; }

        public void ResetObjectPage() { if (objectPanel != null) objectPanel.Reset(); }

        /// <summary>Opens the menu on the object view of the selected model.</summary>
        public void OpenObject() { objectView = true; if (objectPanel != null) objectPanel.Reset(); Open(tab); rebuild = true; }

        // ---- following the head ----

        static Transform Head()
        {
            var cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
            return cam != null ? cam.transform : null;
        }

        void Update()
        {
            ReadOpenTriggers();
            if (!IsOpen) return;
            var cam = Head();
            if (cam == null) return;

            // The menu stays put until the head has turned FollowAngle degrees, then it turns after it until they agree again.
            float delta = Mathf.DeltaAngle(menuYaw, cam.eulerAngles.y);
            if (!following && Mathf.Abs(delta) > FollowAngle) following = true;
            if (following)
            {
                menuYaw = Mathf.LerpAngle(menuYaw, cam.eulerAngles.y, 1f - Mathf.Exp(-4f * Time.deltaTime));
                if (Mathf.Abs(Mathf.DeltaAngle(menuYaw, cam.eulerAngles.y)) < 6f) following = false;
            }
            // Up and down when the user stands up or sits down; small movements are ignored.
            float targetY = cam.position.y - 0.08f;
            if (Mathf.Abs(targetY - menuY) > 0.12f) menuY = Mathf.Lerp(menuY, targetY, 1f - Mathf.Exp(-3f * Time.deltaTime));
            Place(cam, false);
        }

        void LateUpdate()
        {
            if (rebuild && IsOpen && !hold) { rebuild = false; Build(); }
        }

        void Place(Transform cam, bool snap)
        {
            var dir = Quaternion.Euler(0, menuYaw, 0) * Vector3.forward;
            var pos = new Vector3(cam.position.x, menuY, cam.position.z) + dir * Distance;
            canvas.position = pos;
            canvas.rotation = Quaternion.LookRotation(dir, Vector3.up);   // a canvas reads correctly when its +Z points away from the viewer
        }

        // ---- opening and closing: the non-dominant pinch, or A/B/X/Y ----

        void ReadOpenTriggers()
        {
            if (OVRInput.GetDown(OVRInput.Button.One) || OVRInput.GetDown(OVRInput.Button.Two) || OVRInput.GetDown(OVRInput.Button.Three) || OVRInput.GetDown(OVRInput.Button.Four))
            { Toggle(); return; }

            if (hands == null || Time.unscaledTime > handsRefresh)
            {
                hands = FindObjectsByType<OVRHand>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
                handsRefresh = Time.unscaledTime + 1.5f;
                SecondaryHand.Apply(app.DominantRight);   // the secondary hand has no ray: it only opens the menu
            }

            // The dominant hand is the one chosen in Options (Destra / Sinistra); the other one opens and closes the menu.
            bool secondaryIsLeft = app.DominantRight;
            OVRHand secondary = null; bool dominantPinching = false; bool secondaryPinching = false;
            foreach (var h in hands)
            {
                if (h == null || !h.IsTracked) continue;
                bool pinching = h.GetFingerIsPinching(OVRHand.HandFinger.Index);
                if (SecondaryHand.IsLeft(h.transform) == secondaryIsLeft) { secondary = h; secondaryPinching |= pinching; }
                else dominantPinching |= pinching;
            }
            bool pinchNow = secondary != null && secondaryPinching && !dominantPinching;
            if (pinchNow && !wasPinching) Toggle();   // right at the press, only when the dominant hand is not pinching
            wasPinching = pinchNow;
        }

        // ---- drawing ----

        void Build()
        {
            // Only our own elements are redrawn: the canvas also holds the hidden objects of the compositor layer (Meta OVROverlayCanvas).
            if (root != null) Destroy(root.gameObject);
            root = UiKit.NewRect(root, "Root", 0, 0, W, H);

            UiKit.Box(root, 0, 0, W, H, UiTheme.Bg1, true, "Panel");
            UiKit.Box(root, 0, 0, W, 150, new Color(1, 1, 1, 0.04f), true, "HeaderGlow");
            UiKit.Label(root, 44, 26, 560, 60, "Immersa", 46, UiTheme.HeaderText, TextAnchor.UpperLeft, true, "Title");
            UiKit.Label(root, 44, 86, 600, 34, objectView && app.Session?.SelectedModel != null ? app.Session.SelectedModel.Name : app.HeaderSubtitle(), 24, UiTheme.HeaderSub, TextAnchor.UpperLeft, false, "Subtitle");
            if (app.HasUnsavedChanges)
                UiKit.Pill(root, W - 230, 30, 186, 64, "Salva", 28, UiTheme.Accent, Color.white, UiTheme.AccentHover, () => app.SaveProject());

            var content = UiKit.NewRect(root, "Content", 0, 150, W, 730);
            var session = app.Session;
            if (objectView && (session == null || session.Selected == null)) objectView = false;
            if (objectView)
            {
                if (objectPanel == null || panelSession != session) { objectPanel = new ObjectPanel(session, Refresh, Hold); panelSession = session; }
                objectPanel.Build(content);
            }
            else switch (tab)
            {
                case Tab.Projects: BuildProjects(content); break;
                case Tab.Room: BuildRoom(content); break;
                case Tab.Options: BuildOptions(content); break;
                case Tab.Account: BuildAccount(content); break;
            }

            // Bottom bar.
            string[] names = { "Progetti", "Stanza", "Opzioni", "Account" };
            float bw = (W - 88f - 3 * 14f) / 4f;
            for (int i = 0; i < 4; i++)
            {
                var t = (Tab)i;
                bool on = t == tab;
                UiKit.Pill(root, 44 + i * (bw + 14), 900, bw, 84, names[i], 28, on ? UiTheme.Accent : UiTheme.Glass, Color.white, on ? UiTheme.AccentHover : UiTheme.GlassHover,
                    () => { tab = t; scroll = 0; objectView = false; Refresh(); });
            }
        }

        // ---- Progetti ----

        struct Row { public bool header; public string text; public ProjectInfo project; public float height => header ? 64f : 132f; }

        const float ListY = 80f, ListH = 640f, RowGap = 8f;
        string search = "";
        float scroll;
        RectTransform listRoot, track, thumb;
        Dictionary<string, int> tones;

        /// <summary>Lower case without accents, so "caffè" is found by "caffe".</summary>
        static string Fold(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var sb = new System.Text.StringBuilder(s.Length);
            foreach (char c in s.ToLowerInvariant())
                sb.Append("àáâãäå".IndexOf(c) >= 0 ? 'a' : "èéêë".IndexOf(c) >= 0 ? 'e' : "ìíîï".IndexOf(c) >= 0 ? 'i' : "òóôõö".IndexOf(c) >= 0 ? 'o' : "ùúûü".IndexOf(c) >= 0 ? 'u' : c == 'ç' ? 'c' : c == 'ñ' ? 'n' : c);
            return sb.ToString();
        }

        void BuildProjects(RectTransform content)
        {
            var projects = app.Projects;
            if (projects == null) { UiKit.Label(content, 44, 40, W - 88, 60, "Carico i progetti...", 30, UiTheme.HeaderSub); return; }
            if (projects.Count == 0) { UiKit.Label(content, 44, 40, W - 88, 120, "Nessun progetto.\nCreane uno dal PC.", 30, UiTheme.HeaderSub); return; }

            tones = UiTheme.ProjectTones(projects.Select(p => (p.id, p.tone)).ToList());
            // The search field is built once: typing redraws only the list below it, so the keyboard keeps working.
            new UiTextField(content, 44, 4, W - 88, 64, search, "Cerca un progetto", t => { search = t; scroll = 0; RedrawList(); }, null, false, false, 60, 28);

            listRoot = UiKit.NewRect(content, "List", 0, ListY, W, ListH);
            listRoot.gameObject.AddComponent<RectMask2D>();

            // Scroll bar on the right: drag the rail with the ray.
            track = UiKit.NewRect(content, "Track", W - 36, ListY, 24, ListH);
            var rail = track.gameObject.AddComponent<Image>(); rail.color = new Color(1, 1, 1, 0.10f); rail.sprite = UiKit.Rounded(); rail.type = Image.Type.Sliced; rail.raycastTarget = false;
            thumb = UiKit.NewRect(track, "Thumb", 0, 0, 24, 80);
            var ti = thumb.gameObject.AddComponent<Image>(); ti.color = UiTheme.Accent; ti.sprite = UiKit.Rounded(); ti.type = Image.Type.Sliced; ti.raycastTarget = false;
            UiKit.DragArea(track, p =>
            {
                float total = RowsTotal(); float max = Mathf.Max(0, total - ListH);
                float thumbFrac = Mathf.Clamp(ListH / Mathf.Max(total, 1f), 0.08f, 1f);
                scroll = Mathf.Clamp01((p.y - thumbFrac / 2f) / Mathf.Max(0.0001f, 1f - thumbFrac)) * max;
                RedrawList();
            });
            RedrawList();
        }

        List<Row> BuildRows()
        {
            var rows = new List<Row>();
            var all = app.Projects.Where(p => string.IsNullOrEmpty(search) || Fold(p.name).Contains(Fold(search))).ToList();
            var current = app.CurrentRoom();
            if (current != null)
            {
                var here = all.Where(p => p.roomIds.Contains(current.roomId)).ToList();
                var other = all.Except(here).ToList();
                if (here.Count > 0) { rows.Add(new Row { header = true, text = "IN QUESTA STANZA · " + current.name }); rows.AddRange(here.Select(p => new Row { project = p })); }
                if (other.Count > 0) { if (here.Count > 0) rows.Add(new Row { header = true, text = "ALTRE STANZE" }); rows.AddRange(other.Select(p => new Row { project = p })); }
            }
            else rows.AddRange(all.Select(p => new Row { project = p }));
            return rows;
        }

        float RowsTotal() { float t = 0; foreach (var r in BuildRows()) t += r.height + RowGap; return t; }

        void RedrawList()
        {
            if (listRoot == null) return;
            for (int i = listRoot.childCount - 1; i >= 0; i--) Destroy(listRoot.GetChild(i).gameObject);
            var rows = BuildRows();
            float total = 0; foreach (var r in rows) total += r.height + RowGap;
            float max = Mathf.Max(0, total - ListH);
            scroll = Mathf.Clamp(scroll, 0, max);

            if (rows.Count == 0) UiKit.Label(listRoot, 44, 30, W - 88, 60, "Nessun progetto trovato.", 28, UiTheme.HeaderSub);

            float y = 0;
            foreach (var r in rows)
            {
                float top = y - scroll;
                if (top + r.height >= 0 && top <= ListH)   // drawn (clipped by the mask) when it touches the window
                {
                    if (r.header) UiKit.Label(listRoot, 52, top + 20, W - 104, 34, r.text, 22, UiTheme.HeaderSub, TextAnchor.UpperLeft, true);
                    else DrawProject(listRoot, top, r.project, tones[r.project.id], top >= 0 && top + r.height <= ListH);   // only fully visible cards can be selected
                }
                y += r.height + RowGap;
            }

            bool scrollable = total > ListH;
            track.gameObject.SetActive(scrollable);
            if (scrollable)
            {
                float thumbH = Mathf.Max(60f, ListH * ListH / total);
                thumb.sizeDelta = new Vector2(24, thumbH);
                thumb.anchoredPosition = new Vector2(0, -(scroll / max) * (ListH - thumbH));
            }
        }

        void DrawProject(RectTransform content, float y, ProjectInfo p, int toneIndex, bool selectable)
        {
            bool open = app.OpenProjectId == p.id;
            var card = UiKit.Box(content, 44, y, W - 88 - 40, 132, open ? UiTheme.AccentSoft : UiTheme.Surface, true, "Project-" + p.name);
            var tone = UiTheme.Tones[Mathf.Clamp(toneIndex, 0, UiTheme.Tones.Length - 1)];
            UiKit.Box(card.transform, 16, 17, 98, 98, tone.a, true, "Tile");
            string initial = string.IsNullOrEmpty(p.name) ? "?" : p.name.Substring(0, 1).ToUpperInvariant();
            UiKit.Label(card.transform, 16, 17, 98, 98, initial, 54, Color.white, TextAnchor.MiddleCenter, true, "Initial");
            UiKit.Label(card.transform, 136, 22, W - 128 - 136 - (open ? 190 : 24), 44, p.name, 34, UiTheme.Text, TextAnchor.UpperLeft, true, "Name");
            UiKit.Label(card.transform, 136, 72, W - 128 - 136 - 24, 36, Subtitle(p), 24, UiTheme.Sub, TextAnchor.UpperLeft, false, "Sub");
            if (open) UiKit.Pill(card.transform, W - 128 - 176, 40, 150, 52, "Aperto", 24, UiTheme.Accent, Color.white, UiTheme.Accent, null);
            if (selectable) UiKit.Hotspot(card.rectTransform, () => app.OpenProject(p), card, UiTheme.SurfaceHover, open ? UiTheme.AccentSoft : UiTheme.Surface);
        }

        static string Subtitle(ProjectInfo p)
        {
            string rooms = p.roomCount == 0 ? "nessuna stanza" : p.roomCount == 1 ? "1 stanza" : p.roomCount + " stanze";
            if (DateTime.TryParse(p.updatedAt, null, System.Globalization.DateTimeStyles.RoundtripKind, out var d))
                return rooms + " · " + d.ToLocalTime().Day + " " + Months[d.ToLocalTime().Month - 1];
            return rooms;
        }

        // ---- Stanza ----

        void BuildRoom(RectTransform content)
        {
            UiKit.Label(content, 44, 16, W - 88, 44, "Stanze del visore: " + app.LiveRoomCount, 30, UiTheme.HeaderText, TextAnchor.UpperLeft, true);
            float y = 76;
            var placements = app.RoomPlacements();
            if (placements.Count == 0) UiKit.Label(content, 44, y, W - 88, 60, "Nessuna stanza salvata nel tuo account.", 26, UiTheme.HeaderSub);
            foreach (var p in placements.Take(7))
            {
                var card = UiKit.Box(content, 44, y, W - 88, 78, UiTheme.Surface, true, "Room-" + p.name);
                UiKit.Label(card.transform, 24, 8, W - 88 - 48, 34, p.name, 28, UiTheme.Text, TextAnchor.UpperLeft, true);
                UiKit.Label(card.transform, 24, 42, W - 88 - 48, 30, p.status, 21, p.found ? UiTheme.Good : UiTheme.Notice);
                y += 86;
            }
            if (placements.Count > 7) UiKit.Label(content, 44, y, W - 88, 30, "+ " + (placements.Count - 7) + " altre", 22, UiTheme.HeaderSub);

            if (!string.IsNullOrEmpty(app.RoomMessage)) UiKit.Label(content, 44, 600, W - 88, 60, app.RoomMessage, 24, UiTheme.HeaderSub);
            UiKit.Pill(content, 44, 664, 390, 64, "Scansiona stanza", 26, UiTheme.Accent, Color.white, UiTheme.AccentHover, () => app.ScanRoom());
            UiKit.Pill(content, 466, 664, 390, 64, "Salva stanza", 26, UiTheme.Glass, Color.white, UiTheme.GlassHover, () => app.SaveCurrentRoom());
        }

        // ---- Opzioni ----

        void BuildOptions(RectTransform content)
        {
            UiKit.Label(content, 44, 16, W - 88, 44, "Opzioni", 30, UiTheme.HeaderText, TextAnchor.UpperLeft, true);
            UiKit.Label(content, 44, 84, W - 88, 36, "Mano dominante", 26, UiTheme.HeaderSub);
            bool right = app.DominantRight;
            UiKit.Pill(content, 44, 130, 270, 70, "Destra", 28, right ? UiTheme.Accent : UiTheme.Glass, Color.white, right ? UiTheme.AccentHover : UiTheme.GlassHover, () => { app.DominantRight = true; SecondaryHand.Apply(true); Refresh(); });
            UiKit.Pill(content, 330, 130, 270, 70, "Sinistra", 28, !right ? UiTheme.Accent : UiTheme.Glass, Color.white, !right ? UiTheme.AccentHover : UiTheme.GlassHover, () => { app.DominantRight = false; SecondaryHand.Apply(false); Refresh(); });
            UiKit.Label(content, 44, 240, W - 88, 200, "Il menu si apre e si chiude con il pinch della mano non dominante (quella senza raggio), o con i tasti A, B, X, Y.\n\nMisure, distanze, annotazioni e snap arriveranno nei prossimi aggiornamenti.", 24, UiTheme.HeaderSub);
        }

        // ---- Account ----

        void BuildAccount(RectTransform content)
        {
            UiKit.Label(content, 44, 16, W - 88, 44, "Account", 30, UiTheme.HeaderText, TextAnchor.UpperLeft, true);
            var card = UiKit.Box(content, 44, 76, W - 88, 120, UiTheme.Surface, true, "Account");
            UiKit.Label(card.transform, 24, 16, W - 88 - 48, 36, app.Email ?? "-", 30, UiTheme.Text, TextAnchor.UpperLeft, true);
            UiKit.Label(card.transform, 24, 62, W - 88 - 48, 36, "Versione " + Application.version + " · build di sviluppo", 22, UiTheme.Sub);
            float y = 220;
            if (app.OpenProjectId != null)
            {
                UiKit.Pill(content, 44, y, W - 88, 70, "Chiudi il progetto", 28, UiTheme.Glass, Color.white, UiTheme.GlassHover, () => app.CloseProject());
                y += 90;
            }
            UiKit.Pill(content, 44, y, W - 88, 70, "Esci", 28, UiTheme.Bad, Color.white, UiTheme.Bad, () => app.SignOut());
        }
    }
}
