# Contenuti della guida

Un file per punto di interesse in `pois/`, nome = `id`. Frontmatter YAML + testo markdown (paragrafi, `**grassetto**`, `*corsivo*`).

```yaml
---
id: altare-maggiore          # univoco, kebab-case
title: Altare maggiore
order: 1                     # ordine nel percorso guidato
status: da-verificare        # bozza | da-verificare | verificato
anchor: [0, 0.2, 0]          # dove appare il numero nella scena (Shift+click nel viewer)
camera:                      # inquadratura quando si seleziona (tasto P nel viewer)
  position: [0, 0.4, 1.2]
  target: [0, 0.2, 0]
sources:                     # obbligatorie per ogni fatto storico/artistico
  - title: "Autore, Titolo, editore, anno, p. 42"
  - title: "Sito della Diocesi di Vittorio Veneto"
    url: https://…
  - title: "Don …, parroco"
    note: "conversazione del 2026-11-20"
todo:                        # domande aperte da fare alla parrocchia
  - Chi è l'autore della pala?
---
Testo della scheda (60–150 parole).
```

Regole: vedi `AGENTS.md` → "Contenuti". Senza fonti → `status: da-verificare` e testo esplicitamente provvisorio.

> Le coordinate dei POI di esempio sono riferite allo splat demo di Spark e vanno rifatte sulla scansione reale.
