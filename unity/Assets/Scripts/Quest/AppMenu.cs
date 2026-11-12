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
        RectTransform canvas;
        Tab tab = Tab.Projects;
        int page;
        bool rebuild = true;
        float menuYaw, menuY;
        bool following;
        bool wasPinching;
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
            if (rebuild && IsOpen) { rebuild = false; Build(); }
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

            if (hands == null || Time.unscaledTime > handsRefresh) { hands = FindObjectsByType<OVRHand>(FindObjectsInactive.Exclude, FindObjectsSortMode.None); handsRefresh = Time.unscaledTime + 1.5f; }
            OVRHand other = null; bool dominantPinching = false;
            foreach (var h in hands)
            {
                if (h == null || !h.IsTracked) continue;
                bool pinching = h.GetFingerIsPinching(OVRHand.HandFinger.Index);
                if (h.IsDominantHand) dominantPinching |= pinching; else other = pinching ? h : other;
            }
            bool pinchNow = other != null && !dominantPinching;
            if (pinchNow && !wasPinching) Toggle();   // right at the press, only when the dominant hand is not pinching
            wasPinching = pinchNow;
        }

        // ---- drawing ----

        void Build()
        {
            for (int i = canvas.childCount - 1; i >= 0; i--) Destroy(canvas.GetChild(i).gameObject);

            UiKit.Box(canvas, 0, 0, W, H, UiTheme.Bg1, true, "Panel");
            UiKit.Box(canvas, 0, 0, W, 150, new Color(1, 1, 1, 0.04f), true, "HeaderGlow");
            UiKit.Label(canvas, 44, 26, 560, 60, "Immersa", 46, UiTheme.HeaderText, TextAnchor.UpperLeft, true, "Title");
            UiKit.Label(canvas, 44, 86, 600, 34, app.HeaderSubtitle(), 24, UiTheme.HeaderSub, TextAnchor.UpperLeft, false, "Subtitle");
            if (app.HasUnsavedChanges)
                UiKit.Pill(canvas, W - 230, 30, 186, 64, "Salva", 28, UiTheme.Accent, Color.white, UiTheme.AccentHover, () => app.SaveProject());

            var content = UiKit.NewRect(canvas, "Content", 0, 150, W, 730);
            switch (tab)
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
                UiKit.Pill(canvas, 44 + i * (bw + 14), 900, bw, 84, names[i], 28, on ? UiTheme.Accent : UiTheme.Glass, Color.white, on ? UiTheme.AccentHover : UiTheme.GlassHover,
                    () => { tab = t; page = 0; Refresh(); });
            }
        }

        // ---- Progetti ----

        struct Row { public bool header; public string text; public ProjectInfo project; public float height => header ? 64f : 140f; }

        void BuildProjects(RectTransform content)
        {
            var projects = app.Projects;
            if (projects == null) { UiKit.Label(content, 44, 40, W - 88, 60, "Carico i progetti...", 30, UiTheme.HeaderSub); return; }
            if (projects.Count == 0) { UiKit.Label(content, 44, 40, W - 88, 120, "Nessun progetto.\nCreane uno dal PC.", 30, UiTheme.HeaderSub); return; }

            // Rows: with a recognized room, its projects come first under "IN QUESTA STANZA", the others under "ALTRE STANZE".
            var rows = new List<Row>();
            var current = app.CurrentRoom();
            if (current != null)
            {
                var here = projects.Where(p => p.roomIds.Contains(current.roomId)).ToList();
                var other = projects.Except(here).ToList();
                if (here.Count > 0) { rows.Add(new Row { header = true, text = "IN QUESTA STANZA · " + current.name }); rows.AddRange(here.Select(p => new Row { project = p })); }
                if (other.Count > 0) { if (here.Count > 0) rows.Add(new Row { header = true, text = "ALTRE STANZE" }); rows.AddRange(other.Select(p => new Row { project = p })); }
            }
            else rows.AddRange(projects.Select(p => new Row { project = p }));

            // Pages of rows that fit in the height available.
            const float avail = 650f;
            var pages = new List<List<Row>>();
            float used = 0; var cur = new List<Row>();
            foreach (var r in rows)
            {
                if (used + r.height > avail && cur.Count > 0) { pages.Add(cur); cur = new List<Row>(); used = 0; }
                cur.Add(r); used += r.height + 8;
            }
            if (cur.Count > 0) pages.Add(cur);
            page = Mathf.Clamp(page, 0, pages.Count - 1);

            var tones = UiTheme.ProjectTones(projects.Select(p => (p.id, p.tone)).ToList());
            float y = 8;
            foreach (var r in pages[page])
            {
                if (r.header) { UiKit.Label(content, 52, y + 20, W - 104, 34, r.text, 22, UiTheme.HeaderSub, TextAnchor.UpperLeft, true); y += r.height + 8; continue; }
                DrawProject(content, y, r.project, tones[r.project.id]);
                y += r.height + 8;
            }

            if (pages.Count > 1)
            {
                UiKit.Label(content, W / 2 - 80, 672, 160, 44, (page + 1) + " / " + pages.Count, 26, UiTheme.HeaderSub, TextAnchor.MiddleCenter);
                if (page > 0) UiKit.Pill(content, 44, 664, 120, 56, "<", 30, UiTheme.Glass, Color.white, UiTheme.GlassHover, () => { page--; Refresh(); });
                if (page < pages.Count - 1) UiKit.Pill(content, W - 164, 664, 120, 56, ">", 30, UiTheme.Glass, Color.white, UiTheme.GlassHover, () => { page++; Refresh(); });
            }
        }

        void DrawProject(RectTransform content, float y, ProjectInfo p, int toneIndex)
        {
            bool open = app.OpenProjectId == p.id;
            var card = UiKit.Box(content, 44, y, W - 88, 132, open ? UiTheme.AccentSoft : UiTheme.Surface, true, "Project-" + p.name);
            var tone = UiTheme.Tones[Mathf.Clamp(toneIndex, 0, UiTheme.Tones.Length - 1)];
            UiKit.Box(card.transform, 16, 17, 98, 98, tone.a, true, "Tile");
            string initial = string.IsNullOrEmpty(p.name) ? "?" : p.name.Substring(0, 1).ToUpperInvariant();
            UiKit.Label(card.transform, 16, 17, 98, 98, initial, 54, Color.white, TextAnchor.MiddleCenter, true, "Initial");
            UiKit.Label(card.transform, 136, 22, W - 88 - 136 - (open ? 190 : 24), 44, p.name, 34, UiTheme.Text, TextAnchor.UpperLeft, true, "Name");
            UiKit.Label(card.transform, 136, 72, W - 88 - 136 - 24, 36, Subtitle(p), 24, UiTheme.Sub, TextAnchor.UpperLeft, false, "Sub");
            if (open) UiKit.Pill(card.transform, W - 88 - 176, 40, 150, 52, "Aperto", 24, UiTheme.Accent, Color.white, UiTheme.Accent, null);
            UiKit.Hotspot(card.rectTransform, () => app.OpenProject(p), card, UiTheme.SurfaceHover, open ? UiTheme.AccentSoft : UiTheme.Surface);
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
            UiKit.Pill(content, 44, 130, 270, 70, "Destra", 28, right ? UiTheme.Accent : UiTheme.Glass, Color.white, right ? UiTheme.AccentHover : UiTheme.GlassHover, () => { app.DominantRight = true; Refresh(); });
            UiKit.Pill(content, 330, 130, 270, 70, "Sinistra", 28, !right ? UiTheme.Accent : UiTheme.Glass, Color.white, !right ? UiTheme.AccentHover : UiTheme.GlassHover, () => { app.DominantRight = false; Refresh(); });
            UiKit.Label(content, 44, 240, W - 88, 200, "Il menu si apre con il pinch della mano non dominante, o con i tasti A, B, X, Y.\n\nMisure, distanze, annotazioni e snap arriveranno nei prossimi aggiornamenti.", 24, UiTheme.HeaderSub);
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
