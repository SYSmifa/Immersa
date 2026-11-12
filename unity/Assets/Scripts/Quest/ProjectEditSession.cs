using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Immersa.Cloud;
using Immersa.Core;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>
    /// The project being edited in the headset: the models as they are in the cloud, the changes made since (moved models),
    /// the selection, and saving. Nothing is saved by itself ("Save changes", like the web app).
    ///
    /// Safety: the models are saved back as the Core types serialize them. Before the first save the parsed list is written
    /// again and compared with what the cloud gave (<see cref="JsonCompare"/>); if something would be lost or changed the
    /// session refuses to save and says why, so the headset can never damage a project written by a newer web version.
    /// </summary>
    public class ProjectEditSession
    {
        const string Tag = "[Edit] ";

        readonly SupabaseClient client;
        public ProjectInfo Project { get; }
        public List<RoomModel> Models { get; private set; }
        JArray original;
        readonly Dictionary<GameObject, RoomModel> byHolder = new Dictionary<GameObject, RoomModel>();
        readonly HashSet<RoomModel> dirty = new HashSet<RoomModel>();

        public bool CanSave { get; private set; } = true;
        public string CannotSaveReason { get; private set; }
        int removed;
        public int DirtyCount => dirty.Count + removed;
        public GameObject Selected { get; private set; }
        /// <summary>The model the dominant hand is holding right now (pinch), or null.</summary>
        public GameObject Grabbed { get; private set; }
        public RoomModel ModelOf(GameObject holder) => holder != null && byHolder.TryGetValue(holder, out var m) ? m : null;
        public RoomModel SelectedModel => Selected != null && byHolder.TryGetValue(Selected, out var m) ? m : null;
        public event Action Changed;

        ProjectEditSession(SupabaseClient client, ProjectInfo project) { this.client = client; Project = project; }

        public static async Task<ProjectEditSession> Open(SupabaseClient client, ProjectInfo project)
        {
            var s = new ProjectEditSession(client, project);
            s.original = await client.GetProjectModelsJson(project.id);
            s.Models = Json.Parse<List<RoomModel>>(s.original.ToString()) ?? new List<RoomModel>();

            var again = JArray.Parse(Json.Write(s.Models));
            if (!JsonCompare.Same(s.original, again, "models", out var diff))
            {
                s.CanSave = false;
                s.CannotSaveReason = "this project has data the headset would change (" + diff + ")";
                Debug.LogWarning(Tag + "round trip differs: " + diff);
            }
            else Debug.Log(Tag + s.Models.Count + " model(s), round trip identical");
            return s;
        }

        /// <summary>Makes a placed model editable: grabbable, selectable, and its moves are tracked.</summary>
        public void Attach(RoomModel model, GameObject holder)
        {
            byHolder[holder] = model;
            ModelLook.Capture(holder);          // the file's own materials, then the look the project asks for
            ModelLook.Apply(holder, model);
            ModelGrab.Make(holder, h => { Grabbed = h; Select(h); }, h => { if (Grabbed == h) Grabbed = null; OnReleased(h); });
        }

        public void Select(GameObject holder)
        {
            if (Selected == holder) return;
            if (Selected != null) SelectionBox.Show(Selected, false);
            Selected = holder;
            if (holder != null) SelectionBox.Show(holder, true);
            Changed?.Invoke();
        }

        /// <summary>The model was edited (scale, turn, colour...): it counts as an unsaved change.</summary>
        public void Edited(RoomModel m) { dirty.Add(m); Changed?.Invoke(); }

        public GameObject HolderOf(RoomModel m) => byHolder.FirstOrDefault(kv => kv.Value == m).Key;

        /// <summary>Deletes a model from the project (it is gone from the cloud at the next save).</summary>
        public void Remove(RoomModel m)
        {
            var h = HolderOf(m);
            Models.Remove(m);
            dirty.Remove(m);
            removed++;
            if (h != null) { if (Selected == h) Selected = null; byHolder.Remove(h); UnityEngine.Object.Destroy(h); }
            Changed?.Invoke();
        }

        void OnReleased(GameObject holder)
        {
            if (!byHolder.TryGetValue(holder, out var m)) return;
            var p = holder.transform.localPosition;
            var now = new Vec3(Math.Round(p.x * 1000.0) / 1000.0, Math.Round(p.y * 1000.0) / 1000.0, Math.Round(-p.z * 1000.0) / 1000.0);
            double d = Math.Sqrt((now.X - m.Pos.X) * (now.X - m.Pos.X) + (now.Y - m.Pos.Y) * (now.Y - m.Pos.Y) + (now.Z - m.Pos.Z) * (now.Z - m.Pos.Z));
            if (d < 0.002) return;   // not a move
            Debug.Log(Tag + m.Name + " moved " + (d * 100).ToString("0.0") + " cm");
            m.Pos = now;
            dirty.Add(m);
            Changed?.Invoke();
        }

        /// <summary>Saves the moved models into the project. Returns a message for the user.</summary>
        public async Task<string> Save()
        {
            if (!CanSave) return "Not saved: " + CannotSaveReason;
            if (dirty.Count == 0 && removed == 0) return "Niente da salvare";
            var row = new JObject { ["models"] = JArray.Parse(Json.Write(Models)), ["updated_at"] = DateTime.UtcNow.ToString("o") };
            await client.PatchProject(Project.id, row);
            int n = DirtyCount;
            dirty.Clear();
            removed = 0;
            original = (JArray)row["models"];   // what the cloud has now
            Changed?.Invoke();
            Debug.Log(Tag + "saved " + n + " change(s)");
            return "Saved " + n + " change(s)";
        }

    }
}
