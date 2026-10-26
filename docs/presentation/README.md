# Presentazione meetup

- `immersa-meetup.html` — sorgente delle slide
- `Immersa-Meetup.pdf` — PDF di stampa (Chrome/Edge: Ctrl+P → Salva come PDF, margini nessuno, grafica di sfondo)
- `Immersa-Meetup-modificabile.pdf` — ogni testo è un campo modificabile (Acrobat Reader, Chrome, Edge)

Rigenerare la versione modificabile (richiede `pip install pymupdf`):

```
node docs/presentation/tools/extract.cjs docs/presentation/immersa-meetup.html build/slides
python3 docs/presentation/tools/build.py build/slides docs/presentation/Immersa-Meetup-modificabile.pdf
```
