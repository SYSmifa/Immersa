# Immersa su Unity — piano e specifiche (per la nuova chat)

Questo file è il passaggio di consegne: spiega cosa vogliamo fare, perché, cosa riusare e cosa riscrivere.
Leggere anche `CLAUDE.md` (stato completo dell'app web, che resta la fonte di verità del comportamento).

## 1. Decisione e motivo
L'utente (Lorenzo, parla italiano, ha già lavorato in Unreal) ha deciso di **rifare il visore (Quest 3) in Unity**.
Motivi, tutti verificati nell'app web:
- **Guardian**: dal browser non si toglie. Compare dopo standby, dopo una scansione e in stanze mai scansionate (il flag
  `BOUNDARYLESS_APP` nell'APK c'è e vale solo all'avvio dalla Libreria). In Unreal l'utente l'ha tolto per sempre con
  Meta XR → "Boundary Visibility Support" + "Default Is Boundary Visibility Suppressed" (estensione OpenXR
  `XR_META_boundary_visibility`, solo con passthrough attivo; il sistema può rifiutare e si riprova). In Unity: pacchetto
  Meta OpenXR → feature Boundary Visibility → "Suppress Visibility" + `TryRequestBoundaryVisibility(VisibilitySuppressed)`
  a ogni ripresa (riprovare finché accetta).
- **Una sola scansione per sessione** nel browser (`initiateRoomCapture`: "room capture was already called for this session").
  Nativo: più scansioni nella stessa sessione (Space Setup/MRUK).
- **Stanze instabili** (origine diversa a ogni sessione, deriva di cm/m, piani persi dopo lo standby): nativo ha ancore
  spaziali persistenti, MRUK, eventi pause/resume, profondità reale per l'occlusione.
- Lancio per aziende: l'app deve sembrare un prodotto, senza avvisi di sistema.

## 2. Ambito
- **Unity: SOLO il visore.** L'**editor PC resta web** (importa glb/gltf/obj/fbx/stl/ply/dae/3mf/step/iges/brep/zip,
  semplifica con meshoptimizer, DXF, vista d'insieme, annotazioni…: in Unity a runtime servirebbero asset a pagamento).
- **Il backend resta Supabase**, stesse tabelle, stesso bucket `models`, stessi JSON: PC web e visore Unity condividono
  gli stessi progetti. Non cambiare schema senza motivo; se serve, aggiornare `supabase/schema.sql` e dirlo all'utente.
- Il formato stanza è NOSTRO (`RoomScan`, vedi `src/room/types.ts`): la scansione Meta (MRUK) è solo un adattatore che
  produce quel JSON (piani con contorno + box dei mobili), così il PC continua a mostrare le stanze.
- Pacchetto/firma: tenere `app.immersa.quest` e la stessa keystore (`immersa-apk\android.keystore`) se si vuole che
  l'app Unity sostituisca l'APK web (TWA) sul visore.

## 3. Cosa NON posso fare io (importante per chi lavora)
Il container non ha l'editor Unity né la licenza né uno schermo: **non posso compilare né provare Unity**. Quindi:
- scrivere C# ordinato e semplice, con il minimo di API fragili; niente codice "a occhio" su API incerte: cercare la
  documentazione (WebSearch) prima di usare un'API Meta/Unity;
- la matematica pura (layout, misure, annotazioni, luoghi, allineamento) va scritta in file C# **senza `UnityEngine`**
  (o con un wrapper minimo) così si compila ed esegue con `dotnet` qui, con test portati da `docs/test-plans/*.test.mts`;
- scene/prefab: preferire la creazione **da codice** (script che costruiscono la scena all'avvio) o YAML minimo; dire
  all'utente passo per passo cosa fare nell'editor (pacchetti da importare, Build Settings, simboli);
- ogni modifica va provata dall'utente sul visore: chiedere foto/messaggi/Registro eventi e fare piccoli passi;
- commit piccoli e frequenti; piano breve → ok utente → implementazione; niente riscritture non richieste.
Test con Unity: Play mode con Meta XR Simulator sul PC dell'utente (opzionale), poi APK sul visore (`adb install`).

## 4. Dove mettere il progetto
Proposta: cartella `unity/` nello stesso repo (`sysmifa/immersa`, branch di lavoro `ccr-9d20ed4e-a2qxlt`), con
`.gitignore` Unity (Library, Temp, Obj, Builds, Logs, UserSettings). Unity 6 LTS, URP, Android (ARM64, IL2CPP), Quest 3,
Meta XR All-in-One SDK / Meta OpenXR. L'utente decide se vuole un repo a parte.

## 5. Piano a gradini (con punti di decisione)
0. **Prototipo di rischio (1-2 settimane)**: passthrough senza Guardian (anche dopo standby e scansione); login Supabase;
   elenco progetti; apertura di stanze + modelli GLB; spostare un modello con le mani; **due scansioni di fila nella
   stessa sessione**. Se regge → avanti, se il Guardian ricompare → fermarsi e decidere con l'utente.
1. Dati: client Supabase (REST con `UnityWebRequest` o SDK community), modelli C# degli stessi JSON di `types.ts`
   (usare Newtonsoft `com.unity.nuget.newtonsoft-json`, i campi opzionali restano opzionali), cache dei GLB su disco con
   percorso `<utente>/<sha256>.glb` come ora, precaricamento.
2. Stanze: adattatore MRUK → `RoomScan`; riconoscimento/ancore; contorno stanza, pareti invisibili depth-only per
   le altre stanze, occlusione; collegamenti tra stanze (valutare quanto resta necessario con le ancore).
3. Modelli: glTFast (verificare supporto `EXT_meshopt_compression`/`KHR_mesh_quantization`), colori per materiale,
   rugosità/metallico, componenti (`PartEdit`, percorso = indici dei figli del nodo glTF, stesso albero del file!).
4. Interazione: Interaction SDK (raggio, mani virtuali, pinch, due mani scala/rotazione con snap magnetici), selezione con
   contorno azzurro (shader), pareti/pavimenti (`Structure`, texture da catalogo), doppio pinch = componente.
5. UI: menu "Aura" che segue la testa (Progetti/Stanza/Opzioni/Account/Strumenti), tastiera di sistema, toast, loader,
   splash con logo, Registro eventi, pannello fps.
6. Misure, distanze, annotazioni (note/metro con le modalità asse/altezza/verticale), visita virtuale CAD.
7. Distribuzione: APK, firma, store/MDM (Meta Horizon Managed Services o ADB/SideQuest per test).

## 6. Mappa delle funzioni attuali (web → Unity)
Fonte: `CLAUDE.md` e i file indicati. Portare il COMPORTAMENTO, non la struttura.
- **Dati** `src/room/types.ts`, `src/cloud/backend.ts`, `supabase/schema.sql`: stessi tipi e stesse tabelle
  (`rooms`: scan jsonb, `previous_data`, `place`, `created_at`; `projects`: `room_ids`, `models`, `structures`,
  `annotations`, `tone`, `updated_at`; bucket privato `models`; `device_links`/Edge Function `link-device`).
- **Login** (`cloud/repo.ts`, `auth.ts`): email+password; codice via email (`signInWithOtp` + `verifyOtp`, solo account
  esistenti); "Accedi con un codice dal PC" (`deviceLogin`, Edge Function `link-device`, tabella `device_links`).
  Google nel visore: no. "Esci" chiude solo la sessione locale (`scope: local`).
- **Stanze** (`room/align.ts`, `recognize.ts`, `layout.ts`, `anchors.ts`, `places.ts`): nomi unici; luoghi (un luogo per
  progetto); allineamento live; collegamenti `RoomLink` con fiducia provvisorio/confermato; allineamento manuale a 2
  angoli; "Aggiorna stanza"; Registro con piani trovati/scarto. **Con ancore persistenti e MRUK molto di questo può
  semplificarsi: decidere insieme all'utente cosa tenere.** Convenzione di allineamento: x' = c·x − s·z + tx,
  y' = y + ty, z' = s·x + c·z + tz (yaw di three = −yaw). Attenzione agli assi: three è destra, Unity è sinistra (z invertito).
- **Modelli** (`room/modelLayer.ts`, `parts.ts`, `selection.ts`): GLB; `pos` = centro della base nel frame della stanza,
  `yaw`, `tilt` (Ry·Rx·Rz), `scale`, colori, finish, `parts`. Modello non caricabile = cubo rosso + avviso. Selezione:
  materiale azzurro semitrasparente, un solo strato (copia solo-profondità + passata azzurra), puntamento sui triangoli.
- **Strutture** (`room/structures.ts`, `textures.ts`): pareti (`align`), pavimenti poligonali, texture da catalogo
  (parquet, piastrelle, mosaico, muro, mattoni, cemento, marmo, pietra: colore, normal, AO, roughness; UV in metri; meglio
  portare file precalcolati che il generatore), `finish`, `xf` (spostamento fatto nel visore).
- **Misure/annotazioni** (`room/measure.ts`, `measureView.ts`, `annotations.ts`): dimensioni e distanze dalle pareti
  solo dell'oggetto selezionato (parte sempre spento); note e metri con colori, scala nota 0,4-4×, a capo, max 200
  caratteri/8 righe, asterisco sul pavimento, nascosti se dietro un muro (`behindWalls`), modalità del metro
  (Libero/Asse/Stessa altezza/Verticale, snap 6°), creazione da Strumenti.
- **Interazione**: mano dominante Destra/Sinistra; menu si apre col pinch della mano NON dominante o tasti X/Y/A/B;
  laser stile Meta (sparisce con palmo in alto); pinch dx = seleziona/trascina sul pavimento o sopra altri modelli;
  + pinch sx = scala (distanza) e ruota (angolo) con snap (pareti mod 90° o 15°, scala a passi tondi), un gesto alla volta,
  schede Rotazione/Scala; pulsante tondo vicino all'oggetto (`headHeightSpot`); doppio pinch = componente; nulla si
  salva da solo ("Salva le modifiche").
- **UI/stile "Aura"**: sfondo inchiostro + accento turchese, font Sen, tile con iniziale e 8 toni (`projects.tone`),
  barra Progetti/Stanza/Opzioni/Account (+ Strumenti), ricerca progetti, "IN QUESTA STANZA"/"ALTRE STANZE", scroll col
  pinch, splash cubo wireframe + logo `src/assets/logo-immersa.png` (≥2,4 s), loader cubo, toast, Registro eventi,
  Account con versione/avvio. Vedi `ui3d/theme.ts`, `icons.ts`, `menu.ts`.
- **Visita virtuale** (pianta CAD senza stanze): cielo/terreno opachi, teletrasporto, scheda ATTENZIONE.
- **Progetti senza stanza**: modelli con `roomId` '' = spazio libero davanti all'utente.
- **Prestazioni di riferimento**: 300k tris 90 fps, 3,9M tris 25-45 fps (limite = pixel/overdraw), budget prudente 100-300k.
- **Standby/Guardian**: obiettivo = non servono più i giri del web (scheda "Cerco la stanza", riavvii): sfruttare gli
  eventi di sistema e le ancore.

## 7. Cose stupide da non dimenticare
- Assi/handedness Unity vs three (z invertito, quaternioni, rotazione Y con segno opposto); unità in metri.
- Cartelle/file glTF: i nodi devono avere lo stesso ordine dei figli di three per `PartEdit`; i primitive dello stesso mesh = 1 componente.
- Permessi Android/Meta (scene, passthrough, hand tracking, spatial anchor) in manifest + richiesta a runtime.
- Hand tracking: tenerlo attivo insieme ai controller non necessari; Options "Mano dominante".
- `.env`: URL e chiave anon di Supabase NON vanno nel repo; usare un file locale non versionato/ScriptableObject ignorato.
- Splash di Unity (Personal) e licenza: controllare prima del lancio commerciale.
- Dimensione APK, build IL2CPP lente: build solo quando serve.
- Ogni correzione richiede nuova build e installazione: raggruppare le modifiche prima di chiedere un test.
- Il web va mantenuto allineato (formati JSON): non cambiare i campi senza aggiornare entrambi.
