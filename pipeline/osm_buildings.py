#!/usr/bin/env python3
"""
Building footprints inside the village boundary → content/buildings.geojson.

Source: OpenStreetMap ways tagged building=* (licence ODbL). Used by the viewer
to snap house names to a building and outline it. Buildings within 30 m of
content/boundary.geojson are kept.

Usage (needs: pip install shapely):
    python3 pipeline/osm_buildings.py > content/buildings.geojson
"""
import json
import sys
from pathlib import Path

from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

from osm_borghi import overpass  # same folder: shared Overpass client with retries

ROOT = Path(__file__).resolve().parent.parent
MARGIN_DEG = 30 / 111_000  # ~30 m


def main() -> None:
    boundary = json.loads((ROOT / "content/boundary.geojson").read_text())
    area = unary_union([shape(f["geometry"]) for f in boundary["features"]]).buffer(MARGIN_DEG)
    west, south, east, north = area.bounds

    result = overpass(f"[out:json][timeout:60];way[building]({south},{west},{north},{east});out geom tags;")
    features = []
    for e in result["elements"]:
        ring = [(round(g["lon"], 7), round(g["lat"], 7)) for g in e.get("geometry", [])]
        if len(ring) < 4 or not area.intersects(Polygon(ring)):
            continue
        tags = e.get("tags", {})
        props = {"osm": f"way/{e['id']}", "building": tags.get("building")}
        if "name" in tags:
            props["name"] = tags["name"]
        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
    features.sort(key=lambda f: f["properties"]["osm"])
    json.dump(
        {"type": "FeatureCollection", "source": "© OpenStreetMap contributors – ODbL", "features": features},
        sys.stdout,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    sys.stdout.write("\n")
    print(f"{len(features)} buildings", file=sys.stderr)


if __name__ == "__main__":
    main()
