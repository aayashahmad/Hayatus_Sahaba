#!/usr/bin/env python3
"""
Realigns timing files written by the older edge-tts script (gen-audio-page.py) with the sentences the
web app shows. That script joined all paragraphs, skipped short and Arabic sentences, and wrote timing
only for the sentences it voiced, so the app's highlight drifted. This rebuilds one entry per displayed
sentence (skipped ones get d=0) by mapping character positions to time. Pages whose timing already
matches (e.g. OmniVoice pages) are left alone, as are pages it cannot map safely.

Usage: python3 scripts/fix-old-timing.py
"""
import json, re, subprocess, pathlib

TASHKEEL = set("ًٌٍَُِّْٕٖٜٟٓٔٗ٘ٙٚٛٝٞ")


def split_sentences(text):
    return [s.strip() for s in re.split(r"(?<=[۔؟!])", text) if s.strip()]


def urdu_letter_count(s):
    return sum(1 for c in s if "؀" <= c <= "ۿ" and c not in "،؟۔؛")


def is_arabic_quran(s):
    arabic = sum(1 for c in s if "؀" <= c <= "ۿ")
    return arabic > 0 and sum(1 for c in s if c in TASHKEEL) / arabic > 0.20


def spans(text, parts):
    """Character [start, end) of each part, found in order in text."""
    out, pos = [], 0
    for p in parts:
        i = text.find(p, pos)
        if i < 0:
            return None
        out.append((i, i + len(p)))
        pos = i + len(p)
    return out


def duration(mp3):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp3)],
                       capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


fixed = skipped = 0
for jf in sorted(pathlib.Path("public/audio").glob("vol*/*.json")):
    vol, page = jf.parent.name, jf.stem
    tf = pathlib.Path(f"public/text/{vol}/{page}.json")
    if not tf.exists():
        continue
    paras = json.load(open(tf, encoding="utf-8")).get("paragraphs", [])
    timing = json.load(open(jf))

    # What the app shows: sentences split per paragraph, headings without "# ".
    app_paras = [p[2:] if p.startswith("# ") else p for p in paras]
    app_sents = [s for p in app_paras for s in split_sentences(p)]
    if len(timing) == len(app_sents):
        continue

    # What the old script voiced: paragraphs joined, then split and filtered.
    old_paras = [p.lstrip("# ") for p in paras if p.strip()]
    joined = " ".join(old_paras)
    old_sents = split_sentences(joined)
    voiced = [s for s in old_sents if urdu_letter_count(s) >= 8 and not is_arabic_quran(s)]
    mp3 = jf.with_suffix(".mp3")
    if len(voiced) != len(timing) or abs(sum(t["d"] for t in timing) - duration(mp3)) > 2:
        print(f"skip {vol}/{page}: timing does not match the old script's sentences")
        skipped += 1
        continue

    old_spans = spans(joined, old_sents)
    voiced_spans = spans(joined, voiced)
    # Each app sentence lies inside one paragraph; locate it in the joined text paragraph by paragraph.
    app_spans, base = [], 0
    for p, raw in zip(app_paras, paras):
        if not raw.strip():
            continue
        start = joined.find(p, base)
        sp = spans(p, split_sentences(p))
        if start < 0 or sp is None:
            app_spans = None
            break
        app_spans += [(start + a, start + b) for a, b in sp]
        base = start + len(p)
    if old_spans is None or voiced_spans is None or app_spans is None or len(app_spans) != len(app_sents):
        print(f"skip {vol}/{page}: could not map sentences")
        skipped += 1
        continue

    def time_at(c):
        """Audio time at character c: linear inside a voiced sentence, a pause point elsewhere."""
        t_end = 0.0
        for (a, b), t in zip(voiced_spans, timing):
            if c < a:
                return t["s"]
            if c < b:
                return t["s"] + t["d"] * (c - a) / max(1, b - a)
            t_end = t["s"] + t["d"]
        return t_end

    new = []
    for a, b in app_spans:
        s, e = time_at(a), time_at(b - 1)
        new.append({"s": round(s, 4), "d": round(max(0.0, e - s), 4)})
    json.dump(new, open(jf, "w"))
    fixed += 1

print(f"realigned {fixed} pages, left {skipped} pages unchanged")
