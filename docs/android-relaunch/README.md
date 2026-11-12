# Riavvio dell'app da dentro (esperimento)

Obiettivo: dopo uno standby (o prima di una seconda scansione) l'app si deve riavviare **come se la aprissi dalla Libreria**,
perché una partenza dalla Libreria non ha il Guardian. Il vecchio riavvio apriva `intent://<sito>` verso l'app già aperta: Android
lo consegna all'app in esecuzione, non è un nuovo avvio e il confine ricompare.

## Come funziona
- L'APK ha una piccola attività, `RelaunchActivity` (`docs/android-relaunch/RelaunchActivity.java`), con un link `immersa://relaunch`.
- La pagina (`src/app/relaunch.ts`) apre `intent://relaunch?mode=<modo>#Intent;scheme=immersa;package=app.immersa.quest;end`.
- L'attività avvia di nuovo l'app da zero. Tre modi (si scelgono dalla pagina Account, riga sotto i pulsanti; il quarto, `legacy`, è
  il vecchio modo, per confronto):
  - `clear`: lancia l'attività principale in un nuovo task cancellando il vecchio (NEW_TASK | CLEAR_TASK);
  - `remove`: chiude prima gli altri task dell'app, poi (dopo 0,5 s) lancia l'attività principale;
  - `vr`: come `clear`, ma con la categoria `com.oculus.intent.category.VR` che usa la home del Quest, se l'app la dichiara.

## Installazione (PowerShell, dalla cartella del progetto web)
```
powershell -ExecutionPolicy Bypass -File .\docs\enable-relaunch.ps1 -Project C:\Users\loren\Documents\immersa-apk2
```
Aggiunge la classe e la voce nel manifest, ricompila, firma (chiede la password della chiave) e installa. Per toglierla: stesso comando con `-Undo`.
Poi pubblica il sito (la parte web è nel commit dell'esperimento): `git pull`, `npm run build`, `wrangler pages deploy`.

## Prova sul visore (una per modo, in quest'ordine: clear, remove, vr)
1. Apri Immersa dalla Libreria. Menu → Account → scegli il modo (✓ verde) → **Riavvia**.
2. Guarda: l'app si chiude e si riapre da sola? Compare il Guardian? Le stanze tornano? Quanto ci mette?
3. Account → **Registro**: deve esserci `riavvio a mano`, `riavvio: <modo>` e, dopo la riapertura, `avviata dopo riavvio (<modo>) in N s`.
   Se compare `l'APK non ha risposto, nuova sessione qui` l'APK non ha l'attività (o il link non è stato accettato).
4. Poi la prova vera: dopo il riavvio riuscito, togli il visore, aspetta lo standby, rimettilo. Il Guardian c'è? Se sì, il riavvio va rifatto
   a ogni risveglio (da decidere: opzione "riavvia da solo al risveglio").
5. Se qualcosa non va, dal PC (visore collegato): `adb logcat -s immersa-relaunch` mostra cosa ha fatto l'attività (modo, intento, esito).

## Cosa riportare
Per ogni modo: si riapre? tempo? Guardian subito dopo? Guardian dopo lo standby? Il testo del Registro e, se serve, le righe di logcat.
