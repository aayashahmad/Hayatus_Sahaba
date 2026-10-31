// Scans rendered from the archive.org PDFs (https://archive.org/details/hayat-us-sahaba-3volumes)
// and self-hosted, because archive.org converts JP2 pages on every request and is often slow or down.
export const VOLUMES = [
  { id: 1, name: 'Volume 1', pages: 649 },
  { id: 2, name: 'Volume 2', pages: 792 },
  { id: 3, name: 'Volume 3', pages: 719 },
]

export const pad = (n) => String(n).padStart(4, '0')

export const scanUrl = (vol, page) => `/scans/vol${vol}/${pad(page)}.png`
export const scanUrlHd = (vol, page) => `/scans-hd/vol${vol}/${pad(page)}.png`

export const textUrl = (vol, page) => `/text/vol${vol}/${pad(page)}.json`
export const audioUrl = (vol, page) => `/audio/vol${vol}/${pad(page)}.mp3`

// Urdu sentences end with ۔ ؟ or !
export function splitSentences(text) {
  return text
    .split(/(?<=[۔؟!])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Quran/Arabic passages: a word is Arabic when at least half its letters carry harakat, and a run of two
// or more such words counts. Same rule as arabic_flags() in scripts/gen-audio-omni.py, which voices these
// runs with the Arabic model. Only styling depends on this; the text itself is never changed.
const MARK = /[ً-ٰٟۡ-ۭ]/g
const LETTER = /[ء-يٱ-ۓ]/g

function wordKind(w) {
  const letters = (w.match(LETTER) ?? []).length
  const marks = (w.match(MARK) ?? []).length
  if (!letters) return 'n'
  return marks && marks / letters >= 0.5 ? 'a' : 'u'
}

export function arabicFlags(words) {
  const kinds = words.map(wordKind)
  const flags = words.map(() => false)
  let i = 0
  while (i < words.length) {
    if (kinds[i] !== 'a') { i++; continue }
    let j = i, count = 0, last = i
    while (j < words.length && kinds[j] !== 'u') {
      if (kinds[j] === 'a') { count++; last = j }
      j++
    }
    if (count >= 2) for (let x = i; x <= last; x++) flags[x] = true
    i = last + 1
  }
  return flags
}
