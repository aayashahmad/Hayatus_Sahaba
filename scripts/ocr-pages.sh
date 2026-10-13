#!/bin/bash
# OCRs page scans with Tesseract (Urdu) and writes public/text/volN/NNNN.json.
# Never overwrites an existing page file. Pages are marked proofread:false.
# Setup:  brew install tesseract tesseract-lang
# Usage:  scripts/ocr-pages.sh VOL START END   then: node scripts/build-index.mjs
set -u
VOL=$1; START=$2; END=$3
BASE="Hayat-us-Sahaba_Vol${VOL}"
TMP=$(mktemp -d)
command -v tesseract >/dev/null || { echo "tesseract not installed"; exit 1; }
tesseract --list-langs | grep -qx urd || { echo "Urdu data missing: brew install tesseract-lang"; exit 1; }
for ((p = START; p <= END; p++)); do
  n=$(printf '%04d' "$p")
  out="public/text/vol${VOL}/${n}.json"
  [ -s "$out" ] && { echo "skip $n (exists)"; continue; }
  img="$TMP/${n}.jpg"
  for try in 1 2 3; do
    curl -sL --max-time 90 -o "$img" \
      "https://archive.org/download/hayat-us-sahaba-3volumes/${BASE}_jp2.zip/${BASE}_jp2%2F${BASE}_${n}.jp2&ext=jpg&reduce=0"
    file "$img" | grep -q JPEG && break
    sleep $((try * 4))
  done
  file "$img" | grep -q JPEG || { echo "FAILED $n"; continue; }
  tesseract "$img" "$TMP/$n" -l urd --psm 6 >/dev/null 2>&1
  node -e '
    const fs=require("fs");
    const [,, txt, vol, page, out]=process.argv;
    const paragraphs=fs.readFileSync(txt,"utf8").split(/\n\s*\n/)
      .map(s=>s.replace(/\s*\n\s*/g," ").trim()).filter(Boolean);
    fs.writeFileSync(out, JSON.stringify({volume:+vol,page:+page,proofread:false,paragraphs,footnotes:[]},null,2));
  ' "$TMP/$n.txt" "$VOL" "$p" "$out"
  echo "ok $n"
done
rm -rf "$TMP"
