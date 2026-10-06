import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chromium' })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
const p = await ctx.newPage()
await p.goto('http://localhost:5180/signin', { waitUntil: 'networkidle' })
await p.getByRole('button', { name: 'Continue' }).click()
await p.waitForTimeout(400)
for (const path of ['/', '/m/q3-roadmap-review', '/actions', '/share/ck-7f2a91']) {
  await p.goto('http://localhost:5180' + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(400)
  const r = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const out = []
    for (const el of document.querySelectorAll('*')) {
      const b = el.getBoundingClientRect()
      if (b.width > vw + 1 || b.right > vw + 1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className?.toString?.() || '').slice(0, 70),
          w: Math.round(b.width), right: Math.round(b.right),
        })
      }
    }
    return { vw, scrollW: document.documentElement.scrollWidth, offenders: out.slice(0, 6) }
  })
  console.log(`\n${path}  viewport=${r.vw} scrollWidth=${r.scrollW}`)
  for (const o of r.offenders) console.log(`   <${o.tag}> w=${o.w} right=${o.right}  ${o.cls}`)
}
await b.close()
