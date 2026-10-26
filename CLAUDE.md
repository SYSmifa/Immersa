# Immersa Web

## Obiettivo
Visualizzatore WebXR di spazi. Quest 3 scansiona la stanza → cloud. Su PC (stesso account) si caricano
modelli 3D, si posizionano nella stanza, si salva il progetto. Riaperto nel visore, i modelli compaiono
nella posizione reale. Target: aziende (macchinari, allestitori).

## Stack
- TypeScript, three.js, WebXR, Vite
- Supabase (auth, DB stanze/progetti, storage modelli) — non ancora usato
- Modelli glTF/GLB; in futuro STEP → GLB + semplificazione
- Un'unica app: editor su PC + modalità XR nel browser del Quest

## Vincoli
- Quest 3: budget 100-300k triangoli a 72 fps
- Formato stanza (JSON) nostro; la scansione Meta è solo un adattatore sostituibile
- Piano B: allineamento manuale a 2-3 punti
- Test su visore solo dall'utente (riporta errori/comportamento)

## Struttura
- `index.html`, `src/main.ts` — entry point (collega stage, modello, stats)
- `src/scene/stage.ts` renderer/scena/AR button; `src/scene/testModel.ts` carica `/models/test.glb` o mesh procedurale; `src/ui/stats.ts` fps+tris (DOM e pannello 3D in XR)
- `src/` — moduli piccoli, una responsabilità per file (cartelle per area: `xr/`, `scene/`, `room/`, `ui/`)
- `public/models/` — GLB di test, ignorati da git

## Comandi
- `npm run dev` — HTTPS su LAN (cert autofirmato), Quest apre `https://<IP-PC>:5173`, accetta l'avviso
- `npm run dev:usb` — HTTP su localhost; poi `adb reverse tcp:5173 tcp:5173`, Quest apre `http://localhost:5173`
- `npm run build` / `npm run typecheck`
- Windows: IP del PC con `ipconfig`; consentire Node nel firewall (reti private)

## Convenzioni
- Codice e commenti in inglese; questo file in italiano, max 60 righe
- Commit piccoli e frequenti; piano breve → ok utente → implementazione
- Niente riscritture non richieste

## Decisioni
- TypeScript strict, three.js senza framework
- Due modalità di serving: LAN HTTPS (principale) e USB/adb

## Stato
- Fase 1, passi 1-2 testati su Quest 3 via USB: AR passthrough OK, mesh procedurale 300k tris = 90 fps, 11.1 ms
- Test: `?tris=300000` (mesh procedurale), `?size=<m>` (default 1.5); o metti `public/models/test.glb`
- Nota: `dev:usb` lega 127.0.0.1 (su Windows localhost=IPv6 rompe adb reverse)
- Aperto: `npm run dev` (HTTPS LAN) non stampa nulla su PC Windows dell'utente → da indagare (cert basic-ssl)
- Da fare: test con 500k/1M tris e GLB reale (più materiali/texture); passi 3-4 (piani/mesh stanza, anchor)
