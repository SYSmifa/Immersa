# Immersa come app sul Quest (PWA → APK) — procedura che ha funzionato

Cartelle: progetto `C:\Users\loren\Documents\immersa`; APK in `C:\Users\loren\Documents\immersa-apk`.
Sito: https://immersa-lorenzo.netlify.app (Netlify, deve essere PUBBLICO: se risponde 401 è attiva la protezione di accesso).

## Aggiornare il sito (basta questo per le modifiche al codice, l'APK non cambia)
```
cd C:\Users\loren\Documents\immersa
git pull origin ccr-9d20ed4e-a2qxlt
npm run build
npx netlify-cli deploy --prod --dir=dist
```
(`dist\models` esiste solo se c'è `public\models`: se c'è, cancellarla prima del deploy.)

## Verifica del dominio (Digital Asset Links) — obbligatoria
Senza `https://immersa-lorenzo.netlify.app/.well-known/assetlinks.json` (200 + JSON) la schermata immersiva
di Meta si chiude dopo ~0,5 s. Il file sta in `public/.well-known/assetlinks.json` (package `app.immersa.quest`
+ SHA-256 della chiave `android.keystore`, ricavato con `keytool -list -v`). Va rifatto solo se cambia la chiave.

## Ricostruire l'APK (solo se cambiano manifest, icone, dominio o package)
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
