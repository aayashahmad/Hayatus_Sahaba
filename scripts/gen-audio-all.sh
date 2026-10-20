#!/bin/bash
# Generates public/audio/volN/NNNN.mp3 + NNNN.json for every page that has
# text but no audio yet. Skips existing MP3s so you can re-run safely.
# Usage:  scripts/gen-audio-all.sh            (all volumes)
#         scripts/gen-audio-all.sh 1           (one volume)
#         scripts/gen-audio-all.sh 1 50 100    (vol 1, pages 50-100)
set -u
cd "$(dirname "$0")/.."

VOLS="${1:-1 2 3}"
START="${2:-}"
END="${3:-}"

# OCR blocks: page ranges that were transcribed by Tesseract (poor quality).
# Audio is never generated for these — the app shows the scan instead.
OCR_BLOCKS_1="13-13 16-16 36-47 72-83 108-119 156-179 204-215 231-251 253-263 300-311 324-335 348-359 468-479 504-539 564-575 588-599 636-647"
OCR_BLOCKS_2="15-15 120-131 144-155 216-227 276-299 324-335 420-443 480-491 516-527 552-563 588-599 660-671 684-719"
OCR_BLOCKS_3="16-16 96-107 120-131 148-155 192-203 216-251 324-335 348-359 372-383 408-419 432-443 456-467"

is_ocr_page() {
  local VOL=$1 PAGE=$2 BLOCKS
  [ "$VOL" = "1" ] && BLOCKS="$OCR_BLOCKS_1"
  [ "$VOL" = "2" ] && BLOCKS="$OCR_BLOCKS_2"
  [ "$VOL" = "3" ] && BLOCKS="$OCR_BLOCKS_3"
  for r in $BLOCKS; do
    local s=${r%-*} e=${r#*-}
    [ "$PAGE" -ge "$s" ] && [ "$PAGE" -le "$e" ] && return 0
  done
  return 1
}

for VOL in $VOLS; do
  # Read pages-with-text from index.json
  PAGES=$(python3 -c "
import json
d=json.load(open('public/text/index.json'))
pages=d.get('$VOL', [])
pages.sort()
$([ -n "$START" ] && echo "pages=[p for p in pages if p>=$START]")
$([ -n "$END"   ] && echo "pages=[p for p in pages if p<=$END]")
print(' '.join(str(p) for p in pages))
")
  for PAGE in $PAGES; do
    PSTR=$(printf '%04d' "$PAGE")
    MP3="public/audio/vol${VOL}/${PSTR}.mp3"
    [ -s "$MP3" ] && { echo "skip vol${VOL}/${PSTR}"; continue; }
    [ -f "public/audio/vol${VOL}/${PSTR}.skip" ] && { echo "skip vol${VOL}/${PSTR} (garbled)"; continue; }
    echo "gen  vol${VOL}/${PSTR}"
    python3 scripts/gen-audio-page.py "$VOL" "$PAGE" 2>&1 | grep -v '^\[' | head -3
  done
done
echo "Done."
