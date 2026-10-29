# Immersa come app sul Quest (PWA → APK)

Stato: non provato sul visore. Comandi ricavati dalla guida di Meta
(https://developers.meta.com/horizon/documentation/web/pwa-packaging/): verificarli lì se qualcosa non torna.

Cartelle: progetto `C:\Users\loren\Documents\immersa`; APK in una cartella vuota a parte `C:\Users\loren\Documents\immersa-apk`.

## 1. Build e primo deploy
```
cd C:\Users\loren\Documents\immersa
git pull origin ccr-9d20ed4e-a2qxlt
npm install
npm run build
rmdir /s /q dist\models        (cmd)   |   Remove-Item -Recurse -Force dist\models   (PowerShell)
npx netlify-cli login
npx netlify-cli deploy --prod --dir=dist     (primo giro: crea un sito nuovo, annota l'indirizzo https://<nome>.netlify.app)
```
Controlla dal browser del Quest che l'indirizzo apra la pagina con "Entra in AR".

## 2. Strumento di Meta e APK
```
npm install --global @meta-quest/bubblewrap-cli
mkdir C:\Users\loren\Documents\immersa-apk
cd C:\Users\loren\Documents\immersa-apk
bubblewrap init --manifest=https://<nome>.netlify.app/manifest.webmanifest --metaquest
```
Risposte: installa JDK e Android SDK se te lo chiede; modalità immersive; package ID `app.immersa.quest`;
crea la chiave di firma (password da conservare, la cartella con la chiave va salvata: serve per ogni aggiornamento).
Copia la riga SHA-256 che stampa, poi:
```
bubblewrap fingerprint add <SHA256>
```
Crea `assetlinks.json` nella cartella dell'APK.

## 3. Verifica del dominio
Copia `assetlinks.json` in `C:\Users\loren\Documents\immersa\public\.well-known\assetlinks.json`, poi
`npm run build`, cancella `dist\models`, `npx netlify-cli deploy --prod --dir=dist`.
Apri `https://<nome>.netlify.app/.well-known/assetlinks.json`: deve mostrare il JSON.

## 4. Costruire e installare
```
cd C:\Users\loren\Documents\immersa-apk
bubblewrap build
adb devices
adb install app-release-signed.apk
```
Nel visore: Libreria → filtro "Origini sconosciute" → Immersa.

## Da osservare
Parte in AR all'icona? Login in AR? Passthrough permesso? Cosa succede dopo standby / scansione?
