#!/usr/bin/env python3
"""
Village boundary → content/boundary.geojson.

1. ISTAT localities, from "Basi territoriali 2021", Veneto census sections
   (R05_21.zip, licence CC BY 4.0). Each census section carries its locality
   (LOC21_ID), so dissolving the sections of a locality gives its perimeter.
2. Streets that belong to the village but sit in ISTAT's huge "case sparse"
   sections: a corridor around the street and the buildings facing it, from
   OpenStreetMap data (ODbL).
Everything is merged; each connected area becomes one Feature, named after its
main locality (label at `point`), with the other localities inside it listed as
`places` (more labels).

Usage (needs: pip install pyshp shapely pyproj):
    curl -O https://www.istat.it/storage/cartografia/basi_territoriali/2021/R05_21.zip
    unzip R05_21.zip -d R05_21
    python3 pipeline/istat_boundary.py R05_21/SHP/R05_21_WGS84 \
        --street "via-monte-altare.geojson=via del Monte Altare" \
        --street "verso-castagne.geojson=via San Lorenzo e via Castagnè" \
        --buildings buildings.geojson > content/boundary.geojson

--street FILE=NAME: GeoJSON LineStrings of a street stretch (OSM ways), repeatable:
    via del Monte Altare: ways 144700886, 255783218
    San Lorenzo → Castagnè: ways 1266742988, 144700865 (via San Lorenzo), 110375957 (via Castagnè)
--buildings: GeoJSON building footprints around them (OSM).
"""
import argparse
import json
import sys

import shapefile
from pyproj import Transformer
from shapely import transform as shp_transform
from shapely.geometry import MultiPolygon, mapping, shape
from shapely.ops import unary_union

ISTAT = "ISTAT, Basi territoriali 2021 (sezioni di censimento del Veneto, R05_21) – CC BY 4.0"
ISTAT_URL = "https://www.istat.it/notizia/basi-territoriali-e-variabili-censuarie/"
OSM = "OpenStreetMap contributors (strade ed edifici) – ODbL"
RESIDENT = "vie considerate parte del paese: indicazione di un residente (2026-11-13)"

# Vittorio Veneto (PRO_COM 26092) localities that make up San Lorenzo, main first.
# Not included: Con Alti (2609226611), not considered part of San Lorenzo.
LOCALITIES = [
    (2609210007, "San Lorenzo"),
    (2609226609, "Castagnè"),
]

STREET_BUFFER_M = 20
BUILDING_NEAR_M = 40
BUILDING_BUFFER_M = 12
CLOSING_M = 15  # fills small gaps between street and house buffers
SIMPLIFY_M = 0.5

to_utm = Transformer.from_crs(4326, 32632, always_xy=True)
to_wgs84 = Transformer.from_crs(32632, 4326, always_xy=True)


def reproject(geom, transformer):
    return shp_transform(geom, lambda xy: list(zip(*transformer.transform(xy[:, 0], xy[:, 1]))))


def load_geojson(path):
    with open(path) as f:
        data = json.load(f)
    feats = data["features"] if data.get("type") == "FeatureCollection" else [data]
    return [reproject(shape(f["geometry"]), to_utm) for f in feats]


def rounded(geom):
    return json.loads(json.dumps(mapping(reproject(geom, to_wgs84))), parse_float=lambda f: round(float(f), 7))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("shp")
    ap.add_argument("--street", action="append", default=[], metavar="FILE=NAME")
    ap.add_argument("--buildings", help="GeoJSON of building footprints (OSM)")
    args = ap.parse_args()

    reader = shapefile.Reader(args.shp)  # UTM 32N (EPSG:32632)
    parts = {loc_id: [] for loc_id, _ in LOCALITIES}
    for sr in reader.iterShapeRecords():
        if sr.record["LOC21_ID"] in parts:
            parts[sr.record["LOC21_ID"]].append(shape(sr.shape.__geo_interface__))
    localities = {loc_id: unary_union(p) for loc_id, p in parts.items() if p}
    for loc_id, name in LOCALITIES:
        if loc_id not in localities:
            print(f"warning: {name} (LOC21_ID {loc_id}) not found", file=sys.stderr)

    houses = load_geojson(args.buildings) if args.buildings else []
    corridors, notes = [], []
    for spec in args.street:
        path, _, name = spec.partition("=")
        street = unary_union(load_geojson(path))
        near = [b.buffer(BUILDING_BUFFER_M) for b in houses if b.distance(street) < BUILDING_NEAR_M]
        corridors.append(unary_union([street.buffer(STREET_BUFFER_M), *near]).buffer(CLOSING_M).buffer(-CLOSING_M))
        notes.append(f"{name or path}: corridoio di {STREET_BUFFER_M} m attorno alla strada e alle {len(near)} case vicine")

    merged = unary_union([*localities.values(), *corridors]).simplify(SIMPLIFY_M)
    areas = list(merged.geoms) if isinstance(merged, MultiPolygon) else [merged]

    features = []
    for area in areas:
        inside = [(loc_id, name) for loc_id, name in LOCALITIES if loc_id in localities and area.intersects(localities[loc_id])]
        if not inside:
            continue  # a corridor not touching any locality
        (main_id, main_name), others = inside[0], inside[1:]
        sources = [f"{ISTAT} – {ISTAT_URL}"]
        street_notes = [n for n, c in zip(notes, corridors) if area.intersects(c)]
        if street_notes:
            sources += [OSM, RESIDENT]
        features.append({
            "type": "Feature",
            "properties": {
                "name": main_name,
                "main": main_id == LOCALITIES[0][0],
                "point": rounded(localities[main_id].representative_point())["coordinates"],
                "istat_loc21_ids": [loc_id for loc_id, _ in inside],
                "places": [
                    {"name": name, "point": rounded(localities[loc_id].representative_point())["coordinates"]}
                    for loc_id, name in others
                ],
                "sources": sources,
                "changes": "; ".join(
                    ["località ISTAT: sezioni di censimento unite", *street_notes, f"semplificato ({SIMPLIFY_M} m)"]
                ),
            },
            "geometry": rounded(area),
        })
    json.dump({"type": "FeatureCollection", "features": features}, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
