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
        public string updatedAt;
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
                int rooms = r["room_ids"] is JArray ids && ids.Count > 0 ? ids.Count : (r["room_id"]?.Type == JTokenType.String ? 1 : 0);
                var tone = r["tone"];
                list.Add(new ProjectInfo
                {
                    id = (string)r["id"],
                    name = (string)r["name"],
                    tone = tone != null && tone.Type == JTokenType.Integer ? (int)tone : -1,
                    roomCount = rooms,
                    updatedAt = (string)r["updated_at"],
                });
            }
            return list;
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

        async Task<(long code, string body)> Send(string method, string path, string json, bool auth)
        {
            if (auth && session != null && Now() >= session.expiresAt - 60) await Refresh();
            var result = await Once(method, path, json, auth);
            if (auth && result.code == 401 && await Refresh()) result = await Once(method, path, json, auth);   // token revoked early
            return result;
        }

        async Task<(long code, string body)> Once(string method, string path, string json, bool auth)
        {
            using var req = new UnityWebRequest(url + path, method);
            req.downloadHandler = new DownloadHandlerBuffer();
            if (json != null)
            {
                req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                req.SetRequestHeader("Content-Type", "application/json");
            }
            req.SetRequestHeader("apikey", anonKey);
            if (auth && session != null) req.SetRequestHeader("Authorization", "Bearer " + session.accessToken);
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
