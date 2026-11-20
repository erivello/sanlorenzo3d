import { MathUtils, Vector3 } from "three";

/**
 * Local tangent frame (East-North-Up on the WGS84 ellipsoid) around a site,
 * mapped to the scene convention: metres, +x WEST, +z NORTH, +y up.
 * Horizontal positions are exact ENU of the point on the ellipsoid; heights are
 * taken from the terrain (metres above sea level minus the site elevation), so
 * the few metres of earth curvature over the area are ignored on purpose.
 */
const A = 6378137.0;
const E2 = 6.69437999014e-3;

function ecef(lat: number, lon: number) {
  const s = Math.sin(lat);
  const n = A / Math.sqrt(1 - E2 * s * s);
  return [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon), n * (1 - E2) * s];
}

export class LocalFrame {
  private o: number[];
  private sinLat: number;
  private cosLat: number;
  private sinLon: number;
  private cosLon: number;
  private mLat: number; // metres per radian of latitude at the site
  private mLon: number; // metres per radian of longitude at the site

  constructor(
    readonly lat0: number,
    readonly lon0: number,
  ) {
    const lat = lat0 * MathUtils.DEG2RAD;
    const lon = lon0 * MathUtils.DEG2RAD;
    this.o = ecef(lat, lon);
    this.sinLat = Math.sin(lat);
    this.cosLat = Math.cos(lat);
    this.sinLon = Math.sin(lon);
    this.cosLon = Math.cos(lon);
    const w = 1 - E2 * this.sinLat * this.sinLat;
    this.mLat = (A * (1 - E2)) / Math.pow(w, 1.5);
    this.mLon = (A / Math.sqrt(w)) * this.cosLat;
  }

  /** East/north metres of a lat/lon (degrees). */
  en(lat: number, lon: number): [number, number] {
    const p = ecef(lat * MathUtils.DEG2RAD, lon * MathUtils.DEG2RAD);
    const dx = p[0] - this.o[0];
    const dy = p[1] - this.o[1];
    const dz = p[2] - this.o[2];
    const e = -this.sinLon * dx + this.cosLon * dy;
    const n = -this.sinLat * this.cosLon * dx - this.sinLat * this.sinLon * dy + this.cosLat * dz;
    return [e, n];
  }

  toScene(lat: number, lon: number, target = new Vector3()) {
    const [e, n] = this.en(lat, lon);
    return target.set(-e, 0, n);
  }

  /** Inverse of toScene (fixed-point refinement, sub-millimetre in a few steps). */
  toLatLng(p: Vector3) {
    const e = -p.x;
    const n = p.z;
    let lat = this.lat0 + (n / this.mLat) * MathUtils.RAD2DEG;
    let lon = this.lon0 + (e / this.mLon) * MathUtils.RAD2DEG;
    for (let i = 0; i < 4; i++) {
      const [ge, gn] = this.en(lat, lon);
      lat += ((n - gn) / this.mLat) * MathUtils.RAD2DEG;
      lon += ((e - ge) / this.mLon) * MathUtils.RAD2DEG;
    }
    return { lat, lng: lon };
  }
}

/** Web Mercator tile helpers (XYZ scheme). */
export const tile2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
export const tile2lat = (y: number, z: number) =>
  MathUtils.RAD2DEG * Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z)));
export const lon2tile = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const lat2tile = (lat: number, z: number) => {
  const r = lat * MathUtils.DEG2RAD;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
