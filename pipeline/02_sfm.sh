#!/usr/bin/env bash
# Structure-from-motion with COLMAP: camera poses + sparse cloud, undistorted for training.
# Usage: pipeline/02_sfm.sh <scene>   (env: MAPPER=incremental|global)
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <scene>" >&2
  exit 1
fi

SCENE="$1"
MAPPER="${MAPPER:-incremental}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/data/$SCENE"
INPUT="$DIR/input"
WORK="$DIR/sfm"
OUT="$DIR/colmap"

[[ -d "$INPUT" ]] || { echo "Missing $INPUT — run 01_extract_frames.sh first" >&2; exit 1; }
rm -rf "$WORK" "$OUT"
mkdir -p "$WORK/sparse"

echo "[1/4] Feature extraction"
colmap feature_extractor \
  --database_path "$WORK/database.db" \
  --image_path "$INPUT" \
  --ImageReader.single_camera 1 \
  --ImageReader.camera_model OPENCV

echo "[2/4] Sequential matching (video) with loop detection"
colmap sequential_matcher \
  --database_path "$WORK/database.db" \
  --SequentialMatching.overlap 15

echo "[3/4] Mapping ($MAPPER)"
if [[ "$MAPPER" == "global" ]]; then
  colmap global_mapper \
    --database_path "$WORK/database.db" \
    --image_path "$INPUT" \
    --output_path "$WORK/sparse"
else
  colmap mapper \
    --database_path "$WORK/database.db" \
    --image_path "$INPUT" \
    --output_path "$WORK/sparse"
fi

# Pick the largest reconstructed model.
BEST=$(for m in "$WORK"/sparse/*/; do
  n=$(colmap model_analyzer --path "$m" 2>&1 | awk '/Registered images/ {print $NF}')
  echo "${n:-0} $m"
done | sort -rn | head -1 | cut -d' ' -f2)

echo "[4/4] Undistort → $OUT"
colmap image_undistorter \
  --image_path "$INPUT" \
  --input_path "$BEST" \
  --output_path "$OUT" \
  --output_type COLMAP
mkdir -p "$OUT/sparse/0"
find "$OUT/sparse" -maxdepth 1 -type f -exec mv {} "$OUT/sparse/0/" \;

TOTAL=$(find "$INPUT" -name '*.jpg' | wc -l | tr -d ' ')
REG=$(colmap model_analyzer --path "$OUT/sparse/0" 2>&1 | awk '/Registered images/ {print $NF}')
echo "Registered $REG / $TOTAL images ($(( 100 * ${REG:-0} / TOTAL ))%)"
