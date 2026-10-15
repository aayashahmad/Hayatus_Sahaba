#!/usr/bin/env python3
"""
Generate public/audio/volN/NNNN.mp3 + NNNN.json (timing data) for one page.
Splits text into sentences the same way the app does, generates each sentence
with edge-tts (ur-PK-AsadNeural), concatenates with ffmpeg, and writes timing.

Usage:  python3 scripts/gen-audio-page.py <vol> <page>
        python3 scripts/gen-audio-page.py 1 3
"""
import sys, json, re, asyncio, tempfile, os, subprocess, pathlib

VOICE = "ur-PK-AsadNeural"

def split_sentences(text):
    """Mirror src/book.js splitSentences."""
    parts = re.split(r'(?<=[۔؟!])', text)
    return [s.strip() for s in parts if s.strip()]

def get_duration(mp3_path):
    """Return duration in seconds using ffprobe."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", mp3_path],
        capture_output=True, text=True
    )
    return float(r.stdout.strip())

async def synthesise(text, out_path):
    import edge_tts
    c = edge_tts.Communicate(text, VOICE)
    await c.save(out_path)

async def main():
    if len(sys.argv) != 3:
        print("Usage: gen-audio-page.py <vol> <page>")
        sys.exit(1)

    vol = int(sys.argv[1])
    page = int(sys.argv[2])
    page_str = f"{page:04d}"

    text_path = f"public/text/vol{vol}/{page_str}.json"
    out_mp3   = f"public/audio/vol{vol}/{page_str}.mp3"
    out_json  = f"public/audio/vol{vol}/{page_str}.json"

    if not pathlib.Path(text_path).exists():
        print(f"No text file: {text_path}")
        sys.exit(1)

    data = json.load(open(text_path))
    paragraphs = [p.lstrip("# ") for p in data.get("paragraphs", []) if p.strip()]
    full_text = " ".join(paragraphs)
    sentences = split_sentences(full_text)

    if not sentences:
        print(f"No sentences on page {page}")
        sys.exit(0)

    # Skip marker: a .skip file means this page was already determined to be
    # unreadable; don't retry it on every run.
    skip_marker = pathlib.Path(f"public/audio/vol{vol}/{page_str}.skip")
    if skip_marker.exists():
        print(f"SKIP (marked unreadable) vol{vol}/{page_str}")
        sys.exit(0)

    # Filter sentences: a sentence needs at least 8 Urdu/Arabic letter characters
    # to be worth sending to TTS. Punctuation-only sentences ("۔", "!", etc.)
    # and very short garbled fragments are dropped.
    def urdu_letter_count(s):
        return sum(1 for c in s if '؀' <= c <= 'ۿ' and c not in '،؟۔؛')

    good_sentences = [(i, s) for i, s in enumerate(sentences) if urdu_letter_count(s) >= 8]

    if len(good_sentences) < 2 and (not good_sentences or urdu_letter_count(good_sentences[0][1]) < 20):
        print(f"SKIP (garbled/too short) vol{vol}/{page_str}")
        skip_marker.parent.mkdir(parents=True, exist_ok=True)
        skip_marker.touch()
        sys.exit(0)

    # Remap sentence indices to consecutive positions in the good list.
    orig_indices = [i for i, _ in good_sentences]
    sentences_clean = [s for _, s in good_sentences]

    pathlib.Path(f"public/audio/vol{vol}").mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        sent_files = []
        kept_indices = []
        for pos, sent in enumerate(sentences_clean):
            mp3 = os.path.join(tmp, f"{pos:04d}.mp3")
            print(f"  [{pos+1}/{len(sentences_clean)}] {sent[:60]}")
            try:
                await synthesise(sent, mp3)
                if pathlib.Path(mp3).exists():
                    sent_files.append(mp3)
                    kept_indices.append(pos)
                else:
                    print(f"  WARN: no audio for sentence {pos+1}, skipping")
            except Exception as e:
                print(f"  WARN: sentence {pos+1} failed ({e.__class__.__name__}), skipping")

        if not sent_files:
            print(f"SKIP (all sentences failed) vol{vol}/{page_str}")
            skip_marker.touch()
            sys.exit(0)

        # Build timing data from individual durations.
        # timing[i] corresponds to sentences_clean[kept_indices[i]].
        timing = []
        t = 0.0
        for mp3 in sent_files:
            d = get_duration(mp3)
            timing.append({"s": round(t, 4), "d": round(d, 4)})
            t += d

        # If total audio is under 3 seconds the page is likely garbled; skip.
        if t < 3.0:
            print(f"SKIP (audio too short: {t:.1f}s) vol{vol}/{page_str}")
            skip_marker.touch()
            sys.exit(0)

        # Concatenate all sentence MP3s into one
        list_file = os.path.join(tmp, "list.txt")
        with open(list_file, "w") as f:
            for mp3 in sent_files:
                f.write(f"file '{mp3}'\n")

        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
             "-i", list_file, "-c", "copy", out_mp3],
            capture_output=True
        )

    json.dump(timing, open(out_json, "w"))
    print(f"OK → {out_mp3}  ({len(sentences)} sentences, {t:.1f}s)")
    print(f"   → {out_json}")

asyncio.run(main())
