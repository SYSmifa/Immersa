# Immersa Web

## Obiettivo
Visualizzatore WebXR di spazi. Quest 3 scansiona la stanza → cloud. Su PC (stesso account) si caricano
modelli 3D, si posizionano nella stanza, si salva il progetto. Riaperto nel visore, i modelli compaiono
nella posizione reale. Target: aziende (macchinari, allestitori).

## Stack
- TypeScript, three.js, WebXR, Vite; Supabase (auth, tabelle `rooms`/`projects`, bucket privato `models`)
- Modelli glTF/GLB (futuro: STEP → GLB + semplificazione); un'unica app: editor PC + modalità XR nel Quest

## Vincoli
- Quest 3: budget 100-300k tris a 72 fps (prudente; misure reali molto più alte, vedi Stato)
- Formato stanza (JSON) nostro; la scansione Meta è solo un adattatore sostituibile
- Test su visore solo dall'utente (riporta foto/messaggi/tab Options); io provo sul PC con Playwright su `?uitest`

## Struttura
- `src/main.ts` router: visore → `app/headset.ts`; PC → editor. `?test`, `?probe`, `?edit`, `?uitest`/`?edittest` (menu AR/editor sul PC con backend finto; `&loggedout` = login in AR, password finta `secret`)
- `src/app/` visore: `launcher.ts` (solo "Entra in AR" nel browser), `enterAr.ts`, `headset.ts` (avvio, rilancio), `xrApp.ts` (raggi, piani, pinch, standby), `core.ts` (stato: riconoscimento, scan, progetti, menu)
- `src/ui3d/` UI 3D: `panel.ts`, `host.ts` (raggi→click), `keyboard.ts` (tastiera 3D), `menu.ts` (tab Load/Scan/Options/Account)
- `src/room/` `types.ts` (Room=scansione, Project=stanze+modelli, modello ha `roomId`), `align.ts`, `recognize.ts`, `around.ts`, `occluders.ts`, `draw.ts`, `modelLayer.ts`, `capture.ts`
- `src/cloud/` `backend.ts`, `repo.ts` (Supabase), `models.ts`, `auth.ts`; `supabase/schema.sql` da rieseguire nell'SQL Editor a ogni modifica
- `src/editor/` editor PC (progetto → stanze → modelli per stanza: GLB, sposta/ruota/scala, salva). `public/models/` GLB di test (non in git). `docs/` APK e hosting

## Comandi
- `npm run dev` HTTPS LAN; `npm run dev:usb` + `adb reverse tcp:5173 tcp:5173`; `npm run build` / `npm run typecheck`; `.env.local` (non in git): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Deploy (PowerShell, `C:\Users\loren\Documents\immersa`): `git pull origin ccr-9d20ed4e-a2qxlt`, `npm run build`, `npx wrangler pages deploy dist --project-name immersa` (progetto Pages `immersa`, indirizzo immersa-dsr.pages.dev: verifica con `wrangler pages project list`)
- Branch di lavoro `ccr-9d20ed4e-a2qxlt`; dopo modifiche allo schema l'utente riesegue `supabase/schema.sql`

## Convenzioni
- Codice e commenti in inglese; questo file in italiano, max 60 righe
- Commit piccoli e frequenti; piano breve → ok utente → implementazione; niente riscritture non richieste
- TypeScript strict, three.js senza framework; aggiornare questo file a ogni cambio di comportamento; l'utente parla italiano

## Stato
- Perf Quest 3: 300k tris 90 fps; GLB 130k 90 fps; 3,9M tris 25-45 fps (limite = pixel/overdraw)
- Distribuzione: l'app è un APK (TWA di Meta, `WebXRCustomTabActivity`, package `app.immersa.quest`) che carica https://app.immersavr.com (Cloudflare Pages). L'APK non cambia con il codice, solo con manifest/dominio/package: `docs/pwa-quest.md`, `docs/rebuild-apk.ps1` (gradle; `bubblewrap build` dà spawn EINVAL). Chiave di firma `immersa-apk\android.keystore` (da non perdere). Serve `/.well-known/assetlinks.json` online (senza, l'app si chiude in 0,5 s). Lo store di Meta accetta solo PWA immersive
- Visore: `enter.autoStart()` avvia l'AR al lancio; login nel menu AR (tastiera 3D); menu che segue la testa (☰ al polso, squeeze, X/Y sx); riconosce la stanza (pavimento sotto la testa + `isInside`); Scan: salva con nome o `initiateRoomCapture`/"Scansiona di nuovo"; Load: progetti; pinch dx tenuto su un modello lo trascina sul pavimento o sopra altri modelli (`updateGrab`, `surfaceUnder`); + pinch sx: la distanza tra le mani scala, l'angolo ruota sul posto (snap magnetico, Options → Snap: rotazione sulle pareti della stanza (mod 90°) o a passi di 15° dalla rotazione iniziale, scala a passi tondi; un gesto alla volta, soglie `SCALE_START`/`TURN_START`; pannello sopra il modello con valori attuali e di partenza) (nulla si salva da solo: tab Load → "Salva le modifiche"; aprire un progetto lo rilegge dal cloud); UI "Aura" (font Sen via `@fontsource/sen`, sfondo inchiostro + accento turchese; `ui3d/theme.ts` token, `icons.ts`, widget card/chip/nav/pill/iconbtn/surface in `panel.ts`; menu: header con titolo + barra in basso Progetti/Stanza/Opzioni/Account, "Salva" in header quando ci sono modifiche, toast per i messaggi; loader = cubo wireframe animato `ui3d/loader.ts`: scheda "Carico il progetto — Modelli n/m" davanti a te finché `modelsPending()`=0, e sul menu mentre carica la lista; il menu parte sempre su Progetti; splash all'avvio: cubo wireframe animato con il logo (`src/assets/logo-immersa.png`) davanti, senza sfondo, almeno 2,4 s, durante lo splash stanza e modelli sono nascosti; poi dissolvenza e si apre il menu; lo splash NATIVO all'apertura è dell'APK: icona del manifest su `background_color`); pannelli come quad layer WebXR (`ui3d/layers.ts`, feature `layers`, canvas a densità 1,5; mesh solo per i raggi; raggio e cerchio del laser = layer sopra i pannelli (nastro verso l'occhio, ridisegnato ogni frame; i layer vanno composti sopra la scena e i quad appaiono 2× più grandi: `QUAD_SIZE` 0,5); fallback alla scena se errore GL; Options → "Pannelli nitidi"; `?flipy=0` se capovolti; DA TESTARE su visore); laser dalla mano destra stile Meta (bianco sfumato alle estremità, cerchio grigio che si rimpicciolisce col pinch; `ui3d/laser.ts`, `core.aim`; ruota/slider continuano a seguire il pinch anche fuori dal widget: `UiHost.drag`): pinch dx su un modello lo seleziona; sopra compare il pulsante tondo con le tre lineette → vista oggetto nel menu (rotazione/scala numeriche con tastiera 3D, colore: pagina con lista materiali (`materialColors` per indice) o tutti (`color`), ruota HSV + barra luminosità + preset + slider Rugosità/Metallico (`finish`/`materialFinish`; envmap RoomEnvironment creata al primo uso in `scene/stage.ts`) (`ui3d/color.ts`, widget `wheel`/`slider`), elimina con conferma; con il menu aperto il modello mostra i colori veri, non l'azzurro; tutto non salvato finché "Salva le modifiche") (materiale azzurro semitrasparente; puntamento preciso sui triangoli con BVH (`three-mesh-bvh`, box come filtro): `room/selection.ts`), pinch nel vuoto deseleziona. Un avvio normale non apre progetti. fps/ms/tris: Options → "Pannello fps" (default spento; senza di esso compariva un guscio azzurro sui modelli, CAUSA DA TROVARE; in Options una riga eventi "GL err … mask …" ogni 4 s); Account: `Versione` (commit+ora) e `Avvio:` (secondi per fase); Options: eventi, piani, esito allineamento
- Stanze: allineamento stanza↔piani live (solo piani strutturali, ICP poi distanza lungo le normali, 2 partenze); progetto = casa (modelli per stanza nel suo frame, `roomClusters`+`alignFar`); contorno stanza (senza pavimento, linee larghe `OUTLINE_WIDTH`) solo senza progetto; pareti invisibili depth-only per le altre stanze; scansione = piani con contorno + box dei mobili; `refreshRoomScan` aggiorna la scansione salvata (vecchia in `rooms.previous_data`) dopo "Scansiona di nuovo" o scarto >3 cm
- Quest/WebXR: anchor persistenti NO; il browser riporta i piani di TUTTE le stanze salvate; ogni sessione ha origine diversa; finire la sessione chiude l'app installata; il Guardian non è disattivabile (reference space `unbounded`, fallback local-floor). Dopo uno standby la sessione perde i piani e sposta l'origine (con off/on di 1 s tornano). Scartati: ancore, nuovo reference space, finestra di scansione "Non ora" (richiede un tocco)
- Standby (`xrApp.ts`): se i piani spariscono per `NO_PLANES_MS` (1,5 s) → contorno/modelli nascosti, menu chiuso, "Restarting Immersa…", dopo 0,6 s la sessione finisce (app chiusa) e `headset.ts` prova a rilanciarla con `intent://` (ESPERIMENTO, esito da verificare); altrimenti si riapre dalla Libreria entro 3 min. `restartMark` porta SOLO il progetto aperto allora (o nessuno); "Loading project…/rooms…" resta finché stanza e modelli (`modelsPending`) sono pronti; modelli scaricati in anticipo (`preloadModels`); service worker cache-first su `/assets/`
- DA TESTARE su visore: laser/selezione con le mani, rilancio automatico con `intent://`, pareti invisibili (precisione), `refreshRoomScan`, `initiateRoomCapture`
- Da decidere con l'utente: accorciare l'attesa di 12 s (stanza non trovata) o mostrare "Riapro il progetto…"

## Da fare (priorità dell'utente)
- Migliorare l'interfaccia grafica (menu 3D, tastiera, launcher, editor)
- Hand tracking e interazione con gli oggetti sul visore (feature `hand-tracking` e permesso già attivi; fatti: selezione, trascinamento, scala/rotazione a due mani; da rifinire dopo i test)
- Migliorare l'app Windows (editor PC in `src/editor/`)
- Idee: dominio per il sito vetrina, conversione STEP→GLB, salvare le prove Playwright nel repo, allineamento manuale a 2 punti, `?model=`, foveation, LOD, app nativa (Unity) solo se il web non basta
