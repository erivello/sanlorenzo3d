#!/usr/bin/env bash
# Compress the trained splat for the web (.sog) and place it where the viewer serves it.
# Usage: pipeline/04_compress.sh <scene> [input.ply]   (default: newest .ply in data/<scene>/train)
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <scene> [input.ply]" >&2
  exit 1
fi

SCENE="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INPUT="${2:-$(ls -t "$ROOT/data/$SCENE/train"/*.ply 2>/dev/null | head -1)}"
OUT="$ROOT/apps/web/public/splats/$SCENE.sog"

[[ -f "$INPUT" ]] || { echo "No input .ply found — run 03_train.sh first" >&2; exit 1; }

npx --yes @playcanvas/splat-transform@3 "$INPUT" "$OUT"

echo "$(du -h "$OUT" | cut -f1)  $OUT"
echo "Set in apps/web/.env.local:  VITE_SPLAT_URL=/splats/$SCENE.sog"
