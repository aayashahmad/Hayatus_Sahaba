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
