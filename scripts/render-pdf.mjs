/**
 * Renders docs/overview.html to docs/Recap-overview.pdf.
 *
 * Chromium rather than a PDF library, so the document is styled with the same CSS the
 * product uses and the two cannot drift apart. Backgrounds are printed because the
 * palette is the point.
 *
 *   node scripts/render-pdf.mjs
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { statSync } from 'node:fs'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'docs/overview.html')
const output = resolve(root, 'docs/Recap-overview.pdf')

const browser = await chromium.launch({ channel: 'chromium' })
const page = await browser.newPage()

const problems = []
page.on('pageerror', (e) => problems.push(e.message))
page.on('requestfailed', (r) => problems.push(`${r.url()} ${r.failure()?.errorText}`))

await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' })
await page.pdf({
  path: output,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
})

await browser.close()

if (problems.length > 0) {
  console.error('render problems:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

const { size } = statSync(output)
console.log(`wrote docs/Recap-overview.pdf (${(size / 1024).toFixed(0)} KB)`)
