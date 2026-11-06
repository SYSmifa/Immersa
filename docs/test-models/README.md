# File di prova per l'importazione

Trascinali sulla finestra dell'editor, oppure "Aggiungi un modello" (si possono scegliere più file insieme).
Una scatola da 2 x 1 x 0,5 m in vari formati, più alcuni file CAD. Cosa dovresti vedere nella finestra di importazione:

| File | Formato | Unità proposta | Dimensioni attese | Colore |
|---|---|---|---|---|
| `scatola.obj` + `scatola.mtl` (insieme) | OBJ | centimetri | 2 × 1 × 0,5 m | rosso |
| `scatola-obj.zip` | OBJ+MTL in uno ZIP | centimetri | 2 × 1 × 0,5 m | rosso |
| `scatola-colori.ply` | PLY | centimetri | 2 × 1 × 0,5 m | colori per vertice |
| `scatola.stl` | STL (mm) | millimetri | 2 × 0,5 × 1 m con "Z è l'alto"; togli la spunta: 2 × 1 × 0,5 | grigio |
| `scatola.dae` | Collada | metri (è nel file) | 2 × 1 × 0,5 m | blu |
| `scatola.3mf` | 3MF | millimetri | 2 × 0,5 × 1 m con "Z è l'alto"; togli la spunta: 2 × 1 × 0,5 | verde |
| `cubo.step` | STEP | (nel file) | 0,3 m di lato | arancione |
| `cubo.iges` | IGES | (nel file) | 0,01 m di lato | grigio |
| `assieme-staffa.step` | STEP, 18 parti | (nel file) | circa 5 × 3,8 × 2,2 m | colori per parte |
| `assieme-staffa.brep` | BREP | millimetri | come sopra | grigio |

L'assieme ha parti separate: dopo l'importazione prova il doppio clic su un componente.

FBX: non c'è un file di esempio qui, usane uno tuo (o uno scaricato da un sito di modelli).
I cubi e l'assieme CAD vengono dai file di prova di `occt-import-js` (licenza MIT).
