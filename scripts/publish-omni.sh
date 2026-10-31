#!/bin/bash
# Copy finished OmniVoice pages (audio-omni/) over the site audio and push, so the web app and the
# mobile app (which streams from the same site) pick them up. Run once, or with --loop to repeat every 3 hours.
cd "$(dirname "$0")/.." || exit 1

publish() {
  local n=0
  for mp3 in audio-omni/vol*/*.mp3; do
    [ -e "$mp3" ] || continue
    json="${mp3%.mp3}.json"
    [ -f "$json" ] || continue            # page still being written
    dest="public/${mp3#audio-omni/}"
    [ -d "$(dirname "$dest")" ] || continue
    if ! cmp -s "$mp3" "$dest" || ! cmp -s "$json" "${dest%.mp3}.json"; then
      cp "$mp3" "$json" "$(dirname "$dest")/"; n=$((n + 1))
    fi
  done
  if [ "$n" -gt 0 ]; then
    git add public/audio && git commit -q -m "OmniVoice narration: $n more pages" && git push -q origin main \
      && echo "$(date '+%F %T') published $n pages" || echo "$(date '+%F %T') push failed"
  else
    echo "$(date '+%F %T') nothing new"
  fi
}

if [ "$1" = "--loop" ]; then
  while pgrep -f "python scripts/gen-audio-omni.py" >/dev/null; do publish; sleep 10800; done
  publish
else
  publish
fi
