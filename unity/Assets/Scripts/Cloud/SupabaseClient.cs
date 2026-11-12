using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace Immersa.Cloud
{
    /// <summary>Minimal project row for the list (the full types come later).</summary>
    public class ProjectInfo
    {
        public string id;
        public string name;
        public int tone = -1;        // 0..7, -1 = none (older projects)
        public int roomCount;
        public List<string> roomIds = new List<string>();   // the rooms the project uses (room_ids, else room_id)
        public string updatedAt;
    }

    /// <summary>A saved room (a row of the "rooms" table) with its scan parsed in our own format.</summary>
    public class RoomInfo
    {
        public string id;
        public string name;
        public string place;
        public Immersa.Core.RoomScan scan;
    }

    /// <summary>
    /// Supabase over plain REST (UnityWebRequest + Newtonsoft): password login, token refresh,
    /// session saved on the device, and the projects table (RLS limits rows to the signed-in owner).
    /// </summary>
    public class SupabaseClient
    {
        const string Tag = "[Supabase] ";
        const string ProjectColsFull = "id,name,room_id,room_ids,tone,updated_at";
        const string ProjectColsBase = "id,name,room_id,room_ids,updated_at";   // before `tone` existed

        readonly string url;
        readonly string anonKey;
        readonly string sessionPath;
        Session session;

        class Session
        {
            public string accessToken;
            public string refreshToken;
            public long expiresAt;   // unix seconds
            public string email;
        }

        public SupabaseClient(SupabaseConfig config)
        {
            url = config.url.TrimEnd('/');
            anonKey = config.anonKey;
            sessionPath = Path.Combine(Application.persistentDataPath, "session.json");
        }

        public bool SignedIn => session != null;
        public string Email => session?.email;

        /// <summary>Loads the saved session and refreshes it when expired. False when there is none.</summary>
        public async Task<bool> RestoreSession()
        {
            try
            {
                if (!File.Exists(sessionPath)) return false;
                var j = JObject.Parse(File.ReadAllText(sessionPath));
                session = new Session
                {
                    accessToken = (string)j["accessToken"],
                    refreshToken = (string)j["refreshToken"],
                    expiresAt = (long?)j["expiresAt"] ?? 0,
                    email = (string)j["email"],
                };
            }
            catch (Exception e)
            {
                Debug.LogWarning(Tag + "saved session unreadable: " + e.Message);
                session = null;
                return false;
            }
            if (Now() >= session.expiresAt - 60 && !await Refresh()) { session = null; return false; }
            return true;
        }

        /// <summary>Email + password login. Returns null on success, else a message for the user.</summary>
        public async Task<string> SignIn(string email, string password)
        {
            var body = new JObject { ["email"] = email, ["password"] = password }.ToString();
            var (code, text) = await Send("POST", "/auth/v1/token?grant_type=password", body, false);
            if (code != 200) return ErrorMessage(code, text);
            ApplyTokens(JObject.Parse(text), email);
            return null;
        }

        // ---- sign-in with a code approved on the PC (Edge Function "link-device", same flow as the web headset) ----

        public enum LinkStatus { Wait, Expired, SignedIn, Error }

        /// <summary>A 6-character code to show, and the secret only this headset knows.</summary>
        public class DeviceLink
        {
            public string code;
            public string secret;
            public string error;   // set when the request failed
        }

        public async Task<DeviceLink> StartDeviceLink()
        {
            var (code, text) = await Send("POST", "/functions/v1/link-device", new JObject { ["action"] = "start" }.ToString(), false);
            if (code != 200) return new DeviceLink { error = ErrorMessage(code, text) };
            var j = JObject.Parse(text);
            var c = (string)j["code"]; var s = (string)j["secret"];
            if (string.IsNullOrEmpty(c) || string.IsNullOrEmpty(s)) return new DeviceLink { error = "No code received." };
            return new DeviceLink { code = c, secret = s };
        }

        /// <summary>Asks whether the PC approved the code; on approval completes the sign-in.</summary>
        public async Task<(LinkStatus status, string error)> PollDeviceLink(DeviceLink link)
        {
            var body = new JObject { ["action"] = "poll", ["code"] = link.code, ["secret"] = link.secret }.ToString();
            var (code, text) = await Send("POST", "/functions/v1/link-device", body, false);
            if (code != 200) return (LinkStatus.Error, ErrorMessage(code, text));
            var j = JObject.Parse(text);
            var status = (string)j["status"];
            if (status == "expired") return (LinkStatus.Expired, null);
            if (status != "ok") return (LinkStatus.Wait, null);

            // The one-time token turns into a real session (the web app tries 'magiclink' first, then 'email').
            var tokenHash = (string)j["token_hash"];
            foreach (var type in new[] { "magiclink", "email" })
            {
                var vBody = new JObject { ["token_hash"] = tokenHash, ["type"] = type }.ToString();
                var (vCode, vText) = await Send("POST", "/auth/v1/verify", vBody, false);
                if (vCode == 200) { ApplyTokens(JObject.Parse(vText), null); return (LinkStatus.SignedIn, null); }
                if (type == "email") return (LinkStatus.Error, ErrorMessage(vCode, vText));
            }
            return (LinkStatus.Error, "Sign-in failed.");
        }

        /// <summary>Creates an account. Returns (error, signedIn): signedIn is false when the email must be confirmed first.</summary>
        public async Task<(string error, bool signedIn)> SignUp(string email, string password)
        {
            var body = new JObject { ["email"] = email, ["password"] = password }.ToString();
            var (code, text) = await Send("POST", "/auth/v1/signup", body, false);
            if (code != 200) return (ErrorMessage(code, text), false);
            var j = JObject.Parse(text);
            if (j["access_token"] != null) { ApplyTokens(j, email); return (null, true); }
            return (null, false);
        }

        /// <summary>Sends a one-time code to the email of an EXISTING account (a wrong address must not create one). Null on success.</summary>
        public async Task<string> SendEmailCode(string email)
        {
            var body = new JObject { ["email"] = email.Trim(), ["create_user"] = false }.ToString();
            var (code, text) = await Send("POST", "/auth/v1/otp", body, false);
            if (code == 200) return null;
            var msg = ErrorMessage(code, text);
            if (System.Text.RegularExpressions.Regex.IsMatch(msg, "signups? not allowed|not found|otp", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) return "Non c'è nessun account con questa email.";
            if (System.Text.RegularExpressions.Regex.IsMatch(msg, "rate|seconds|too many", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) return "Troppe richieste: aspetta un minuto e riprova.";
            return msg;
        }

        /// <summary>Signs in with the code received by email. Null on success.</summary>
        public async Task<string> VerifyEmailCode(string email, string codeText)
        {
            var body = new JObject { ["email"] = email.Trim(), ["token"] = System.Text.RegularExpressions.Regex.Replace(codeText ?? "", @"\s", ""), ["type"] = "email" }.ToString();
            var (code, text) = await Send("POST", "/auth/v1/verify", body, false);
            if (code != 200) return System.Text.RegularExpressions.Regex.IsMatch(ErrorMessage(code, text), "expired|invalid", System.Text.RegularExpressions.RegexOptions.IgnoreCase) ? "Codice sbagliato o scaduto." : ErrorMessage(code, text);
            ApplyTokens(JObject.Parse(text), email.Trim());
            return null;
        }

        public void SignOut()
        {
            session = null;
            try { if (File.Exists(sessionPath)) File.Delete(sessionPath); } catch { /* best effort */ }
        }

        /// <summary>Projects of the signed-in user, newest first.</summary>
        public async Task<List<ProjectInfo>> ListProjects()
        {
            var (code, text) = await Send("GET", "/rest/v1/projects?select=" + ProjectColsFull + "&order=updated_at.desc", null, true);
            if (code == 400 && text.Contains("tone"))   // the `tone` column is missing: same fallback as the web app
                (code, text) = await Send("GET", "/rest/v1/projects?select=" + ProjectColsBase + "&order=updated_at.desc", null, true);
            if (code != 200) throw new Exception(ErrorMessage(code, text));

            var list = new List<ProjectInfo>();
            foreach (var r in JArray.Parse(text))
            {
                var tone = r["tone"];
                var roomIds = new List<string>();
                if (r["room_ids"] is JArray arr && arr.Count > 0) foreach (var x in arr) roomIds.Add((string)x);
                else if (r["room_id"]?.Type == JTokenType.String) roomIds.Add((string)r["room_id"]);
                int rooms = roomIds.Count;
                list.Add(new ProjectInfo
                {
                    roomIds = roomIds,
                    id = (string)r["id"],
                    name = (string)r["name"],
                    tone = tone != null && tone.Type == JTokenType.Integer ? (int)tone : -1,
                    roomCount = rooms,
                    updatedAt = (string)r["updated_at"],
                });
            }
            return list;
        }

        /// <summary>The user's rooms with their scans (RLS limits the rows to the signed-in owner), newest first.</summary>
        public async Task<List<RoomInfo>> ListRooms()
        {
            var (code, text) = await Send("GET", "/rest/v1/rooms?select=id,name,data,place&order=updated_at.desc", null, true);
            if (code == 400 && text.Contains("place"))   // the `place` column is missing: same fallback as the web app
                (code, text) = await Send("GET", "/rest/v1/rooms?select=id,name,data&order=updated_at.desc", null, true);
            if (code != 200) throw new Exception(ErrorMessage(code, text));
            var list = new List<RoomInfo>();
            foreach (var r in JArray.Parse(text))
            {
                Immersa.Core.RoomScan scan = null;
                try { scan = r["data"] != null ? Immersa.Core.Json.Parse<Immersa.Core.RoomScan>(r["data"].ToString()) : null; }
                catch (Exception e) { Debug.LogWarning(Tag + "room " + (string)r["name"] + " unreadable: " + e.Message); }
                list.Add(new RoomInfo { id = (string)r["id"], name = (string)r["name"], place = (string)r["place"], scan = scan });
            }
            return list;
        }

        /// <summary>Saves a new room (a row of the "rooms" table, same columns as the web's createRoom). Returns its id.</summary>
        public async Task<string> CreateRoom(string name, Immersa.Core.RoomScan scan, string place = null)
        {
            var row = new JObject { ["name"] = name, ["data"] = JObject.Parse(Immersa.Core.Json.Write(scan)) };
            if (!string.IsNullOrEmpty(place)) row["place"] = place;
            var (code, text) = await Send("POST", "/rest/v1/rooms?select=id", row.ToString(), true, "return=representation");
            if (code != 201 && code != 200) throw new Exception(ErrorMessage(code, text));
            var arr = JArray.Parse(text);
            return arr.Count > 0 ? (string)arr[0]["id"] : null;
        }

        /// <summary>The models of one project as the cloud has them (the raw JSON array).</summary>
        public async Task<JArray> GetProjectModelsJson(string projectId)
        {
            var (code, text) = await Send("GET", "/rest/v1/projects?select=models&id=eq." + Uri.EscapeDataString(projectId), null, true);
            if (code != 200) throw new Exception(ErrorMessage(code, text));
            var rows = JArray.Parse(text);
            return rows.Count > 0 && rows[0]["models"] is JArray m ? m : new JArray();
        }

        /// <summary>The models of one project, parsed with the shared Core types (same JSON as the web app).</summary>
        public async Task<List<Immersa.Core.RoomModel>> GetProjectModels(string projectId)
        {
            var arr = await GetProjectModelsJson(projectId);
            return Immersa.Core.Json.Parse<List<Immersa.Core.RoomModel>>(arr.ToString()) ?? new List<Immersa.Core.RoomModel>();
        }

        /// <summary>Updates some columns of a project (the row is sent as is; RLS limits it to the owner).</summary>
        public async Task PatchProject(string projectId, JObject row)
        {
            var (code, text) = await Send("PATCH", "/rest/v1/projects?id=eq." + Uri.EscapeDataString(projectId), row.ToString(), true, "return=minimal");
            if (code != 204 && code != 200) throw new Exception(ErrorMessage(code, text));
        }

        /// <summary>
        /// Downloads a GLB from the private "models" bucket into the device cache and returns the file path.
        /// The bucket path is content-addressed (&lt;user&gt;/&lt;sha256&gt;.glb), so a cached file never goes stale.
        /// </summary>
        public async Task<string> DownloadModel(string bucketPath)
        {
            var dir = Path.Combine(Application.persistentDataPath, "models");
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, bucketPath.Replace('/', '_'));
            if (File.Exists(file) && new FileInfo(file).Length > 0) return file;

            if (session != null && Now() >= session.expiresAt - 60) await Refresh();
            var escaped = string.Join("/", Array.ConvertAll(bucketPath.Split('/'), Uri.EscapeDataString));
            var temp = file + ".part";
            using (var req = new UnityWebRequest(url + "/storage/v1/object/authenticated/models/" + escaped, "GET"))
            {
                req.downloadHandler = new DownloadHandlerFile(temp) { removeFileOnAbort = true };
                req.SetRequestHeader("apikey", anonKey);
                req.SetRequestHeader("Authorization", "Bearer " + session?.accessToken);
                req.timeout = 300;
                var done = new TaskCompletionSource<bool>();
                req.SendWebRequest().completed += _ => done.TrySetResult(true);
                await done.Task;
                if (req.responseCode != 200)
                {
                    try { if (File.Exists(temp)) File.Delete(temp); } catch { /* best effort */ }
                    throw new Exception("Download failed (" + req.responseCode + "): " + bucketPath);
                }
            }
            if (File.Exists(file)) File.Delete(file);
            File.Move(temp, file);
            return file;
        }

        // ---- internals ----

        static long Now() => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        void ApplyTokens(JObject j, string fallbackEmail)
        {
            session = new Session
            {
                accessToken = (string)j["access_token"],
                refreshToken = (string)j["refresh_token"],
                expiresAt = Now() + ((long?)j["expires_in"] ?? 3600),
                email = (string)j["user"]?["email"] ?? fallbackEmail ?? session?.email,
            };
            try
            {
                File.WriteAllText(sessionPath, new JObject
                {
                    ["accessToken"] = session.accessToken,
                    ["refreshToken"] = session.refreshToken,
                    ["expiresAt"] = session.expiresAt,
                    ["email"] = session.email,
                }.ToString());
            }
            catch (Exception e) { Debug.LogWarning(Tag + "could not save the session: " + e.Message); }
        }

        async Task<bool> Refresh()
        {
            if (session?.refreshToken == null) return false;
            var body = new JObject { ["refresh_token"] = session.refreshToken }.ToString();
            var (code, text) = await Send("POST", "/auth/v1/token?grant_type=refresh_token", body, false);
            if (code != 200) { Debug.LogWarning(Tag + "refresh failed: " + ErrorMessage(code, text)); return false; }
            ApplyTokens(JObject.Parse(text), session.email);
            return true;
        }

        async Task<(long code, string body)> Send(string method, string path, string json, bool auth, string prefer = null)
        {
            if (auth && session != null && Now() >= session.expiresAt - 60) await Refresh();
            var result = await Once(method, path, json, auth, prefer);
            if (auth && result.code == 401 && await Refresh()) result = await Once(method, path, json, auth, prefer);   // token revoked early
            return result;
        }

        async Task<(long code, string body)> Once(string method, string path, string json, bool auth, string prefer = null)
        {
            using var req = new UnityWebRequest(url + path, method);
            req.downloadHandler = new DownloadHandlerBuffer();
            if (json != null)
            {
                req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                req.SetRequestHeader("Content-Type", "application/json");
            }
            req.SetRequestHeader("apikey", anonKey);
            if (prefer != null) req.SetRequestHeader("Prefer", prefer);
            // Signed-in calls carry the user's token; the others (login, Edge Function without a user) carry the anon key, like supabase-js.
            req.SetRequestHeader("Authorization", "Bearer " + (auth && session != null ? session.accessToken : anonKey));
            req.timeout = 20;

            var done = new TaskCompletionSource<bool>();
            req.SendWebRequest().completed += _ => done.TrySetResult(true);
            await done.Task;
            return (req.responseCode, req.downloadHandler.text ?? "");
        }

        static string ErrorMessage(long code, string text)
        {
            if (code == 0) return "No connection to Supabase.";
            try
            {
                var j = JObject.Parse(text);
                var m = (string)j["msg"] ?? (string)j["error_description"] ?? (string)j["message"] ?? (string)j["error"];
                if (!string.IsNullOrEmpty(m)) return m + " (" + code + ")";
            }
            catch { /* not JSON */ }
            return "HTTP " + code;
        }
    }
}
