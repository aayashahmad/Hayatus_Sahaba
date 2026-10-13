// Rebuilds public/text/index.json from the page files that hold text.
// Usage: node scripts/build-index.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const index = {}
const problems = []
for (const vol of [1, 2, 3]) {
  const dir = `public/text/vol${vol}`
  index[vol] = []
  for (const name of readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f)).sort()) {
    try {
      const d = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'))
      if (!Array.isArray(d.paragraphs) || d.paragraphs.some((p) => typeof p !== 'string')) throw new Error('bad paragraphs')
      if (d.paragraphs.length) index[vol].push(Number(name.slice(0, 4)))
    } catch (e) {
      problems.push(`${dir}/${name}: ${e.message}`)
    }
  }
  console.log(`vol${vol}: ${index[vol].length} pages with text`)
}
writeFileSync('public/text/index.json', JSON.stringify(index))
if (problems.length) console.log('PROBLEMS:\n' + problems.join('\n'))
