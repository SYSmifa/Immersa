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
- Passo 4 (pacchetti) eseguito dalla sessione locale: controllare `Packages/manifest.json` (OpenXR Meta, glTFast, Newtonsoft, Meta XR SDK) e committare se non è già fatto.
- Al 11/11 `ProjectSettings` ha ancora i valori del template: Product Name `unity`, package `com.UnityTechnologies...`, Min API 25, architettura da verificare. Vanno sistemati (punto A).

## Cosa fare (sessione locale)
Regole: un gradino alla volta; prima dire cosa si farà e aspettare l'ok; commit piccoli dopo ogni gradino (con i `.meta`); non toccare `src/`, `supabase/` né il deploy web; dopo ogni cambio importante far controllare la Console (niente errori rossi); se un'API Meta/Unity è incerta, cercare la documentazione prima di scrivere codice; le prove sul visore le fa l'utente (APK con `adb install`), chiedere foto/log e raggruppare le modifiche prima di una build.

A. Configurazione Android/Quest (con MCP)
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
