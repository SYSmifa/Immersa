# Immersa come app sul Quest (PWA → APK)

Stato: non provato sul visore. I comandi di Meta vanno verificati sulla loro documentazione
(https://developers.meta.com/horizon/documentation/web/pwa-packaging), che può cambiare.

## 1. Pubblicare il sito
- `npm run build`; cancella `dist/models` (GLB di test); carica `dist` su un hosting HTTPS con certificato valido
  (es. Netlify Drop). `.env.local` finisce nel build (la chiave anon è pubblica).
- Apri l'indirizzo dal browser del Quest: deve comparire "Entra in AR". Con `?pwa` parte da solo (prova).

## 2. APK con lo strumento di Meta
- `npm install --global @meta-quest/bubblewrap-cli`
- Da cartella vuota: init con l'indirizzo del manifest (`https://<dominio>/manifest.webmanifest`),
  poi build. Il manifest: Meta usa solo le icone.
- Verifica del dominio (Digital Asset Links): file `/.well-known/assetlinks.json` sul sito con il
  pacchetto e l'impronta del certificato di firma; senza, l'app non parte. Passaggi esatti nella guida di Meta.

## 3. Installare sul visore (modalità sviluppatore, USB)
- `adb install <file>.apk`; l'app compare in Libreria → Origini sconosciute.
- Aprila dall'icona: deve partire direttamente in AR, poi accedi con la tastiera 3D.

## Cosa osservare
- Parte in AR al tocco sull'icona? Il login in AR funziona? Il passthrough (AR) è permesso in una PWA?
- Dopo standby / chiusura sessione: cosa si vede? Serve un tocco?
