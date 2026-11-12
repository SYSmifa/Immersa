using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Immersa.Cloud;
using Immersa.Ui;
using Meta.XR.MRUtilityKit;
using UnityEngine;
using UnityEngine.UI;

namespace Immersa.Quest
{
    /// <summary>
    /// The headset app: sign in (code approved on the PC), the user's rooms and projects, the menu, opening and closing a
    /// project, saving. Replaces the early prototype panel. Logs use the [App] tag.
    /// </summary>
    public class AppController : MonoBehaviour
    {
        const string Tag = "[App] ";

        public SupabaseConfig config;   // URL and anon key (ignored by git)

        SupabaseClient client;
        AppMenu menu;
        LoginPanel login;
        RoomRegistry registry = new RoomRegistry();
        Task registryTask = Task.CompletedTask;
        ProjectEditSession session;
        readonly List<GameObject> openHolders = new List<GameObject>();
        Transform freeFrame;
        bool running;

        // Status card (loading, sign-in code, short notices).
        RectTransform statusCanvas, toastCanvas;
        Text statusTitle, statusBig, statusBody, toastText;
        int statusToken, toastToken;

        // ---- what the menu reads ----

        public List<ProjectInfo> Projects { get; private set; }
        public string OpenProjectId { get; private set; }
        public string Email => client?.Email;
        public bool HasUnsavedChanges => session != null && session.DirtyCount > 0;
        public int LiveRoomCount => registry.LiveCount;
        public string RoomMessage => scan != null ? scan.LastMessage : "";
        public bool DominantRight
        {
            get => PlayerPrefs.GetInt("immersa.dominantRight", 1) == 1;
            set => PlayerPrefs.SetInt("immersa.dominantRight", value ? 1 : 0);
        }

        ScanProbe scan;

        public string HeaderSubtitle() => OpenProjectId != null && Projects != null ? "Progetto: " + Projects.FirstOrDefault(p => p.id == OpenProjectId)?.name : (client?.Email ?? "");

        public RoomPlacement CurrentRoom()
        {
            var cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
            return cam != null ? registry.Current(cam.transform.position) : null;
        }

        public List<RoomPlacement> RoomPlacements() => registry.Saved.Select(r => registry.Get(r.id)).Where(p => p != null).ToList();

        // ---- start ----

        void Awake()
        {
            BuildStatusCard();
            menu = gameObject.AddComponent<AppMenu>();
            menu.Init(this);
            login = gameObject.AddComponent<LoginPanel>();
        }

        async void Start()
        {
            scan = FindFirstObjectByType<ScanProbe>();
            if (scan != null) scan.ScanFinished += () => { registryTask = registry.Refresh(client); _ = AfterRegistry(true); };
            await RunAsync();
        }

        async Task AfterRegistry(bool reopenRoom = false)
        {
            try { await registryTask; } catch (Exception e) { Debug.LogError(Tag + e); }
            if (reopenRoom) menu.Open(AppMenu.Tab.Room); else menu.Refresh();
        }

        async Task RunAsync()
        {
            if (running) return;
            running = true;
            try
            {
                if (config == null || string.IsNullOrEmpty(config.url) || string.IsNullOrEmpty(config.anonKey))
                { Status("Immersa", "Supabase non è configurato:\nAssets/Config/LocalSupabaseConfig manca o è vuoto."); return; }

                client = new SupabaseClient(config);
                AppSession.Client = client;
                Status("Immersa", "Mi collego...");

                bool ok = await client.RestoreSession();
                if (!ok) { HideStatus(); await login.Run(client); }

                Status("Immersa", "Carico i progetti...");
                Projects = await client.ListProjects();
                Debug.Log(Tag + Projects.Count + " project(s)");
                HideStatus();
                menu.Open(AppMenu.Tab.Projects);

                // The rooms are read in the background; opening a project waits for them.
                registryTask = registry.Refresh(client);
                _ = AfterRegistry();
            }
            catch (Exception e)
            {
                Debug.LogError(Tag + e);
                Status("Errore", e.Message);
            }
            finally { running = false; }
        }

        // ---- projects ----

        public async void OpenProject(ProjectInfo p)
        {
            if (OpenProjectId == p.id) { menu.Close(); return; }
            try
            {
                CloseProject(silent: true);
                menu.Close();
                Status("Carico il progetto", p.name);
                await registryTask;

                session = await ProjectEditSession.Open(client, p);
                session.Changed += () => { if (menu.IsOpen) menu.Refresh(); };
                OpenProjectId = p.id;

                Transform FrameFor(string roomId)
                {
                    var pl = string.IsNullOrEmpty(roomId) ? null : registry.Get(roomId);
                    if (pl != null && pl.found) return pl.frame;
                    return freeFrame != null ? freeFrame : (freeFrame = CreateFreeFrame());   // free space, and the fallback for a room that was not recognized
                }

                var loader = new ProjectModelLoader(client);
                var res = await loader.LoadModels(session.Models, FrameFor, text => Status("Carico il progetto", text));
                foreach (var (model, holder) in res.items) { session.Attach(model, holder); openHolders.Add(holder); }

                var notFound = p.roomIds.Select(id => registry.Get(id)).Where(r => r != null && !r.found).Select(r => r.name).ToList();
                var missing = p.roomIds.Count(id => registry.Get(id) == null);
                string note = res.problems.Count > 0 ? res.problems[0] : null;
                if (!session.CanSave) note = "Il salvataggio è spento: " + session.CannotSaveReason;
                else if (notFound.Count > 0) note = "Stanza non riconosciuta: " + string.Join(", ", notFound) + ". I modelli sono davanti a te.";
                else if (missing > 0) note = "Una stanza del progetto non è nel tuo account.";
                HideStatus();
                Notify(note ?? "Progetto caricato", note != null ? 3.5f : 1.4f);
                Debug.Log(Tag + "opened '" + p.name + "': " + res.placed + "/" + res.total + " model(s)");
            }
            catch (Exception e)
            {
                Debug.LogError(Tag + e);
                Status("Errore", "Non riesco ad aprire il progetto:\n" + e.Message);
            }
        }

        public void CloseProject(bool silent = false)
        {
            foreach (var h in openHolders) if (h != null) Destroy(h);
            openHolders.Clear();
            if (freeFrame != null) { Destroy(freeFrame.gameObject); freeFrame = null; }
            bool was = OpenProjectId != null;
            OpenProjectId = null;
            session = null;
            if (was && !silent) Notify("Progetto chiuso", 1.4f);
            if (menu != null && menu.IsOpen) menu.Refresh();
        }

        public async void SaveProject()
        {
            if (session == null) return;
            string msg;
            try { msg = await session.Save(); }
            catch (Exception e) { msg = "Non salvato: " + e.Message; Debug.LogError(Tag + e); }
            Notify(msg, 2f);
            menu.Refresh();
        }

        public void SignOut()
        {
            CloseProject(silent: true);
            menu.Close();
            client?.SignOut();
            Projects = null;
            Notify("Disconnesso", 1.2f);
            _ = RunAsync();
        }

        // ---- rooms (scanning is done by ScanProbe, which keeps its own hidden test panel) ----

        public void ScanRoom()
        {
            if (scan == null) { Notify("Scansione non disponibile", 2f); return; }
            menu.Close();
            scan.Scan();
        }

        public void SaveCurrentRoom()
        {
            if (scan == null) { Notify("Salvataggio stanza non disponibile", 2f); return; }
            scan.SaveRoom();
            Notify("Salvo la stanza...", 1.4f);
        }

        /// <summary>Free-space frame: on the floor, 2.5 m ahead of where the user looks, turned like the user.</summary>
        Transform CreateFreeFrame()
        {
            var cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
            var go = new GameObject("FreeFrame");
            var fwd = cam != null ? cam.transform.forward : Vector3.forward;
            fwd.y = 0;
            fwd = fwd.sqrMagnitude < 1e-4f ? Vector3.forward : fwd.normalized;
            var head = cam != null ? cam.transform.position : Vector3.zero;
            go.transform.position = new Vector3(head.x, 0f, head.z) + fwd * 2.5f;   // the tracking origin is the floor
            go.transform.rotation = Quaternion.LookRotation(fwd, Vector3.up);
            return go.transform;
        }

        // ---- the status card ----

        void BuildStatusCard()
        {
            statusCanvas = UiKit.NewCanvas("StatusCanvas", transform, 760, 440);
            UiKit.Box(statusCanvas, 0, 0, 760, 440, UiTheme.Bg1, true, "Card");
            statusTitle = UiKit.Label(statusCanvas, 40, 28, 680, 56, "", 36, UiTheme.HeaderText, TextAnchor.UpperLeft, true, "Title");
            statusBig = UiKit.Label(statusCanvas, 40, 96, 680, 140, "", 110, UiTheme.Accent2, TextAnchor.MiddleCenter, true, "Big");
            statusBody = UiKit.Label(statusCanvas, 40, 250, 680, 170, "", 26, UiTheme.HeaderSub, TextAnchor.UpperLeft, false, "Body");
            statusCanvas.gameObject.SetActive(false);

            toastCanvas = UiKit.NewCanvas("ToastCanvas", transform, 700, 110);
            UiKit.Box(toastCanvas, 0, 0, 700, 110, UiTheme.Bg1, true, "Card");
            toastText = UiKit.Label(toastCanvas, 30, 0, 640, 110, "", 32, UiTheme.HeaderText, TextAnchor.MiddleCenter, true, "Text");
            toastCanvas.gameObject.SetActive(false);
        }

        void Status(string title, string body, string big = null)
        {
            statusToken++;
            statusTitle.text = title;
            statusBody.text = body ?? "";
            statusBig.text = big ?? "";
            var cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
            if (cam != null)
            {
                var fwd = cam.transform.forward; fwd.y = 0;
                fwd = fwd.sqrMagnitude < 1e-4f ? Vector3.forward : fwd.normalized;
                statusCanvas.position = cam.transform.position + fwd * 1.1f + Vector3.down * 0.05f;
                statusCanvas.rotation = Quaternion.LookRotation(fwd, Vector3.up);
            }
            statusCanvas.gameObject.SetActive(true);
        }

        void HideStatus() { statusToken++; statusCanvas.gameObject.SetActive(false); }

        /// <summary>A short message in front of the user, gone after a moment ("Progetto caricato").</summary>
        public async void Notify(string text, float seconds = 1.4f)
        {
            toastToken++;
            int token = toastToken;
            toastText.text = text;
            var cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
            if (cam != null)
            {
                var fwd = cam.transform.forward; fwd.y = 0;
                fwd = fwd.sqrMagnitude < 1e-4f ? Vector3.forward : fwd.normalized;
                toastCanvas.position = cam.transform.position + fwd * 1.0f + Vector3.down * 0.25f;
                toastCanvas.rotation = Quaternion.LookRotation(fwd, Vector3.up);
            }
            toastCanvas.gameObject.SetActive(true);
            await Task.Delay((int)(seconds * 1000));
            if (this != null && token == toastToken) toastCanvas.gameObject.SetActive(false);
        }
    }
}
