// Source scans: https://archive.org/details/hayat-us-sahaba-3volumes
const ITEM = 'hayat-us-sahaba-3volumes'

export const VOLUMES = [
  { id: 1, name: 'Volume 1', pages: 649 },
  { id: 2, name: 'Volume 2', pages: 792 },
  { id: 3, name: 'Volume 3', pages: 719 },
]

export const pad = (n) => String(n).padStart(4, '0')

export function scanUrl(vol, page) {
  const base = `Hayat-us-Sahaba_Vol${vol}`
  return `https://archive.org/download/${ITEM}/${base}_jp2.zip/${base}_jp2%2F${base}_${pad(page)}.jp2&ext=jpg&reduce=1`
}

export const textUrl = (vol, page) => `/text/vol${vol}/${pad(page)}.json`
export const audioUrl = (vol, page) => `/audio/vol${vol}/${pad(page)}.mp3`

// Urdu sentences end with ۔ ؟ or !
export function splitSentences(text) {
  return text
    .split(/(?<=[۔؟!])/)
    .map((s) => s.trim())
    .filter(Boolean)
}
