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

## Stato (11/11)
- Fatto: progetto creato (Unity 6.3 LTS 6000.3.28f1, URP), ponte MCP attivo, Claude Code configurato, `.gitignore`/`.gitattributes`.
- Pacchetti (fatto): Meta XR All-in-One SDK 209.0.0 (da Asset Store: su npm c'è solo un segnaposto), Unity OpenXR Meta 2.7.0, glTFast 6.0.0, Newtonsoft Json 3.2.2 (dipendenza diretta). Tolto `com.unity.ai.inference` (Sentis, inutile e migliaia di warning). Niente XR Interaction Toolkit.
- Punto A (fatto, 11/11): Product/Company `Immersa`, package `app.immersa.quest.unity`, IL2CPP, ARM64, Min API 32, Linear, solo Vulkan; OpenXR su Android con Touch Controller, Hand Tracking, Boundary Visibility (più le feature Meta XR già accese dall'SDK); `OculusProjectConfig`: mani e controller, ancore, scena OBBLIGATORIA, passthrough OBBLIGATORIO, boundary visibility supportata, camera access spenta; raccomandazioni Meta applicate sul livello qualità Mobile (splash Unity off, 1 luce pixel, aniso per texture, HDR off, MSAA 4×); saltate di proposito: target API 34 (solo store), Subsampled Layout, Legacy Graphics Jobs, SpaceWarp, on-tile post-processing, Simulator/Operator, Data Use Checkup, application ID. Il manifest si rigenera alla build (verificati i permessi HAND_TRACKING, USE_ANCHOR_API, USE_SCENE, BOUNDARY_VISIBILITY).
- Scena `Assets/Scenes/Main.unity` (unica in Build Settings): OVRCameraRig + OVRPassthroughLayer (underlay), camera trasparente, una luce, `BoundaryGuard` (`Assets/Scripts/Quest/BoundaryGuard.cs`: chiede la soppressione del Guardian all'avvio e a ogni ripresa, log con tag `[Boundary]`; OVRManager ritenta a ogni frame).
- Build di prova (fatta): `Builds/Immersa-dev.apk` (91 MB, Development, keystore di debug, ~24 min la prima volta, cartella ignorata da git; `.utmp/` pure), installata con `adb install -r`. PROVATA SUL VISORE dall'utente: parte, si vede il passthrough, il Guardian NON c'è. NON ancora provato: Guardian dopo uno standby vero e dopo una scansione (punto B.1 resta aperto per questo).
- Avvertenze: il ponte MCP blocca `System.Reflection` e non vede le classi dell'SDK Meta (`OVRProjectConfig`, `OVRManager`): per impostarle si usa `SerializedObject` sui campi o prefab/script in `Assets/`; Unity Connect dà errori di token in Console (non legati al progetto).
- PROSSIMO: prototipo di rischio B (B.1 standby/scansione, poi login Supabase, elenco progetti, GLB, mani, due scansioni MRUK).

## Logica pura in C# (`Assets/Scripts/Core/`, scritta dalla chat cloud)
- Cartella della chat cloud: la sessione locale la USA ma non la modifica senza chiedere (se serve un cambio, dirlo all'utente).
- Niente `UnityEngine` lì dentro; i tipi `Vec2/Vec3/Quat` sono i nostri (assi del WEB: three, destrorso, y su). La conversione verso Unity (z invertito, quaternioni) si fa in UN solo posto, al bordo con Unity (da scrivere quando serve).
- Fatto: `Vectors.cs`, `Types.cs` (= `src/room/types.ts`, i campi sconosciuti si conservano in `Extra` per non perdere dati di una versione più nuova del web), `Json.cs` (camelCase, campi assenti non scritti), `Places.cs` (= `src/room/places.ts`). `Assets/link.xml` evita che lo stripping IL2CPP tolga i campi letti da Newtonsoft.
- Test: `dotnet run --project unity/Tests/Core.Tests` (richiede .NET 8 SDK; nessuna dipendenza da Unity). Gli stessi file li compila Unity: alla prima apertura Unity crea i `.meta` (da committare) e va controllata la Console.
- Prossimi da portare, in ordine: `measure`, `anchors`, `layout`, `annotations` (+ `wrapLines`), con test equivalenti a `docs/test-plans/*.test.mts`.

## Cosa fare (sessione locale)
Regole: un gradino alla volta; prima dire cosa si farà e aspettare l'ok; commit piccoli dopo ogni gradino (con i `.meta`); non toccare `src/`, `supabase/` né il deploy web; dopo ogni cambio importante far controllare la Console (niente errori rossi); se un'API Meta/Unity è incerta, cercare la documentazione prima di scrivere codice; le prove sul visore le fa l'utente (APK con `adb install`), chiedere foto/log e raggruppare le modifiche prima di una build.

A. Configurazione Android/Quest (con MCP) — FATTO e provato sul visore
1. Player: Company/Product Name `Immersa`, package `app.immersa.quest.unity`, IL2CPP, solo ARM64, Min API 32 (target massimo), Color Space Linear, Graphics API Vulkan (via OpenGLES3 se non serve).
2. XR Plug-in Management → Android: OpenXR, feature group Meta Quest (Meta Quest Support, Touch Controller Profile, Hand Tracking Subsystem, Meta Quest: Camera/Anchors/Boundary Visibility/Occlusion se presenti); Initialize XR on Startup.
3. Meta XR SDK: Project Setup Tool → applicare le correzioni consigliate (non tutte alla cieca: dire quali). Manifest: permessi scena (`com.oculus.permission.USE_SCENE`), anchor spaziali, hand tracking, passthrough.
4. Scena iniziale `Assets/Scenes/Main.unity` creata da codice/MCP: XR Origin (o OVRCameraRig), passthrough attivo (sfondo trasparente), URP mobile (usare Mobile_RPAsset per Android).
5. Build Android di prova (Development) → l'utente la installa e verifica che parta in passthrough.

B. Prototipo di rischio (docs/unity-port.md §5, gradino 0): se uno di questi fallisce, FERMARSI e dirlo all'utente
1. Guardian tolto: Boundary Visibility Suppression (`XR_META_boundary_visibility`, richiedere `VisibilitySuppressed` a ogni ripresa, riprovare finché accetta); verificare dopo standby e dopo una scansione.
2. Login Supabase (email+password, REST con `UnityWebRequest`, Newtonsoft); chiavi in un file locale ignorato da git.
3. Elenco progetti (tile con iniziale e tono, ricerca) leggendo le stesse tabelle del web.
4. Una stanza + un modello GLB da Supabase (glTFast, cache su disco `<utente>/<sha256>.glb`), posizione/yaw/scala come `RoomModel`; attenzione agli assi (Unity sinistra, three destra: z invertito).
5. Spostare un modello con le mani (Interaction SDK di Meta).
6. Scansione stanza con MRUK (Space Setup) e DUE scansioni di fila nella stessa sessione; salvataggio come `RoomScan` JSON.

C. Dopo il prototipo (solo se B regge e l'utente conferma): dati completi (tipi C# = `src/room/types.ts`), stanze/ancore, modelli (colori, componenti `PartEdit`), interazione (due mani scala/rotazione, snap), UI Aura, misure/annotazioni, visita virtuale, distribuzione. Vedi `docs/unity-port.md` §5-6.

D. Parallelo (anche dalla chat cloud, senza Unity): logica pura in C# senza `UnityEngine` in `unity/Assets/Scripts/Core/` con test `dotnet` portati da `docs/test-plans/*.test.mts` (layout, misure, annotazioni, anchors/allineamento, luoghi).
