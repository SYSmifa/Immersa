using System;
using System.Threading.Tasks;
using Immersa.Cloud;
using Immersa.Ui;
using UnityEngine;

namespace Immersa.Quest
{
    /// <summary>
    /// The sign-in card, like the web headset app: at the top "Accedi con un codice dal PC" (a code approved on the PC), then email and
    /// password, "Crea un account", and "Accedi con un codice via email". Texts are typed with the system keyboard.
    /// <see cref="Run"/> finishes when the user is signed in.
    /// </summary>
    public class LoginPanel : MonoBehaviour
    {
        enum Mode { Main, PcCode, EmailCode }

        const float W = 820f, H = 980f;

        RectTransform canvas;
        SupabaseClient client;
        TaskCompletionSource<bool> done;
        Mode mode = Mode.Main;
        string email = "", password = "", code = "", message = "", pcCode = "";
        bool messageIsError, codeSent, busy, rebuild;
        int pcToken;

        public Task<bool> Run(SupabaseClient c)
        {
            client = c;
            done = new TaskCompletionSource<bool>();
            if (canvas == null) canvas = UiKit.NewCanvas("LoginCanvas", transform, W, H);
            Place();
            canvas.gameObject.SetActive(true);
            mode = Mode.Main; message = ""; password = ""; code = ""; codeSent = false;
            rebuild = true;
            return done.Task;
        }

        void Place()
        {
            var cam = Camera.main != null ? Camera.main : FindFirstObjectByType<Camera>();
            if (cam == null) return;
            var fwd = cam.transform.forward; fwd.y = 0;
            fwd = fwd.sqrMagnitude < 1e-4f ? Vector3.forward : fwd.normalized;
            canvas.position = cam.transform.position + fwd * 1.1f + Vector3.down * 0.05f;
            canvas.rotation = Quaternion.LookRotation(fwd, Vector3.up);
        }

        void LateUpdate()
        {
            if (rebuild && canvas != null && canvas.gameObject.activeSelf) { rebuild = false; Build(); }
        }

        void Finish()
        {
            canvas.gameObject.SetActive(false);
            done?.TrySetResult(true);
        }

        void Set(string text, bool error) { message = text; messageIsError = error; rebuild = true; }

        // ---- drawing ----

        void Build()
        {
            for (int i = canvas.childCount - 1; i >= 0; i--) Destroy(canvas.GetChild(i).gameObject);
            UiKit.Box(canvas, 0, 0, W, H, UiTheme.Bg1, true, "Panel");
            UiKit.Label(canvas, 44, 30, W - 88, 60, "Accedi a Immersa", 44, UiTheme.HeaderText, TextAnchor.UpperLeft, true);

            switch (mode)
            {
                case Mode.Main: BuildMain(); break;
                case Mode.PcCode: BuildPcCode(); break;
                case Mode.EmailCode: BuildEmailCode(); break;
            }
            if (!string.IsNullOrEmpty(message))
                UiKit.Label(canvas, 44, H - 130, W - 88, 100, message, 24, messageIsError ? new Color(1f, 0.55f, 0.65f) : UiTheme.Accent2, TextAnchor.UpperLeft, false, "Message");
        }

        void BuildMain()
        {
            UiKit.Pill(canvas, 44, 120, W - 88, 84, "Accedi con un codice dal PC", 30, UiTheme.Accent, Color.white, UiTheme.AccentHover, StartPcCode);
            UiKit.Label(canvas, 44, 214, W - 88, 70, "Il modo più semplice: apri Immersa sul PC e approva il codice.", 22, UiTheme.HeaderSub);

            var card = UiKit.Box(canvas, 44, 300, W - 88, 380, UiTheme.Surface, true, "Card");
            UiKit.Label(card.transform, 28, 20, 300, 30, "EMAIL", 20, UiTheme.Dim, TextAnchor.UpperLeft, true);
            new UiTextField(card.transform, 28, 54, W - 88 - 56, 76, email, "nome@esempio.it", t => email = t, null, false, false, 120);
            UiKit.Label(card.transform, 28, 148, 300, 30, "PASSWORD", 20, UiTheme.Dim, TextAnchor.UpperLeft, true);
            new UiTextField(card.transform, 28, 182, W - 88 - 56, 76, password, "La tua password", t => password = t, null, true, false, 120);
            UiKit.Pill(card.transform, 28, 280, (W - 88 - 56 - 16) / 2f, 72, busy ? "..." : "Accedi", 28, UiTheme.Accent, Color.white, UiTheme.AccentHover, SignInWithPassword);
            UiKit.Pill(card.transform, 28 + (W - 88 - 56 - 16) / 2f + 16, 280, (W - 88 - 56 - 16) / 2f, 72, "Crea un account", 26, UiTheme.AccentSoft, UiTheme.AccentText, UiTheme.SurfaceHover, SignUp);

            UiKit.Label(canvas, 44, 700, W - 88, 36, "oppure", 24, UiTheme.HeaderSub, TextAnchor.UpperCenter);
            UiKit.Pill(canvas, 44, 750, W - 88, 76, "Accedi con un codice via email", 28, UiTheme.Glass, Color.white, UiTheme.GlassHover, () => { mode = Mode.EmailCode; codeSent = false; code = ""; Set("", false); });
        }

        void BuildPcCode()
        {
            UiKit.Label(canvas, 44, 130, W - 88, 70, "Sul PC apri Immersa, accedi e premi \"Collega un visore\", poi approva questo codice.", 24, UiTheme.HeaderSub);
            UiKit.Label(canvas, 44, 250, W - 88, 180, string.IsNullOrEmpty(pcCode) ? "..." : pcCode, 130, UiTheme.Accent2, TextAnchor.MiddleCenter, true, "Code");
            UiKit.Pill(canvas, 44, 520, W - 88, 76, "Annulla", 28, UiTheme.Glass, Color.white, UiTheme.GlassHover, () => { pcToken++; mode = Mode.Main; Set("", false); });
        }

        void BuildEmailCode()
        {
            var card = UiKit.Box(canvas, 44, 130, W - 88, codeSent ? 420 : 250, UiTheme.Surface, true, "Card");
            UiKit.Label(card.transform, 28, 20, 300, 30, "EMAIL", 20, UiTheme.Dim, TextAnchor.UpperLeft, true);
            new UiTextField(card.transform, 28, 54, W - 88 - 56, 76, email, "nome@esempio.it", t => email = t, null, false, false, 120);
            if (!codeSent)
                UiKit.Pill(card.transform, 28, 150, W - 88 - 56, 72, busy ? "..." : "Invia il codice", 28, UiTheme.Accent, Color.white, UiTheme.AccentHover, SendCode);
            else
            {
                UiKit.Label(card.transform, 28, 148, 400, 30, "CODICE RICEVUTO", 20, UiTheme.Dim, TextAnchor.UpperLeft, true);
                new UiTextField(card.transform, 28, 182, W - 88 - 56, 76, code, "123456", t => code = t, null, false, false, 12);
                UiKit.Pill(card.transform, 28, 280, W - 88 - 56, 72, busy ? "..." : "Accedi", 28, UiTheme.Accent, Color.white, UiTheme.AccentHover, VerifyCode);
            }
            UiKit.Pill(canvas, 44, H - 220, W - 88, 76, "Indietro", 28, UiTheme.Glass, Color.white, UiTheme.GlassHover, () => { mode = Mode.Main; Set("", false); });
        }

        // ---- actions ----

        async void SignInWithPassword()
        {
            if (busy) return;
            if (string.IsNullOrWhiteSpace(email) || string.IsNullOrEmpty(password)) { Set("Scrivi email e password.", true); return; }
            busy = true; Set("", false);
            try
            {
                var error = await client.SignIn(email.Trim(), password);
                if (error == null) { Finish(); return; }
                Set(error.IndexOf("invalid", StringComparison.OrdinalIgnoreCase) >= 0 ? "Email o password non corretti." : error, true);
            }
            catch (Exception e) { Debug.LogError("[Login] " + e); Set(e.Message, true); }
            finally { busy = false; rebuild = true; }
        }

        async void SignUp()
        {
            if (busy) return;
            if (string.IsNullOrWhiteSpace(email) || password.Length < 6) { Set("Scrivi un'email e una password di almeno 6 caratteri.", true); return; }
            busy = true; Set("", false);
            try
            {
                var (error, signedIn) = await client.SignUp(email.Trim(), password);
                if (error != null) { Set(error, true); return; }
                if (signedIn) { Finish(); return; }
                Set("Ti abbiamo scritto: conferma l'email, poi accedi.", false);
            }
            catch (Exception e) { Debug.LogError("[Login] " + e); Set(e.Message, true); }
            finally { busy = false; rebuild = true; }
        }

        async void SendCode()
        {
            if (busy) return;
            if (string.IsNullOrWhiteSpace(email)) { Set("Scrivi la tua email.", true); return; }
            busy = true; Set("", false);
            try
            {
                var error = await client.SendEmailCode(email);
                if (error != null) { Set(error, true); return; }
                codeSent = true;
                Set("Codice inviato. Controlla la posta e scrivilo qui sotto.", false);
            }
            catch (Exception e) { Debug.LogError("[Login] " + e); Set(e.Message, true); }
            finally { busy = false; rebuild = true; }
        }

        async void VerifyCode()
        {
            if (busy) return;
            busy = true; Set("", false);
            try
            {
                var error = await client.VerifyEmailCode(email, code);
                if (error == null) { Finish(); return; }
                Set(error, true);
            }
            catch (Exception e) { Debug.LogError("[Login] " + e); Set(e.Message, true); }
            finally { busy = false; rebuild = true; }
        }

        /// <summary>The code approved on the PC (Edge Function link-device): shows a code and waits; a new one is asked when it expires.</summary>
        async void StartPcCode()
        {
            if (mode == Mode.PcCode) return;
            mode = Mode.PcCode; pcCode = ""; Set("", false);
            int token = ++pcToken;
            try
            {
                while (token == pcToken)
                {
                    var link = await client.StartDeviceLink();
                    if (token != pcToken) return;
                    if (link.error != null) { mode = Mode.Main; Set(link.error, true); return; }
                    pcCode = link.code; rebuild = true;
                    while (token == pcToken)
                    {
                        await Task.Delay(2000);
                        if (token != pcToken) return;
                        var (status, error) = await client.PollDeviceLink(link);
                        if (status == SupabaseClient.LinkStatus.SignedIn) { Finish(); return; }
                        if (status == SupabaseClient.LinkStatus.Expired) break;
                        if (status == SupabaseClient.LinkStatus.Error) { mode = Mode.Main; Set(error, true); return; }
                    }
                }
            }
            catch (Exception e) { Debug.LogError("[Login] " + e); mode = Mode.Main; Set(e.Message, true); }
        }
    }
}
