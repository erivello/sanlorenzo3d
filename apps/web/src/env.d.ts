/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the church splat (.sog/.spz/.ply). Defaults to Spark's demo splat. */
  readonly VITE_SPLAT_URL?: string;
  /** Google Maps Platform key with Map Tiles API enabled (referrer-restricted). */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}
