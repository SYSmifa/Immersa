# Presentazione meetup Unreal Engine (31 ottobre)

Contesto: evento Unreal Engine, 15 minuti di esposizione, più il video demo (~2 min). Il tema è Unreal,
Immersa è il caso di studio. L'autore ha sviluppato Immersa in **Unreal Engine 5, solo Blueprint**, con
Meta XR SDK, glTFRuntime (import modelli) e VaRest (chiamate REST al cloud). Attenzione: il resto del
repo (`src/`) è una prova di concetto three.js/WebXR, non il progetto Unreal presentato.

## File

- `immersa-meetup.html` — sorgente delle slide (HTML/CSS, A4 orizzontale, tema dark viola/azzurro/smeraldo)
- `Immersa-Meetup.pdf` — PDF grafico di stampa (font Inter, sfumature)
- `Immersa-Meetup-modificabile.pdf` — ogni testo è un campo modificabile (Acrobat Reader, Chrome, Edge)
- `tools/extract.cjs`, `tools/build.py` — generano il PDF modificabile
- `tools/video/make_demo_video.py`, `logo.png` — montaggio del video demo

## Slide (8)

1. Titolo — badge, IMMERSA, sottotitolo su Unreal, card: Unreal Engine 5 · 100% Blueprint · Meta Quest 3
2. Un motore, due app — app desktop Windows e app Quest, collegate dal cloud (API REST · VaRest)
3. Come funziona Immersa — 4 passaggi: scansione, progettazione su PC, visualizzazione nel visore, hand tracking
4. Lo stack in Unreal Engine — Meta XR SDK, glTFRuntime, VaRest, Blueprint
5. Sfide tecniche in Blueprint — allineamento alla stanza, modelli a runtime, sincronizzazione PC e visore
6. Video Demo & Showcase (segnaposto del video)
7. Sviluppi futuri & Roadmap — colocation multi-utente, casi d'uso professionali
8. Domande & Prova Visore

Storia: partita come 6 slide generiche con testi forniti dall'autore parola per parola; poi la slide
"Come funziona" è stata riscritta sui passaggi reali (titoli approvati, testi riscritti due volte) e
la presentazione è stata rifocalizzata su Unreal (slide 2, 4, 5 nuove). Scaletta a tempo suggerita:
titolo 0:30, due app 1:00, come funziona 1:30, demo ~2:00 (video), stack 2:00, sfide 2:30, roadmap 0:45, domande.

Da verificare con l'autore (dedotto, non dichiarato): glTFRuntime scarica i modelli dal catalogo cloud;
"senza una riga di C++"; mouse e tastiera su PC; sincronizzazione in JSON via VaRest. Non indicati:
versione di Unreal, tipo di database/cloud.

## Rigenerare i PDF

Serve `pip install pymupdf`, Node con Playwright (Chromium) e il font Inter.

```
# PDF grafico
node -e "require('playwright').chromium.launch().then(async b=>{const p=await b.newPage();await p.goto('file://'+process.cwd()+'/docs/presentation/immersa-meetup.html');await p.pdf({path:'docs/presentation/Immersa-Meetup.pdf',preferCSSPageSize:true,printBackground:true});await b.close()})"
# PDF modificabile
node docs/presentation/tools/extract.cjs docs/presentation/immersa-meetup.html build/slides
python3 docs/presentation/tools/build.py build/slides docs/presentation/Immersa-Meetup-modificabile.pdf
```

Note sul PDF modificabile: sfondo come immagine + un campo di testo per ogni blocco; font Helvetica
(i viewer lo ridisegnano in modifica), titoli con sfumatura resi in azzurro pieno, niente simboli
fuori da WinAnsi (es. ↔). `build.py` scrive a mano le aree di aspetto dei campi perché MuPDF usa solo
Helvetica regolare. In alternativa: modificare l'HTML e stampare da Chrome (Ctrl+P, margini nessuno,
grafica di sfondo).

## Video demo

Tre registrazioni (fase 1 scansione sul Quest, fase 2 app desktop 2560x1440, fasi 3-4 visore) montate in
un unico video 1080p30 **senza audio** (~2 min 13 s). Non è nel repo (troppo grande). Struttura:
titolo nero con "FASE n" + titolo (4,5 s) → sfuocatura che si fa nitida → fase → sfuocatura che sfuma
al nero; logo Immersa (bianco su trasparente, `logo.png`) come finale.

Regole decise con l'autore (stanno in `PHASES` dentro lo script):
- Nessuna stabilizzazione (provata con vidstab: peggiore dell'originale; resta disattivata).
- Fase 1: logo di apertura ~2 s nitidi; scansione a 1x in 3 pezzi con dissolvenze (si capisce che continua
  senza mostrarla tutta); tolto il posizionamento del box della stanza; tastiera virtuale a 1x.
- Fase 2: ritaglio 2560x1340 dal pixel 40 (via barra titolo Unreal e barra Windows), velocità max 1,5x
  perché l'autore spiega a voce; titolo "Progettazione del layout sull'app desktop".
- Fasi 3-4: tutto a 1x; il caricamento del progetto scorre intero fino alla comparsa dei modelli
  (non tagliarlo); titolo "Nel visore: caricamento e manipolazione oggetti"; tolta la schermata di login
  iniziale e il finale statico (ultimi 3 s).
- Tagli: dissolvenza dove manca girato, taglio netto dove i segmenti sono consecutivi nell'originale.

Rifare il montaggio con registrazioni nuove (`f1.mp4`, `f2.mp4`, `f34.mp4` in una cartella):

```
python3 -I docs/presentation/tools/video/make_demo_video.py <srcdir> <workdir> phase 0   # poi 1 e 2
python3 -I docs/presentation/tools/video/make_demo_video.py <srcdir> <workdir> final <out.mp4>
```

Se i tempi delle nuove riprese cambiano, rivedere i secondi in `PHASES` guardando i fotogrammi
(contact sheet con `ffmpeg ... fps=1/3 ... tile`). Il passo `final` è lento (alcuni minuti): lanciarlo
in background. ffmpeg richiede i filtri drawtext e blend.

## Come lavoriamo (preferenze dell'autore)

- Italiano; prima si discute/si propone, poi si implementa; modifiche piccole e mirate.
- Dopo ogni modifica alle slide rigenerare **entrambi** i PDF e controllare che i testi non escano dalle card.
- Il video viene inviato come file, non committato.
