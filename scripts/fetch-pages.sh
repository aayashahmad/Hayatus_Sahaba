#!/bin/bash
# Downloads page scans from archive.org and splits each into overlapping
# top/bottom halves so the print is large enough to read.
# Usage: scripts/fetch-pages.sh VOL START END OUTDIR   (macOS: uses sips)
set -u
VOL=$1; START=$2; END=$3; OUT=$4
BASE="Hayat-us-Sahaba_Vol${VOL}"
mkdir -p "$OUT"
for ((p = START; p <= END; p++)); do
  n=$(printf '%04d' "$p")
  full="$OUT/v${VOL}_${n}.jpg"
  if [ ! -s "${full%.jpg}_b.jpg" ]; then
    for try in 1 2 3 4 5; do
      curl -sL --max-time 90 -o "$full" \
        "https://archive.org/download/hayat-us-sahaba-3volumes/${BASE}_jp2.zip/${BASE}_jp2%2F${BASE}_${n}.jp2&ext=jpg&reduce=1"
      file "$full" | grep -q 'JPEG' && break
      sleep $((try * 4))
    done
    if ! file "$full" | grep -q 'JPEG'; then echo "FAILED $n"; continue; fi
    w=$(sips -g pixelWidth "$full" | awk '/pixelWidth/{print $2}')
    h=$(sips -g pixelHeight "$full" | awk '/pixelHeight/{print $2}')
    half=$((h * 56 / 100))
    sips -c "$half" "$w" --cropOffset 1 1 "$full" --out "${full%.jpg}_a.jpg" >/dev/null
    sips -c "$half" "$w" --cropOffset $((h - half - 2)) 0 "$full" --out "${full%.jpg}_b.jpg" >/dev/null
  fi
  echo "${full%.jpg}_a.jpg ${full%.jpg}_b.jpg"
done
