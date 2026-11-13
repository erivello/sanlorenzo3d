# San Lorenzo 3D

Guida 3D interattiva della chiesa di **San Lorenzo di Montagna** (frazione di Vittorio Veneto, TV).
Progetto sperimentale: Gaussian Splatting dell'interno + punti di interesse descritti + (in futuro)
volo sul paese con Google Photorealistic 3D Tiles e guida AI basata solo su contenuti verificati.

Lingua: **UI e contenuti in italiano**, codice/commenti/commit in inglese.

## Architettura

```
captures/  (git-ignored)   video/foto grezze dal telefono (Redmi Note 12 Pro)
data/      (git-ignored)   workspace pipeline: frames, COLMAP, output training
pipeline/                  script shell Mac (M2): video → frames → SfM → splat → compressione
content/pois/*.md          schede punti di interesse (frontmatter YAML + testo markdown)
content/site.yaml          geolocalizzazione della chiesa (lat/lon/quota) e copertura Google 3D Tiles
content/boundary.geojson   confine del paese: località ISTAT 2021 (CC BY 4.0) + vie che le collegano (OSM, ODbL), un'unica area, da pipeline/istat_boundary.py
apps/web/                  viewer: Vite + TypeScript + three.js + Spark (@sparkjsdev/spark)
apps/web/public/splats/    splat compressi serviti in dev (git-ignored, tranne .gitkeep)
.claude/agents/            subagent specializzati (vedi sotto)
```

Un solo motore 3D: **three.js**. Gli splat sono renderizzati con Spark (`SparkRenderer` + `SplatMesh`).
Il paese usa Google Photorealistic 3D Tiles via `3d-tiles-renderer` nella stessa scena (no Cesium).

Due modalità (`src/modes.ts`, `body[data-mode]`):
- **exterior**: tiles Google visibili, splat nascosto, unità = metri, assi **+x ovest, +z nord**, +y su;
  per posizionare dati geografici usare `tiles.ellipsoid` + `tiles.group.matrixWorld`, mai assi scritti a mano;
  sito nell'origine
  (`ReorientationPlugin` su `content/site.yaml`, quota ellissoidica = s.l.m. + ~47 m di geoide).
  Si arriva con un volo dall'alto; "Entra in chiesa" vola alla porta e dissolve nell'interno.
- **interior**: splat + POI. Unità della ricostruzione.
Senza `VITE_GOOGLE_MAPS_API_KEY`, o se il tileset radice fallisce (chiave/fatturazione),
la modalità exterior viene disattivata e il viewer resta sull'interno con un avviso.
Attribuzioni Google (logo + copyright) sempre visibili in exterior: obbligo dei termini d'uso.

**Confine del paese** (`src/boundary.ts`): contorno dorato appoggiato al terreno, esterno scurito
(maschera campionata nello shader delle tiles, agganciata su `load-model` concatenando `onBeforeCompile`),
etichetta col nome. Solo in exterior e fuori da Street View. Citare sempre ISTAT e OSM + licenze nel pannello.

**Street View** (`src/streetview.ts`, richiede *Maps JavaScript API* abilitata sulla stessa chiave):
copertura scoperta a runtime percorrendo i link tra panorami a partire da quello ufficiale Google più
vicino alla chiesa (esclude le foto sferiche degli utenti, che non sono collegate), disegnata come linee
blu sul terreno. Clic vicino a una linea → panorama ufficiale Google nella direzione della camera;
"Vista dall'alto" riporta il 3D sopra il punto raggiunto. Le immagini si mostrano solo nel viewer
Google (termini d'uso): mai leggerle o salvarle; niente cache oltre la sessione.
Nota: a San Lorenzo la Map Tiles API fornisce solo terreno + satellite (edifici piatti), anche se
Google Earth web mostra il 3D completo. Vedi `content/site.yaml`.

Debug: in dev `window.__sl3d = { world, tiles, modes }`. Il rendering usa `requestAnimationFrame`
(anche la coda download delle tiles): in un browser/pannello nascosto si ferma tutto.

## Comandi

```bash
npm install            # dalla root (npm workspaces)
npm run dev            # viewer su http://localhost:5173
npm run build          # typecheck + build produzione
npm run typecheck
```

Pipeline (vedi `pipeline/README.md`):
```bash
pipeline/01_extract_frames.sh captures/<nome>.mp4 <scena>
pipeline/02_sfm.sh <scena>
pipeline/03_train.sh <scena>
pipeline/04_compress.sh <scena>
```

## Convenzioni 3D

- three.js Y-up, unità = unità della ricostruzione (non metri finché non si scala la scena).
- Gli splat da COLMAP/Brush arrivano capovolti: il viewer applica `quaternion.set(1, 0, 0, 0)` allo `SplatMesh`.
  Le coordinate dei POI sono **nello spazio della scena dopo questa rotazione**.
- Per ricavare coordinate: nel viewer `Shift+click` sullo splat stampa il punto colpito,
  il tasto `P` stampa la posa camera corrente (copiabile nel frontmatter del POI).
- Lo splat da caricare è configurato con `VITE_SPLAT_URL` (`apps/web/.env.local`); default = splat demo di Spark.

## Contenuti (regola ferrea)

Ogni affermazione storica/artistica in `content/pois/` **deve avere una fonte** nel campo `sources`
(libro con pagina, sito della diocesi, archivio parrocchiale, parroco con data).
Ciò che non ha fonte va marcato `status: da-verificare` e il testo deve dirlo esplicitamente.
**Mai inventare** date, autori, attribuzioni o aneddoti — nemmeno "plausibili".
Il futuro chatbot risponderà solo a partire da questi file.

Schema frontmatter: vedi `content/README.md`.

## Asset

- Mai committare video, frame, `.ply`, `.spz`, `.sog` o output della pipeline (già in `.gitignore`).
- Splat di produzione: bucket esterno (es. Cloudflare R2), referenziato via URL.
- Target web: splat interno ≤ ~30 MB compresso, deve girare su mobile.

## Subagent (`.claude/agents/`)

| agent | quando usarlo |
|---|---|
| `capture-pipeline` | elaborare acquisizioni, problemi COLMAP/training, qualità ricostruzione |
| `scene-engineer` | codice three.js/Spark/3D tiles, camera, performance, UX di navigazione |
| `content-curator` | scrivere/rivedere schede POI con fonti; non inventa nulla |
| `visual-qa` | verificare il viewer nel browser (desktop + mobile), screenshot, console |

## Definizione di "fatto"

- `npm run build` passa senza errori.
- Modifiche al viewer verificate nel browser (console senza errori, scena visibile).
- Nuovi POI: frontmatter valido, `sources` compilato o `status: da-verificare`.
