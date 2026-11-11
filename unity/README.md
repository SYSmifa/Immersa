# Immersa Unity (visore Quest 3)

Progetto Unity SEPARATO dall'app web: niente qui dentro tocca `src/`, `supabase/` o il deploy Cloudflare.
Punto di ritorno dell'app web: tag git `web-pre-unity` (`git checkout web-pre-unity`).
Per abbandonare Unity basta cancellare la cartella `unity/` (e il branch).

## Regole
- Package Android diverso dal web: `app.immersa.quest.unity` (si installa accanto all'APK web, non lo sostituisce).
  Non usare `immersa-apk\android.keystore` finché non si decide di sostituire l'APK web; per i test va bene la keystore di debug.
- Supabase: stesse tabelle e stesso bucket del web, nessun cambio di schema. URL e chiave anon in un file locale
  ignorato da git (`Assets/Config/Local*`), mai nel repo.
- Logica pura (layout, misure, allineamento) in C# senza `UnityEngine`, testabile con `dotnet` (cartella `Core/`, da creare).
- Commit di tutto (inclusi i `.meta`) prima di ogni sessione col ponte MCP: ogni modifica si annulla con git.

## Creare il progetto (una volta, lo fa l'utente)
1. Unity Hub → New project → **Unity 6 LTS** → template **Universal 3D (URP)** → nome `Immersa` →
   posizione: la cartella `unity/` di questo repo (se Hub crea una sottocartella `unity/Immersa`, spostane il contenuto in `unity/`).
2. File → Build Profiles → Android → Switch Platform. Player Settings: Scripting Backend **IL2CPP**, ARM64,
   Minimum API 32, Package Name `app.immersa.quest.unity`.
3. Window → Package Manager: installare Meta XR All-in-One SDK (o Meta XR Core + Interaction + MR Utility Kit) e
   Unity OpenXR Meta; poi `com.unity.nuget.newtonsoft-json` e glTFast.
4. `git add unity && git commit` e push sul branch di lavoro.

## Ponte MCP (strada 2, dopo il punto 4)
Da fare su Claude Code locale nella cartella `unity/`; i passi esatti si verificano sulla documentazione del pacchetto scelto.
