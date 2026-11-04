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
- `src/editor/` editor PC in stile Aura (`editorUi.ts` DOM+CSS, `editor.ts` logica): sidebar sx con Apri progetto/Nuovo progetto/Le mie stanze (poi impostazioni del progetto; login in fondo alla sidebar); barra centrale in alto con Pavimento, Parete, gizmo Sposta/Ruota/Scala (W/E/R), camera prospettiva↔ortogonale (pianta; in realtà fov 1° da lontano), snap griglia (5 cm, 15°) e vertici, pivot mondo/relativo, undo/redo (Ctrl+Z/Y), Salva (Ctrl+S); in alto a destra outline della scena (clic, Maiusc = multi) e sotto i dettagli (modello: scala, rotazione, materiali colore/R/M; parete/pavimento: altezza, spessore, colore). Clic sinistro seleziona (Maiusc aggiunge), outline azzurro con OutlinePass (scene.background, non clear color); costruisci = trascina sul pavimento, poi torna alla selezione (Maiusc premuto = ne crea altri); `Project.structures` (jsonb, `room/structures.ts`) visibile anche nel visore. 