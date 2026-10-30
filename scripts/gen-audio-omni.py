#!/usr/bin/env python3
"""
Regenerate page audio with OmniVoice (local, Apple Silicon) into audio-omni/volN/NNNN.mp3 + .json.

Uses the same sentence list as gen-audio-page.py so the app's sentence highlighting stays in sync.
Every sentence is checked with Whisper and regenerated (up to --tries) if words are missing;
sentences still below --accept are logged to audio-omni/review.tsv for a human to listen to.
Honorific symbols are expanded only in the spoken audio; the displayed text is unchanged.
Resumable: pages that already have an mp3 in audio-omni/ are skipped.

Usage:  python scripts/gen-audio-omni.py            (all volumes)
        python scripts/gen-audio-omni.py 1          (one volume)
        python scripts/gen-audio-omni.py 1 95 120   (vol 1, pages 95-120)
Needs:  omnivoice, torch, mlx-whisper, soundfile (see the venv used to create this script).
"""
import difflib, json, os, pathlib, re, subprocess, sys, tempfile, time
import numpy as np, soundfile as sf, torch, mlx_whisper
from omnivoice import OmniVoice

OUT_ROOT = pathlib.Path("audio-omni")
SR, SENT_GAP = 24000, 0.45
TRIES, ACCEPT, SPEED = 2, 0.9, 0.95
INSTRUCT = "male, middle-aged, low pitch"
ASR = "mlx-community/whisper-large-v3-turbo"
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

TASHKEEL = set("ًٌٍَُِّْ" "ٕٖٓٔٗ٘ٙٚ" "ٜٟٛٝٞ")


def for_speech(s):
    for sym, words in SPEAK:
        s = s.replace(sym, words)
    return re.sub(r"\s+", " ", s).strip()


# Same rules as gen-audio-page.py.
def split_sentences(text):
    return [s.strip() for s in re.split(r"(?<=[۔؟!])", text) if s.strip()]

def urdu_letter_count(s):
    return sum(1 for c in s if "؀" <= c <= "ۿ" and c not in "،؟۔؛")

def is_arabic_quran(s):
    arabic = sum(1 for c in s if "؀" <= c <= "ۿ")
    return arabic > 0 and sum(1 for c in s if c in TASHKEEL) / arabic > 0.20


def norm(s):
    s = re.sub(r"[ً-ٰٟؐ-ؚﷺ]", "", s)
    s = s.replace("ي", "ی").replace("ك", "ک").replace("ہ", "ه").replace("ۃ", "ه").replace("ة", "ه")
    return re.sub(r"\s+", " ", re.sub(r"[^؀-ۿ ]", " ", s)).split()

def coverage(text, audio):
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        sf.write(f.name, audio, SR)
        heard = mlx_whisper.transcribe(f.name, path_or_hf_repo=ASR, language="ur")["text"]
    ref, hyp = norm(text), norm(heard)
    sm = difflib.SequenceMatcher(None, ref, hyp, autojunk=False)
    return sum(b.size for b in sm.get_matching_blocks()) / max(1, len(ref))


def page_sentences(vol, page):
    paras = [p.lstrip("# ") for p in json.load(open(f"public/text/vol{vol}/{page:04d}.json")).get("paragraphs", []) if p.strip()]
    full = " ".join(paras)
    # Character offsets where paragraphs end, to put a longer pause there.
    ends, pos = set(), 0
    for p in paras:
        pos += len(p); ends.add(pos); pos += 1
    out, cursor = [], 0
    for s in split_sentences(full):
        at = full.find(s, cursor); cursor = at + len(s)
        if urdu_letter_count(s) >= 8 and not is_arabic_quran(s):
            out.append((s, cursor in ends))
    return out


def best_take(model, text, prompt):
    best, best_c, n = None, -1.0, 0
    while best_c < ACCEPT and n < TRIES:
        a = model.generate(text=text, language="ur", voice_clone_prompt=prompt, speed=SPEED)[0]
        c = coverage(text, a); n += 1
        if c > best_c:
            best, best_c = a, c
    return best, best_c, n


def main():
    vols = [int(sys.argv[1])] if len(sys.argv) > 1 else [1, 2, 3]
    lo = int(sys.argv[2]) if len(sys.argv) > 2 else None
    hi = int(sys.argv[3]) if len(sys.argv) > 3 else None
    OUT_ROOT.mkdir(exist_ok=True)
    review = open(OUT_ROOT / "review.tsv", "a", encoding="utf-8")

    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="mps", dtype=torch.float16)

    if VOICE_REF.exists():
        ref_text = (OUT_ROOT / "narrator.txt").read_text(encoding="utf-8")
        ref_audio, _ = sf.read(VOICE_REF, dtype="float32")
    else:
        ref_text = page_sentences(1, 99)[0][0]
        ref_text = for_speech(ref_text)
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
            if not sents:
                continue
            chunks, timing, t, weak = [], [], 0.0, 0
            for k, (s, para_end) in enumerate(sents):
                spoken = for_speech(s)
                audio, c, _ = best_take(model, spoken, prompt)
                d = len(audio) / SR
                timing.append({"s": round(t, 4), "d": round(d, 4)})
                gap = SENT_GAP * 2 if para_end else SENT_GAP
                chunks += [audio, np.zeros(int(SR * gap), dtype=np.float32)]
                t += d + gap
                if c < ACCEPT:
                    weak += 1
                    review.write(f"{vol}\t{page}\t{k + 1}\t{c:.2f}\t{s}\n"); review.flush()
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
