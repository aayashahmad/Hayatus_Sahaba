#!/usr/bin/env python3
"""
Regenerate page audio with OmniVoice (NVIDIA GPU version of gen-audio-omni.py; same output) into audio-omni/volN/NNNN.mp3 + .json.

Splits sentences exactly like the web app (src/App.jsx) and writes one timing entry per displayed sentence.
Quran/Arabic passages are voiced with the Arabic model, the rest with the Urdu model, in the same narrator voice.
Every passage is checked with Whisper and regenerated (up to TRIES) if words are missing; passages still below
ACCEPT, and every Arabic passage, are logged to audio-omni/review.tsv for a human/scholar to listen to.
Honorific symbols are expanded only in the spoken audio; the displayed text is unchanged.
Resumable: pages that already have an mp3 in audio-omni/ are skipped.

Usage:  python scripts/gen-audio-omni.py            (all volumes)
        python scripts/gen-audio-omni.py 1          (one volume)
        python scripts/gen-audio-omni.py 1 95 120   (vol 1, pages 95-120)
Needs:  omnivoice, torch, mlx-whisper, soundfile (see the venv used to create this script).
"""
import difflib, json, os, pathlib, re, subprocess, sys, tempfile, time
import numpy as np, soundfile as sf, torch
from faster_whisper import WhisperModel
from omnivoice import OmniVoice

OUT_ROOT = pathlib.Path("audio-omni")
SR, SENT_GAP = 24000, 0.45
TRIES, ACCEPT, SPEED = 2, 0.9, 0.95
INSTRUCT = "male, middle-aged, low pitch"
ASR = "large-v3-turbo"  # faster-whisper model name (the Mac script uses the mlx build of the same model)
_ASR_MODEL = None
VOICE_REF = OUT_ROOT / "narrator.wav"  # chosen once, reused for every page so the voice never changes

SPEAK = [("ﷺ", " صلی اللہ علیہ وسلم "), ("ؐ", " صلی اللہ علیہ وسلم "),
         ("ؓ", " رضی اللہ عنہ "), ("ؒ", " رحمۃ اللہ علیہ "), ("ؑ", " علیہ السلام ")]
# Pages whose text came from OCR and is unreliable (same lists as gen-audio-all.sh): no audio, the app shows the scan.
OCR_BLOCKS = {
    1: "13-13 16-16 36-47 72-83 108-119 156-179 204-215 231-251 253-263 300-311 324-335 348-359 468-479 504-539 564-575 588-599 636-647",
    2: "15-15 120-131 144-155 216-227 276-299 324-335 420-443 480-491 516-527 552-563 588-599 660-671 684-719",
    3: "16-16 96-107 120-131 148-155 192-203 216-251 324-335 348-359 372-383 408-419 432-443 456-467",
}

def is_ocr_page(vol, page):
    return any(int(a) <= page <= int(b) for a, b in (r.split("-") for r in OCR_BLOCKS[vol].split()))


def for_speech(s):
    for sym, words in SPEAK:
        s = s.replace(sym, words)
    return re.sub(r"\s+", " ", s).strip()


# Quran/Arabic passages: a word is Arabic when at least half its letters carry harakat, and a run of two or
# more such words is voiced by the Arabic model. Same rule as isArabicRun() in src/book.js (highlighting).
MARK = re.compile(r"[ً-ٰٟۡ-ۭ]")
LETTER = re.compile(r"[ء-يٱ-ۓ]")
# Urdu-style spelling of the Quran text -> standard Arabic letters, for the Arabic voice only.
TO_ARABIC = str.maketrans({"ی": "ي", "ھ": "ه", "ہ": "ه", "ۃ": "ة", "ک": "ك", "ٖ": "ِ"})

def word_kind(w):
    letters, marks = len(LETTER.findall(w)), len(MARK.findall(w))
    if not letters:
        return "n"
    return "a" if marks and marks / letters >= 0.5 else "u"

def arabic_flags(words):
    kinds, flags, i = [word_kind(w) for w in words], [False] * len(words), 0
    while i < len(words):
        if kinds[i] != "a":
            i += 1; continue
        j, count, last = i, 0, i
        while j < len(words) and kinds[j] in "an":
            if kinds[j] == "a":
                count, last = count + 1, j
            j += 1
        if count >= 2:
            flags[i:last + 1] = [True] * (last + 1 - i)
        i = last + 1
    return flags

def segments(sentence):
    """Split a sentence into [(lang, text)] runs of Urdu and Arabic words."""
    words = sentence.split()
    out = []
    for w, ar in zip(words, arabic_flags(words)):
        lang = "ar" if ar else "ur"
        if out and out[-1][0] == lang:
            out[-1][1].append(w)
        else:
            out.append((lang, [w]))
    return [(lang, " ".join(ws)) for lang, ws in out if LETTER.search(" ".join(ws))]


# Mirrors splitSentences() in src/book.js.
def split_sentences(text):
    return [s.strip() for s in re.split(r"(?<=[۔؟!])", text) if s.strip()]

def urdu_letter_count(s):
    return sum(1 for c in s if "؀" <= c <= "ۿ" and c not in "،؟۔؛")


def norm(s):
    s = re.sub(r"[ً-ٰٟؐ-ؚﷺ]", "", s)
    s = s.replace("ي", "ی").replace("ك", "ک").replace("ہ", "ه").replace("ۃ", "ه").replace("ة", "ه")
    return re.sub(r"\s+", " ", re.sub(r"[^؀-ۿ ]", " ", s)).split()

def norm_ar(s):
    s = MARK.sub("", s.translate(TO_ARABIC))
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ٱ", "ا"), ("ة", "ه"), ("ى", "ي")):
        s = s.replace(a, b)
    return re.sub(r"[^ء-ي ]", " ", s).split()

def coverage(text, audio, lang="ur"):
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        sf.write(f.name, audio, SR)
        global _ASR_MODEL
        if _ASR_MODEL is None:
            _ASR_MODEL = WhisperModel(ASR, device="cuda", compute_type="float16")
        segs, _ = _ASR_MODEL.transcribe(f.name, language=lang)
        heard = " ".join(x.text for x in segs)
    ref, hyp = (norm_ar(text), norm_ar(heard)) if lang == "ar" else (norm(text), norm(heard))
    sm = difflib.SequenceMatcher(None, ref, hyp, autojunk=False)
    return sum(b.size for b in sm.get_matching_blocks()) / max(1, len(ref))


def page_sentences(vol, page):
    """Every sentence the web app shows, in order (split per paragraph like App.jsx): [(text, voiced, para_end)]."""
    out = []
    for p in json.load(open(f"public/text/vol{vol}/{page:04d}.json")).get("paragraphs", []):
        sents = split_sentences(p[2:] if p.startswith("# ") else p)
        for k, s in enumerate(sents):
            out.append((s, urdu_letter_count(s) >= 8, k == len(sents) - 1))
    return out


def best_take(model, text, prompt, lang="ur"):
    best, best_c, n = None, -1.0, 0
    while best_c < ACCEPT and n < TRIES:
        a = model.generate(text=text, language=lang, voice_clone_prompt=prompt, speed=SPEED)[0]
        c = coverage(text, a, lang); n += 1
        if c > best_c:
            best, best_c = a, c
    return best, best_c, n


def main():
    vols = [int(sys.argv[1])] if len(sys.argv) > 1 else [1, 2, 3]
    lo = int(sys.argv[2]) if len(sys.argv) > 2 else None
    hi = int(sys.argv[3]) if len(sys.argv) > 3 else None
    OUT_ROOT.mkdir(exist_ok=True)
    review = open(OUT_ROOT / "review.tsv", "a", encoding="utf-8")

    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cuda", dtype=torch.float16)

    if VOICE_REF.exists():
        ref_text = (OUT_ROOT / "narrator.txt").read_text(encoding="utf-8")
        ref_audio, _ = sf.read(VOICE_REF, dtype="float32")
    else:
        ref_text = for_speech(page_sentences(1, 99)[0][0])
        ref_audio, best_c = None, -1.0
        for _ in range(TRIES):
            a = model.generate(text=ref_text, language="ur", instruct=INSTRUCT)[0]
            c = coverage(ref_text, a)
            if c > best_c:
                ref_audio, best_c = a, c
        sf.write(VOICE_REF, ref_audio, SR)
        (OUT_ROOT / "narrator.txt").write_text(ref_text, encoding="utf-8")
    prompt = model.create_voice_clone_prompt(ref_audio=(torch.from_numpy(ref_audio).unsqueeze(0), SR), ref_text=ref_text)

    for vol in vols:
        pages = sorted(int(p.stem) for p in pathlib.Path(f"public/audio/vol{vol}").glob("*.mp3"))
        pages = [p for p in pages if (lo is None or p >= lo) and (hi is None or p <= hi) and not is_ocr_page(vol, p)]
        (OUT_ROOT / f"vol{vol}").mkdir(exist_ok=True)
        for i, page in enumerate(pages):
            out_mp3 = OUT_ROOT / f"vol{vol}" / f"{page:04d}.mp3"
            if out_mp3.exists():
                continue
            t0 = time.time()
            sents = page_sentences(vol, page)
            if not any(voiced for _, voiced, _ in sents):
                continue
            # One timing entry per displayed sentence; unvoiced ones get d=0 so the web highlight stays aligned.
            chunks, timing, t, weak = [], [], 0.0, 0
            for k, (s, voiced, para_end) in enumerate(sents):
                if not voiced:
                    timing.append({"s": round(t, 4), "d": 0})
                    continue
                parts = []
                for lang, seg in segments(s):
                    spoken = seg.translate(TO_ARABIC) if lang == "ar" else for_speech(seg)
                    audio, c, _ = best_take(model, spoken, prompt, lang)
                    parts += [audio, np.zeros(int(SR * 0.15), dtype=np.float32)]
                    # Every Quran/Arabic passage is listed for a scholar to check, whatever its score.
                    if c < ACCEPT or lang == "ar":
                        weak += 1
                        tag = "[AR] " if lang == "ar" else ""
                        review.write(f"{vol}\t{page}\t{k + 1}\t{c:.2f}\t{tag}{seg}\n"); review.flush()
                audio = np.concatenate(parts[:-1])
                d = len(audio) / SR
                timing.append({"s": round(t, 4), "d": round(d, 4)})
                gap = SENT_GAP * 2 if para_end else SENT_GAP
                chunks += [audio, np.zeros(int(SR * gap), dtype=np.float32)]
                t += d + gap
            wav = out_mp3.with_suffix(".wav")
            sf.write(wav, np.concatenate(chunks[:-1]).astype(np.float32), SR)
            # -nostdin: a background ffmpeg that touches the terminal gets stopped (SIGTTIN) and the batch hangs.
            subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(wav), "-ac", "1", "-b:a", "48k", str(out_mp3)],
                           check=True, stdin=subprocess.DEVNULL)
            wav.unlink()
            json.dump(timing, open(out_mp3.with_suffix(".json"), "w"))
            print(f"vol{vol} {page:04d}  [{i + 1}/{len(pages)}]  {len(sents)} sentences, {weak} to review, {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
