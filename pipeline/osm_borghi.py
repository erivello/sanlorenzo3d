#!/usr/bin/env python3
"""
Names of the borghi inside the village boundary → content/borghi.geojson.

Source: OpenStreetMap place nodes (hamlet, isolated_dwelling, locality,
neighbourhood…), licence ODbL. Only places inside content/boundary.geojson are
kept; the main village name is skipped (it already has its own label).

Usage (needs: pip install shapely):
    python3 pipeline/osm_borghi.py > content/borghi.geojson
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


def overpass(query: str) -> dict:
    data = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(4):
        for url in OVERPASS:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "sanlorenzo3d"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return json.load(r)
            except Exception as e:  # busy servers answer with HTML/5xx
                print(f"overpass {url}: {e}", file=sys.stderr)
        time.sleep(10 * (attempt + 1))
    sys.exit("Overpass unavailable, retry later")


def main() -> None:
    boundary = json.loads((ROOT / "content/boundary.geojson").read_text())
    area = unary_union([shape(f["geometry"]) for f in boundary["features"]])
    main_names = {f["properties"]["name"] for f in boundary["features"]}
    west, south, east, north = area.bounds

    result = overpass(f"[out:json][timeout:50];nwr[place][name]({south},{west},{north},{east});out tags center;")
    features = []
    for e in result["elements"]:
        lat = e.get("lat", e.get("center", {}).get("lat"))
        lon = e.get("lon", e.get("center", {}).get("lon"))
        name = e["tags"]["name"]
        if name in main_names or not area.contains(Point(lon, lat)):
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "name": name,
                "place": e["tags"]["place"],
                "osm": f"{e['type']}/{e['id']}",
                "source": "© OpenStreetMap contributors – ODbL",
            },
            "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
        })
    features.sort(key=lambda f: f["properties"]["name"])
    json.dump({"type": "FeatureCollection", "features": features}, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
