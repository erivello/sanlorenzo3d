#!/usr/bin/env bash
# Extract frames from a capture video for SfM.
# Usage: pipeline/01_extract_frames.sh <video> <scene>   (env: FPS=2, MAX_SIDE=1920)
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <video> <scene>" >&2
  exit 1
fi

VIDEO="$1"
SCENE="$2"
FPS="${FPS:-2}"
MAX_SIDE="${MAX_SIDE:-1920}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/data/$SCENE/input"

mkdir -p "$OUT"
rm -f "$OUT"/*.jpg

ffmpeg -hide_banner -loglevel error -i "$VIDEO" \
  -vf "fps=$FPS,scale='if(gt(iw,ih),min($MAX_SIDE,iw),-2)':'if(gt(iw,ih),-2,min($MAX_SIDE,ih))'" \
  -qscale:v 2 "$OUT/frame_%05d.jpg"

COUNT=$(find "$OUT" -name '*.jpg' | wc -l | tr -d ' ')
echo "Extracted $COUNT frames → $OUT"
if (( COUNT < 80 )); then
  echo "Warning: few frames; consider a higher FPS or a longer capture." >&2
fi
