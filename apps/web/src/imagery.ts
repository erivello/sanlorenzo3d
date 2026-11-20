/**
 * Aerial/satellite imagery draped on the terrain, as Web Mercator XYZ tiles.
 *
 * - agea: AGEA 2024 orthophoto, 20 cm, from the Regione Veneto WMS. Licence:
 *   "TUTTI I DIRITTI RISERVATI" (AGEA–CISIS agreement). Free to view through the
 *   regional geoportal; publishing it on a public site needs permission, so it is
 *   enabled only in dev unless VITE_AGEA_PUBLIC=1 (set it once permission exists).
 * - esri: Esri World Imagery through ArcGIS Location Platform (API key in
 *   VITE_ESRI_API_KEY, free tier). Attribution required.
 */
export interface Imagery {
  id: string;
  label: string;
  maxZoom: number;
  url(z: number, x: number, y: number): string;
  attribution: string;
}

const MERC = 20037508.342789244;

function mercatorBBox(z: number, x: number, y: number) {
  const size = (2 * MERC) / 2 ** z;
  const minX = -MERC + x * size;
  const maxY = MERC - y * size;
  return [minX, maxY - size, minX + size, maxY].join(",");
}

const AGEA_WMS = "https://idt2-geoserver.regione.veneto.it/geoserver/wms";

export function availableImagery(env: ImportMetaEnv): Imagery[] {
  const list: Imagery[] = [];
  const esriKey = env.VITE_ESRI_API_KEY;
  if (esriKey) {
    list.push({
      id: "esri",
      label: "Satellite (Esri)",
      maxZoom: 19,
      url: (z, x, y) =>
        `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?token=${encodeURIComponent(esriKey)}`,
      attribution: "Powered by Esri · Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    });
  }
  if (env.DEV || env.VITE_AGEA_PUBLIC === "1") {
    list.push({
      id: "agea",
      label: "Ortofoto AGEA 2024",
      maxZoom: 19,
      url: (z, x, y) =>
        `${AGEA_WMS}?service=WMS&version=1.1.1&request=GetMap&layers=rv:ortofoto_agea_2024&styles=` +
        `&srs=EPSG:3857&bbox=${mercatorBBox(z, x, y)}&width=256&height=256&format=image/jpeg`,
      attribution: "ORTOFOTO 20 cm [2024] AGEA – TUTTI I DIRITTI RISERVATI · Regione del Veneto",
    });
  }
  return list;
}
