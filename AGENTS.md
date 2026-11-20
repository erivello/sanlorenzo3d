# San Lorenzo 3D

Guida 3D interattiva della chiesa di **San Lorenzo di Montagna** (frazione di Vittorio Veneto, TV).
Progetto sperimentale: Gaussian Splatting dell'interno + punti di interesse descritti + (in futuro)
volo sul paese (terreno aperto + ortofoto/satellite) e guida AI basata solo su contenuti verificati.

Lingua: **UI e contenuti in italiano**, codice/commenti/commit in inglese.

## Architettura

```
captures/  (git-ignored)   video/foto grezze dal telefono (Redmi Note 12 Pro)
data/      (git-ignored)   workspace pipeline: frames, COLMAP, output training
pipeline/                  script shell Mac (M2): video → frames → SfM → splat → compressione
content/pois/*.md          schede punti di interesse (frontmatter YAML + testo markdown)
content/site.yaml          geolocalizzazione della chiesa (lat/lon/quota) e copertura Google 3D Tiles
content/boundary.geojson   confine del paese: località ISTAT 2021 (CC BY 4.0) + vie che le collegano (OSM, ODbL), un'unica area, da pipeline/istat_boundary.py
content/borghi.geojson     nomi dei borghi dentro il confine (OSM, ODbL), da pipeline/osm_borghi.py
content/buildings.geojson  impronte degli edifici dentro il confine (OSM, ODbL), da pipeline/osm_buildings.py
content/local/  (git-ignored) dati privati: case.geojson = nomi delle case (mai nel repo pubblico)
apps/web/                  viewer: Vite + TypeScript + three.js + Spark (@sparkjsdev/spark)
apps/web/public/splats/    splat compressi serviti in dev (git-ignored, tranne .gitkeep)
apps/web/public/terrain/   quote TINITALY attorno al paese (dem.bin/json, da pipeline/terrain_dem.py)
.claude/agents/            subagent specializzati (vedi sotto)
```

Un solo motore 3D: **three.js**. Gli splat sono renderizzati con Spark (`SparkRenderer` + `SplatMesh`).
Il paese è una superficie `Ground` (`src/ground.ts`) nella stessa scena:
- **default: terreno aperto** (`src/terrain.ts`): quote TINITALY 10 m (INGV, CC BY 4.0) + immagini a tile
  XYZ con livelli di dettaglio (quadtree Web Mercator, bordi a "gonna" contro le fessure). Immagini
  (`src/imagery.ts`): **AGEA 2024** 20 cm dal WMS della Regione Veneto — *tutti i diritti riservati*:
  solo in dev finché non c'è il permesso (`VITE_AGEA_PUBLIC=1`) — e **Esri World Imagery**
  (`VITE_ESRI_API_KEY`, ArcGIS Location Platform). Con più sorgenti compare un menu nel pannello.
- **opzionale: Google Photorealistic 3D Tiles** (`src/exterior.ts`, `VITE_TERRAIN=google`): dal 8/7/2025
  Google le rifiuta (403) ai progetti con fatturazione nello SEE, quindi non sono più il default.

Due modalità (`src/modes.ts`, `body[data-mode]`):
- **exterior**: terreno visibile, splat e `SparkRenderer` nascosti (se attivo altera i binding delle
  texture e il terreno diventa nero), cielo + foschia; unità = metri, assi **+x ovest, +z nord**, +y su,
  sito nell'origine, y = quota s.l.m. − `site.elevation_m`. Per posizionare dati geografici usare
  `ground.toScene/toLatLng/groundAt` (`src/geo.ts`, ENU esatto su WGS84), mai assi scritti a mano.
  Si arriva con un volo dall'alto; "Entra in chiesa" vola alla porta e dissolve nell'interno.
- **interior**: splat + POI. Unità della ricostruzione.
Se il terreno non si carica (o non c'è nessuna sorgente di immagini), la modalità exterior viene
disattivata e il viewer resta sull'interno con un avviso.
Attribuzioni delle immagini e del terreno sempre visibili in exterior.

**Confine del paese** (`src/boundary.ts`): contorno dorato appoggiato al terreno, esterno scurito
(maschera campionata nello shader della superficie, agganciata con `ground.onMaterial` concatenando `onBeforeCompile`),
etichetta col nome, nomi dei borghi sospesi in alto con un filo fino al terreno. Solo in exterior e fuori da Street View. Citare sempre ISTAT e OSM + licenze nel pannello.
Modifica a mano (solo dev, `src/boundaryEditor.ts`): "Modifica confine" nel pannello → trascina i punti,
clic su un lato per aggiungerne uno, Alt+clic su un punto per toglierlo, ⌘Z annulla; "Salva" scrive
`content/boundary.geojson` via `/__sl3d/boundary` (plugin in `vite.config.ts`, file escluso dal watcher)
e aggiunge alle `sources` la nota del ritocco con la data. **Rilanciare `pipeline/istat_boundary.py`
rigenera il file e cancella i ritocchi a mano.** La maschera di scurimento si aggiorna al salvataggio.

**Nomi delle case** (`src/houses.ts`): etichette sopra i tetti con nota facoltativa (clic sul nome),
contorno dell'edificio OSM agganciato, visibili sotto ~600 m dalla camera, interruttore nel pannello.
Dati in `content/local/case.geojson` (git-ignored: il repo è pubblico). Solo in dev si modificano:
Alt+clic su una casa (aggancio all'edificio OSM entro 15 m) o su un'etichetta; il plugin Vite in
`vite.config.ts` salva il file via `/__sl3d/houses`. In produzione i nomi compaiono solo con
`VITE_HOUSE_NAMES=1` e il file copiato in `apps/web/public/local/` — decisione da prendere apposta.

**Street View** (`src/streetview.ts`, richiede `VITE_GOOGLE_MAPS_API_KEY` con *Maps JavaScript API*; consentito anche nello SEE):
copertura scoperta a runtime percorrendo i link tra panorami a partire da quello ufficiale Google più
vicino alla chiesa (esclude le foto sferiche degli utenti, che non sono collegate), disegnata come linee
blu sul terreno. Clic vicino a una linea → panorama ufficiale Google nella direzione della camera;
"Vista dall'alto" riporta il 3D sopra il punto raggiunto. Le immagini si mostrano solo nel viewer
Google (termini d'uso): mai leggerle o salvarle; niente cache oltre la sessione.
Nota: anche quando funzionava, a San Lorenzo la Map Tiles API forniva solo terreno + satellite
(edifici piatti), come il terreno aperto. Vedi `content/site.yaml`.

Debug: in dev `window.__sl3d = { world, tiles, terrain, modes, street, boundary, boundaryEditor, houses }`. Il rendering usa `requestAnimationFrame`
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
