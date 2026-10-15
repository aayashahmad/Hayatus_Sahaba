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
