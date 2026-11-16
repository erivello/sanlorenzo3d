#!/usr/bin/env bash
# Train a Gaussian splat with Brush (Metal) from the COLMAP dataset.
# Usage: pipeline/03_train.sh <scene> [extra brush args...]   (env: BRUSH=brush)
# Written against Brush 0.3.0 (`brush --help`); extra args are passed through.
# Defaults: 30k steps, snapshot every 5k (export_<step>.ply), images capped at 1920 px.
# We cap splats at 2M (Brush default 10M) to stay near the ~30 MB web budget
# after compression; pass --max-splats N to override.
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

ARGS=("$@")
[[ " $* " == *" --max-splats "* ]] || ARGS+=(--max-splats 2000000)

"$BRUSH" "$DATASET" --export-path "$OUT" "${ARGS[@]}"

echo "Training output in $OUT:"
ls -lh "$OUT"/*.ply 2>/dev/null || echo "(no .ply found — check the Brush flags with '$BRUSH --help')"
