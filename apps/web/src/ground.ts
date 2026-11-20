import type { Material, Object3D, Vector3 } from "three";

/**
 * The village surface the exterior view stands on: our own open terrain
 * (terrain.ts) or Google Photorealistic 3D Tiles (exterior.ts).
 * Scene frame for both: metres, +x west, +z north, +y up, site at the origin.
 */
export interface Ground {
  /** Root object holding the surface meshes. */
  readonly object: Object3D;
  /** True once geo conversions and groundAt work. */
  readonly ready: boolean;
  visible: boolean;
  /** WGS84 degrees → scene position (y = 0; use groundAt for the terrain height). */
  toScene(lat: number, lng: number, target?: Vector3): Vector3;
  /** Scene position → WGS84 degrees. */
  toLatLng(p: Vector3): { lat: number; lng: number };
  /** Terrain height under (x, z), if known. */
  groundAt(x: number, z: number): number | undefined;
  /** Called when more of the surface becomes available (heights may change). */
  onChange(cb: () => void): void;
  /** Called for every surface material, existing and future (shader patches). */
  onMaterial(cb: (m: Material) => void): void;
  /** Data credits that must stay visible while the surface is shown. */
  renderAttributions(el: HTMLElement): void;
}
