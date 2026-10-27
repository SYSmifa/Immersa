# Immersa Web

## Obiettivo
Visualizzatore WebXR di spazi. Quest 3 scansiona la stanza → cloud. Su PC (stesso account) si caricano
modelli 3D, si posizionano nella stanza, si salva il progetto. Riaperto nel visore, i modelli compaiono
nella posizione reale. Target: aziende (macchinari, allestitori).

## Stack
- TypeScript, three.js, WebXR, Vite
- Supabase (auth, tabella `rooms`, bucket privato `models`)
- Modelli glTF/GLB; in futuro STEP → GLB + semplificazione
- Un'unica app: editor su PC + modalità XR nel browser del Quest

## Vincoli
- Quest 3: budget iniziale 100-300k tris a 72 fps (prudente, vedi Stato: misure reali molto più alte)
- Formato stanza (JSON) nostro; la scansione Meta è solo un adattatore sostituibile
- Piano B: allineamento manuale a 2-3 punti
- Test su visore solo dall'utente (riporta errori/comportamento)

## Struttura
- `src/main.ts` router: visore → app AR (`app/headset.ts`); PC → editor. `?test` (modello di prova, `?tris=`/`?size=`), `?probe` (diagnostica Space Setup), `?edit`, `?uitest`/`?edittest` (menu AR/editor sul PC con backend finto)
- `src/app/` app visore: `launcher.ts` (login 2D + "Entra in AR"), `xrApp.ts` (raggi mani, piani, pinch, bottone al polso), `core.ts` (stato: riconoscimento stanza, scan, progetti, menu), `fakeBackend.ts`/`uitest.ts`/`edittest.ts` (test)
- `src/ui3d/` UI 3D: `panel.ts` (widget su canvas), `host.ts` (raggi→hover/click), `keyboard.ts` (tastiera tipo Meta), `menu.ts` (tab Load/Scan/Options/Account)
- `src/room/` tipi (`types.ts`: Room=scansione, Project=modelli), allineamento ICP (`align.ts`), riconoscimento (`recognize.ts`), `modelLayer.ts` (GLB, scala reale), `draw.ts`, `capture.ts`
- `src/cloud/` `backend.ts` (interfaccia), `repo.ts` (Supabase rooms/projects), `models.ts` (bucket), `auth.ts`; `supabase/schema.sql` da incollare nell'SQL Editor (rooms, projects, bucket `models`, RLS)
- `src/editor/` editor PC: scegli stanza → progetto, carica GLB, sposta/ruota/scala, salva
- `src/scene/` stage, testModel, testScene; `src/xr/probe.ts`, `pinch.ts`; `src/ui/` login, stats, textPanel
- `public/models/` — GLB di test, ignorati da git

## Comandi
- `npm run dev` — HTTPS su LAN (cert autofirmato), Quest apre `https://<IP-PC>:5173`, accetta l'avviso
- `npm run dev:usb` — HTTP su localhost; poi `adb reverse tcp:5173 tcp:5173`, Quest apre `http://localhost:5173`
- `npm run build` / `npm run typecheck`
- `.env.local` (ignorato da git): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (solo chiave anon); senza, l'app resta locale
- Windows: IP del PC con `ipconfig`; consentire Node nel firewall (reti private)

## Convenzioni
- Codice e commenti in inglese; questo file in italiano, max 60 righe
- Commit piccoli e frequenti; piano breve → ok utente → implementazione
- Niente riscritture non richieste

## Decisioni
- TypeScript strict, three.js senza framework
- Due modalità di serving: LAN HTTPS (principale) e USB/adb

## Stato
- Fase 1 testata su Quest 3 (USB): 300k tris 90 fps; GLB 130k 90 fps; 3,9M tris 25-45 fps (limite = pixel/overdraw)
- `dev:usb` lega 127.0.0.1 (Windows: localhost=IPv6 rompe adb); `adb reverse` va rifatto dopo standby/cavo
- Aperto: `npm run dev` (HTTPS LAN) non stampa nulla su PC Windows dell'utente (cert basic-ssl)
- Space Setup: piani stabili tra sessioni (scarto <3 cm dopo allineamento); anchor persistenti NON supportati (Horizon 154)
- Ogni sessione XR ha origine/yaw/altezza diversi → riallineare la stanza salvata ai piani live (ICP). Dopo standby la vecchia sessione vede 0 piani → riavviare la sessione
- Flusso (testato solo sul PC con `?uitest`/`?edittest`, DA TESTARE su visore): login 2D → AR → menu che segue la testa (bottone ☰ al polso, squeeze o X/Y sinistro) → riconosce la stanza tra quelle su Supabase; Scan: salva (nome con tastiera 3D) o avvia scan (`initiateRoomCapture`, se esiste); Load: progetti della stanza; pinch sinistro sposta il modello guardato
- Il browser riporta i piani della stanza memorizzata anche se NON sei lì → il match non basta: `recognize.ts` controlla che la testa sia dentro la stanza, altrimenti chiede conferma ("Sì, sono in questa stanza") o propone la scansione
- Incognite da verificare: `initiateRoomCapture` in 154, sessione dopo scan, avvio AR senza tocco (offerSession), gesto di richiamo menu
- Dopo l'update schema: stanze vecchie senza contorni → rifare scan
- Idee: `?model=`, foveation, LOD; login con codice dispositivo; opzioni
