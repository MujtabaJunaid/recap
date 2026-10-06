import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chromium' })
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } })
const p = await ctx.newPage()
const pages = [
  ['home', 'https://fathom.video/'],
  ['pricing', 'https://fathom.video/pricing'],
  ['features', 'https://fathom.video/features'],
]
for (const [name, url] of pages) {
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await p.waitForTimeout(3500)
    await p.screenshot({ path: `recon/${name}.png`, fullPage: false })
    const title = await p.title()
    const text = (await p.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n')
    console.log(`\n===== ${name} (${p.url()}) =====`)
    console.log('title:', title)
    console.log(text.slice(0, 2200))
  } catch (e) {
    console.log(`\n===== ${name} FAILED: ${e.message.slice(0, 120)}`)
  }
}
await b.close()
