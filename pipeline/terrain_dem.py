#!/usr/bin/env python3
"""
Terrain heights around the village → apps/web/public/terrain/dem.{bin,json}.

Source: TINITALY 1.1 (INGV), 10 m DEM of Italy, UTM 32N, licence CC BY 4.0.
  Tarquini S., Isola I., Favalli M., Battistini A., Dotta G. (2023). TINITALY,
  a digital elevation model of Italy with a 10 meters cell size (Version 1.1).
  INGV. https://doi.org/10.13127/tinitaly/1.1
Tiles: https://tinitaly.pi.ingv.it/Download_Area1_1.html — San Lorenzo needs
w50570, w50575, w51070, w51075 (≈ 87 MB each). Keep them in data/terrain/src/.

The DEM is resampled (bilinear) onto a regular lat/lon grid centred on the site
(content/site.yaml). Output:
  dem.bin  — Uint16 little-endian, rows south→north, columns west→east,
             height = base + value * scale (metres above sea level)
  dem.json — grid bounds/size, base, scale, sources

Usage (needs: pip install rasterio numpy pyyaml):
    python3 pipeline/terrain_dem.py data/terrain/src/*/*.tif
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
import rasterio
import yaml
from rasterio.merge import merge
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps/web/public/terrain"
SCALE = 0.1  # decimetres


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("tiles", nargs="+")
    ap.add_argument("--half-size-m", type=float, default=5000)
    ap.add_argument("--step-m", type=float, default=10)
    args = ap.parse_args()

    site = yaml.safe_load((ROOT / "content/site.yaml").read_text())
    lat0, lon0 = site["lat"], site["lon"]
    # Degrees per metre at the site (WGS84 meridional / prime-vertical radii).
    a, e2 = 6378137.0, 6.69437999014e-3
    s = math.sin(math.radians(lat0))
    m_lat = a * (1 - e2) / (1 - e2 * s * s) ** 1.5 * math.pi / 180
    m_lon = a / math.sqrt(1 - e2 * s * s) * math.cos(math.radians(lat0)) * math.pi / 180
    dlat, dlon = args.half_size_m / m_lat, args.half_size_m / m_lon
    south, north, west, east = lat0 - dlat, lat0 + dlat, lon0 - dlon, lon0 + dlon
    rows = int(round(2 * args.half_size_m / args.step_m)) + 1
    cols = rows

    sources = [rasterio.open(t) for t in args.tiles]
    mosaic, transform = merge(sources, nodata=-9999.0)
    grid = np.full((rows, cols), np.nan, dtype=np.float32)
    # Pixel-is-point grid: node (r, c) sits exactly on the bounds edges.
    half_lat, half_lon = (north - south) / (rows - 1) / 2, (east - west) / (cols - 1) / 2
    dst_transform = from_bounds(west - half_lon, south - half_lat, east + half_lon, north + half_lat, cols, rows)
    reproject(
        mosaic[0], grid,
        src_transform=transform, src_crs=sources[0].crs, src_nodata=-9999.0,
        dst_transform=dst_transform, dst_crs="EPSG:4326", dst_nodata=np.nan,
        resampling=Resampling.bilinear,
    )
    if np.isnan(grid).any():
        raise SystemExit(f"{int(np.isnan(grid).sum())} cells without data: add the missing TINITALY tiles")

    grid = grid[::-1]  # rasterio rows go north→south; we store south→north
    base = math.floor(float(grid.min()))
    values = np.round((grid - base) / SCALE).astype("<u2")
    centre = float(grid[rows // 2, cols // 2])

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "dem.bin").write_bytes(values.tobytes())
    meta = {
        "south": south, "north": north, "west": west, "east": east,
        "rows": rows, "cols": cols, "base": base, "scale": SCALE,
        "height_at_site_m": round(centre, 2),
        "source": "TINITALY 1.1, INGV (Tarquini et al. 2023), https://doi.org/10.13127/tinitaly/1.1",
        "license": "CC BY 4.0",
        "changes": f"ricampionato su griglia lat/lon di {args.step_m:g} m attorno al sito, quote al decimetro",
    }
    (OUT / "dem.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"{rows}×{cols} grid, {grid.min():.0f}–{grid.max():.0f} m, site {centre:.1f} m → {OUT}")


if __name__ == "__main__":
    main()
