# Pipeline di acquisizione → splat (Mac M2)

```
captures/<video>.mp4
  └─ 01_extract_frames.sh → data/<scena>/input/*.jpg
  └─ 02_sfm.sh            → data/<scena>/colmap/{images,sparse/0}   (COLMAP)
  └─ 03_train.sh          → data/<scena>/train/*.ply                 (Brush)
  └─ 04_compress.sh       → apps/web/public/splats/<scena>.sog       (splat-transform)
```

## Setup una tantum

```bash
brew install ffmpeg colmap
```

**Brush** (training Gaussian Splatting in Metal): scarica la release macOS da
https://github.com/ArthurBrussee/brush/releases e metti l'eseguibile nel PATH come `brush`
(oppure imposta `BRUSH=/percorso/brush`). Verifica i flag con `brush --help`: lo script
`03_train.sh` passa gli argomenti extra così come sono.

La compressione usa `npx @playcanvas/splat-transform` (nessuna installazione).

Pulizia manuale dei "floaters" (opzionale ma consigliata): https://superspl.at/editor
— apri il `.ply` di training, elimina il rumore, esporta `.ply` e rilancia `04_compress.sh`.

## Come riprendere (Redmi Note 12 Pro)

- Video **4K 30fps**, modalità Pro: **esposizione, ISO, messa a fuoco e bilanciamento del bianco bloccati**.
- Cammina lentamente (≈ 1 passo ogni 2 s), niente rotazioni rapide sul posto.
- 3 giri a quote diverse (bassa, petto, braccia alzate); camera verso il centro, poi un giro verso le pareti.
- Dettagli (altare, pale, affreschi): passate ravvicinate dedicate, ad arco, sovrapposte con il giro generale.
- Evita controluce delle finestre; meglio giornata nuvolosa. Chiesa vuota, niente persone in movimento.
- Prima prova consigliata: **solo un altare laterale o la facciata**, 1–2 minuti di video.

## Esecuzione

```bash
pipeline/01_extract_frames.sh captures/altare.mp4 altare      # FPS=2 di default
pipeline/02_sfm.sh altare                                     # MAPPER=global per il mapper globale (più veloce)
pipeline/03_train.sh altare                                   # lungo: lancialo e vai a prendere un caffè
pipeline/04_compress.sh altare
echo "VITE_SPLAT_URL=/splats/altare.sog" > apps/web/.env.local
npm run dev
```

Controlli di qualità dopo `02_sfm.sh`: lo script stampa immagini registrate / estratte.
Sotto ~80% registrate → probabilmente il problema è il video (mosso, esposizione variabile, poca sovrapposizione).
