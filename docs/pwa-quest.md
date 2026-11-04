# Immersa come app sul Quest (PWA → APK) — procedura che ha funzionato

Cartelle: progetto `C:\Users\loren\Documents\immersa`; APK in `C:\Users\loren\Documents\immersa-apk2` (progetto per `app.immersavr.com`; la chiave di firma resta in `immersa-apk\android.keystore` e lo script la trova da solo).
Sito: https://app.immersavr.com (dominio `immersavr.com` comprato su Cloudflare; hosting Cloudflare Pages, progetto `immersa` (verifica con `wrangler pages project list`), indirizzo https://immersa-dsr.pages.dev). L'APK punta al dominio, quindi cambiare hosting non richiede un nuovo APK. Netlify abbandonato (crediti finiti). Il sito deve essere PUBBLICO.

## Aggiornare il sito (basta questo per le modifiche al codice, l'APK non cambia)
```
cd C:\Users\loren\Documents\immersa
git pull origin ccr-9d20ed4e-a2qxlt
npm run build
npx wrangler pages deploy dist --project-name immersa
```
(`dist\models` esiste solo se c'è `public\models`: se c'è, cancellarla prima del deploy.)

## Verifica del dominio (Digital Asset Links) — obbligatoria
Senza `https://app.immersavr.com/.well-known/assetlinks.json` (200 + JSON) la schermata immersiva
di Meta si chiude dopo ~0,5 s. Il file sta in `public/.well-known/assetlinks.json` (package `app.immersa.quest`
+ SHA-256 della chiave `android.keystore`, ricavato con `keytool -list -v`). Va rifatto solo se cambia la chiave.

## Ricostruire l'APK (solo se cambiano manifest, icone, dominio o package)
Un solo comando, dalla cartella dell'APK: `powershell -ExecutionPolicy Bypass -File C:\Users\loren\Documents\immersa\docs\rebuild-apk.ps1` (fa i passi qui sotto).

`bubblewrap build` dà `spawn EINVAL` con Node recente su Windows. Si costruisce con Gradle (PowerShell):
```
cd C:\Users\loren\Documents\immersa-apk
$env:JAVA_HOME = (Get-ChildItem C:\Users\loren\.bubblewrap\jdk -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = "C:\Users\loren\.bubblewrap\android_sdk"
.\gradlew.bat assembleRelease
$bt = (Get-ChildItem "$env:ANDROID_HOME\build-tools" -Directory | Sort-Object Name | Select-Object -Last 1).FullName
& "$bt\zipalign.exe" -p -f 4 app\build\outputs\apk\release\app-release-unsigned.apk app-release-aligned.apk
& "$bt\apksigner.bat" sign --ks android.keystore --ks-key-alias android --out app-release-signed.apk app-release-aligned.apk
adb install -r app-release-signed.apk
```
La chiave `android.keystore` (e la sua password) va conservata: senza, niente aggiornamenti dell'app.

## Debug
- Crash: `adb logcat -b crash -d`; avvio: `adb logcat -d | Select-String -Pattern "immersa|WebXR|chromium|CustomTab"`.
- La pagina scrive `[immersa] ...` (supporto XR, errori di avvio) nella console.

## Guardian (confini) nascosto: esperimento

Il Guardian è del sistema, non della pagina. Per le app in passthrough Meta prevede il flag di manifest
`com.oculus.feature.CONTEXTUAL_BOUNDARYLESS_APP`. `docs/enable-boundaryless.ps1` lo aggiunge al manifest
dell'APK (`Documents\immersa-apk`, con backup `.bak`), poi ricompila, firma e installa. Esito da verificare sul visore: se il
Guardian compare ancora, riprovare con `-Required true`; se l'app non parte più, rimettere il `.bak` e ricompilare.
