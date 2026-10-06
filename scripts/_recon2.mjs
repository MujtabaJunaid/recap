import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chromium' })
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
await p.goto('https://www.fathom.ai/', { waitUntil: 'domcontentloaded', timeout: 45000 })
await p.waitForTimeout(4000)
const text = (await p.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n')
console.log(text.slice(2000, 7000))
await b.close()
