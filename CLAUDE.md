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
- `index.html`, `src/main.ts` — entry point (collega stage, modello, stats)
- `src/scene/stage.ts` renderer/scena/AR button; `src/scene/testModel.ts` carica `/models/test.glb` o mesh procedurale; `src/ui/stats.ts` fps+tris (DOM e pannello 3D in XR)
- `src/xr/probe.ts` diagnostica `?probe`: piani/mesh Space Setup + anchor persistente, confronto con sessioni precedenti (localStorage); `src/ui/textPanel.ts` pannello 3D multi-riga
- `src/room/` formato stanza (`types.ts`), allineamento ICP yaw+traslazione (`align.ts`), lettura piani (`capture.ts`), storage (`storage.ts`: Supabase se loggato, altrimenti localStorage); `modelLayer.ts` carica/posiziona i GLB (scala reale); `src/xr/roomMode.ts` vista visore `?room`
- `src/editor/` editor PC `?edit` (stanza in wireframe, upload GLB, sposta/ruota/scala, salva)
- `src/cloud/supabase.ts` client; `src/ui/login.ts` login email+password (2D, prima di entrare in AR); `supabase/schema.sql` tabella `rooms` + bucket `models` con RLS (da incollare nell'SQL Editor)
- `src/` — moduli piccoli, una responsabilità per file (cartelle per area: `xr/`, `scene/`, `room/`, `ui/`)
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
- Fase 1, passi 1-2 testati su Quest 3 via USB (render semplice, 2 luci, niente ombre):
  - mesh procedurale 300k tris: 90 fps (cap del display, non indica il margine reale)
  - cucina GLB 130k tris, più materiali: 90 fps stabili
  - macchinario GLB 3,9M tris: 25-45 fps (peggiora avvicinandosi → limite = pixel/overdraw, non solo tris)
- Test: `?tris=300000` (mesh procedurale), `?size=<m>` (default 1.5); o `public/models/test.glb` (nome fisso)
- `dev:usb` lega 127.0.0.1 (su Windows localhost=IPv6 rompe adb reverse); `adb reverse` va rifatto dopo standby/cavo
- Aperto: `npm run dev` (HTTPS LAN) non stampa nulla su PC Windows dell'utente → da indagare (cert basic-ssl)
- `?probe` testato su Quest (Horizon 154): piani Space Setup stabili tra sessioni (scarto <3 cm dopo allineamento); anchor persistenti NON supportati
- Ogni sessione XR ha origine/yaw/altezza pavimento diversi (dy fino a 40 cm) → la stanza salvata va riallineata ai piani live
- Dopo standby la vecchia sessione vede 0 piani; ricaricando tornano → riavviare la sessione XR
- `?room` testato: stanza catturata in automatico al primo uso, salvata su Supabase (una per utente, `?room=reset` la rifà). Pinch sinistro = sposta il modello guardato nel punto del pinch; destro = cubo di test
- `?edit` (da testare con GLB reale): modelli in `room.models` (`path` nel bucket, pos/yaw/scala reale); stanze vecchie senza contorni piani → `?room=reset`
- Idee: `?model=`, foveation/framebuffer scale, LOD/semplificazione
