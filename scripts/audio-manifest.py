#!/usr/bin/env python3
"""Write public/audio/manifest.json: a short fingerprint of every page's mp3, so the mobile app can tell which
downloaded pages are out of date (re-download only those, and delete pages that no longer have audio).

  {"pages": {"1": {"3": "9f2c1a7b", ...}, "2": {...}, "3": {...}}}

Run by scripts/publish-omni.sh before every push; safe to run by hand.
"""
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / "public" / "audio"

pages = {}
for vol_dir in sorted(ROOT.glob("vol*")):
    vol = vol_dir.name[3:]
    pages[vol] = {str(int(mp3.stem)): hashlib.md5(mp3.read_bytes()).hexdigest()[:8]
                  for mp3 in sorted(vol_dir.glob("*.mp3"))}
out = ROOT / "manifest.json"
new = json.dumps({"pages": pages}, separators=(",", ":"), sort_keys=True)
if not out.exists() or out.read_text() != new:
    out.write_text(new)
print(f"manifest: {sum(len(p) for p in pages.values())} pages")
