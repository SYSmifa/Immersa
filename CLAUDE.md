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
- Piano B: allineamento manuale a 2-3 punti. Test su visore solo dall'utente (riporta errori/comportamento)

## Struttura
- `src/main.ts` router: visore → `app/headset.ts`; PC → editor. `?test` (modello di prova, `?tris=`/`?size=`), `?probe` (diagnostica), `?edit`, `?uitest`/`?edittest` (menu AR/editor sul PC con backend finto)
- `src/app/` app visore: `launcher.ts` (login 2D + "Entra in AR"), `enterAr.ts` (sessione, fallback reference space), `xrApp.ts` (raggi, piani, pinch, reset), `core.ts` (stato: riconoscimento, scan, progetti, case, menu)
- `src/ui3d/` UI 3D: `panel.ts`, `host.ts` (raggi→click), `keyboard.ts` (tastiera tipo Meta), `menu.ts` (tab Load/Scan/Options/Account)
- `src/room/` `types.ts` (Room=scansione, Project=stanze+modelli, modello ha `roomId`), `align.ts` (allineamento), `recognize.ts`, `around.ts` (stanza sotto la testa, cluster), `occluders.ts` (pareti invisibili), `draw.ts`, `modelLayer.ts`, `capture.ts`
- `src/cloud/` `backend.ts` (interfaccia), `repo.ts` (Supabase), `models.ts` (bucket), `auth.ts`; `supabase/schema.sql` da incollare nell'SQL Editor (idempotente)
- `src/editor/` editor PC: progetto → sue stanze → modelli per stanza (GLB, sposta/ruota/scala), salva. `public/models/`: GLB di test, ignorati da git

## Comandi
- `npm run dev` HTTPS LAN (Quest apre `https://<IP-PC>:5173`); `npm run dev:usb` HTTP su 127.0.0.1 + `adb reverse tcp:5173 tcp:5173` (da rifare dopo standby/cavo)
- `npm run build` / `npm run typecheck`; `.env.local` (non in git): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (solo anon)
- Windows: IP del PC con `ipconfig`; consentire Node nel firewall. Aperto: `npm run dev` non stampa nulla sul PC dell'utente
- Branch di lavoro `ccr-9d20ed4e-a2qxlt`: l'utente fa `git pull origin ccr-9d20ed4e-a2qxlt` in `C:\Users\loren\Documents\immersa`, riavvia Vite e (USB) rifà `adb reverse`; dopo ogni modifica allo schema deve rieseguire `supabase/schema.sql`

## Convenzioni
- Codice e commenti in inglese; questo file in italiano, max 60 righe
- Commit piccoli e frequenti; piano breve → ok utente → implementazione; niente riscritture non richieste
- TypeScript strict, three.js senza framework. Prove sul PC con Playwright (browser headless) su `?uitest`/`?edittest`, con GLB finto `public/models/smoke.glb`; gli script oggi sono ad hoc (non nel repo)
- Aggiornare questo file a ogni cambio di comportamento; l'utente parla italiano e testa sul visore, riportando foto/messaggi

## Stato
- Perf Quest 3: 300k tris 90 fps; GLB 130k 90 fps; 3,9M tris 25-45 fps (limite = pixel/overdraw)
- Quest/WebXR (Horizon 154): anchor persistenti NO; il browser riporta i piani di TUTTE le stanze salvate nel visore; ogni sessione ha origine/yaw/altezza diversi; dopo standby la vecchia sessione vede 0 piani
- Confine (Guardian): non disattivabile da web. Predefinito reference space `unbounded` (fallback local-floor; `?ref=local-floor`): niente confini in sessione nuova, ma al risveglio dallo standby ricompare anche richiedendo di nuovo il reference space (l'utente non usa adb). Rimedio attuale: al `visibilitychange` di ritorno da `hidden` ≥20 s (non con menu Meta/scan: `isScanning`) si riavvia la sessione (`enterAr.restart`; sul Quest serve un tocco su "Entra in AR": confermato, il browser rifiuta `requestSession` senza gesto) e si riapre il progetto (`prepareResume`/`resumePending`; nel pannello 2D "Session in standby.", in AR "Loading project…" fluttuante, se fallisce menu + "Project reload failed"; senza progetto si va al menu); Options mostra gli eventi. Riapertura: in un'altra stanza salvata subito (ancorato lì); in stanza non salvata o senza scansione dopo 12 s (sotto i piedi); se poi una stanza del progetto viene ritrovata i modelli passano al posto vero
- Allineamento stanza↔piani live: solo piani strutturali; centri (ICP) poi distanza lungo le normali (i centri dipendono dal contorno), più partenze (simmetria 180°). Ricontrollato di continuo; reset del reference space = si rifà; stanza non ritrovata = nascosta. Options mostra l'esito per stanza
- Flusso visore: login 2D → AR → menu che segue la testa (☰ al polso, squeeze, X/Y sx) → riconosce la stanza (pavimento sotto la testa + `isInside`) → Scan: salva con nome (tastiera 3D) o `initiateRoomCapture`; Load: tutti i progetti; pinch sx sposta il modello guardato
- Progetto = casa: modelli per stanza nel frame di quella stanza; ogni stanza del progetto si allinea da sola (`roomClusters`+`alignFar`). Contorno stanza (senza pavimento, linee larghe `OUTLINE_WIDTH` 1,5 cm) solo senza progetto aperto; pareti invisibili (depth-only, porte/finestre = buchi, spinte 5 cm all'esterno) coprono i modelli delle altre stanze (Options: mostrale)
- Scansione: piani con contorno + volumi dei mobili (box da `detectedMeshes`, 12 spigoli). Editor: pavimento/mobili semitrasparenti, pareti nascondibili, soffitto mai disegnato
- Scansione della stanza aggiornata da sola (`refreshRoomScan`): stesso id/nome, vecchia in `rooms.previous_data` (rieseguire schema.sql), modelli convertiti col frame live (restano fermi rispetto alle pareti). Scatta (a) dopo "Scansiona di nuovo" (menu Scan, stanza riconosciuta), (b) se la stanza riconosciuta ha scarto >3 cm per 3 controlli (finestra stretta 3-5 cm: oltre non è più riconosciuta), una volta a sessione. DA TESTARE su visore
- PWA solo immersiva (lo store di Meta non accetta PWA 2D/miste): manifest+`sw.js` (solo nel build, serve HTTPS valido); `enter.autoStart()` prova a partire in AR al caricamento (da app installata il lancio è il gesto; in un tab normale resta il bottone "Entra in AR"). Login nel menu AR (tastiera 3D, `?uitest&loggedout`, password finta `secret`). Passi APK/store e dubbi in `docs/pwa-quest.md`. APK: build a mano con gradle (`bubblewrap build` dà spawn EINVAL); l'app apre `WebXRCustomTabActivity` di Meta e FUNZIONA solo con `/.well-known/assetlinks.json` online (senza, si chiude dopo 0,5 s). App installata: passthrough, piani e login OK. Con lo standby l'app si chiude (Meta chiude la schermata immersiva a fine sessione): alla riapertura rilegge l'ultimo progetto aperto (`lastProject` in localStorage, entro 1 h, azzerato da "Chiudi il progetto"/Esci). Interruttore Account "Riavvio dopo standby" (`immersa.noRestart`): ipotesi che a chiudere l'app sia il nostro `restart` (finisce la sessione); con "no" la sessione resta e Options mostra i piani dopo il risveglio. DA TESTARE: standby
- Da decidere con l'utente: accorciare l'attesa di 12 s o mostrare "Riapro il progetto…" nel menu
- DA TESTARE su visore: pareti invisibili (precisione, tagli ai bordi), `initiateRoomCapture`, sessione dopo scan, avvio AR senza tocco, dopo il tocco post-standby: il Guardian sparisce? il progetto si riapre?
- Idee: salvare nel repo le prove Playwright; allineamento manuale a 2 punti se la scena del visore è sfasata; `?model=`, foveation, LOD; login con codice dispositivo; app nativa (Unity) solo se il web non basta
