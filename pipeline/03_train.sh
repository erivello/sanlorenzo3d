#!/usr/bin/env bash
# Train a Gaussian splat with Brush (Metal) from the COLMAP dataset.
# Usage: pipeline/03_train.sh <scene> [extra brush args...]   (env: BRUSH=brush)
# Check `brush --help` for the flags of your Brush version; extra args are passed through.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <scene> [extra brush args...]" >&2
  exit 1
fi

SCENE="$1"; shift
BRUSH="${BRUSH:-brush}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATASET="$ROOT/data/$SCENE/colmap"
OUT="$ROOT/data/$SCENE/train"

command -v "$BRUSH" >/dev/null || { echo "Brush not found (set BRUSH=...). See pipeline/README.md" >&2; exit 1; }
[[ -d "$DATASET/sparse/0" ]] || { echo "Missing $DATASET — run 02_sfm.sh first" >&2; exit 1; }
mkdir -p "$OUT"

"$BRUSH" "$DATASET" --export-path "$OUT" "$@"

echo "Training output in $OUT:"
ls -lh "$OUT"/*.ply 2>/dev/null || echo "(no .ply found — check the Brush flags with '$BRUSH --help')"
