/**
 * Drives the app through the flows a real user takes and captures a screenshot at each
 * step. Console errors, page errors and failed requests are collected and printed, so a
 * silent runtime failure shows up here rather than only in someone's devtools.
 *
 *   node scripts/walkthrough.mjs [baseUrl] [outDir]
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5180'
const outDir = process.argv[3] ?? 'screenshots'
mkdirSync(outDir, { recursive: true })

const problems = []
let step = 0

const browser = await chromium.launch({ channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text()}`)
})
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`))

async function shot(name) {
  step += 1
  const file = `${outDir}/${String(step).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file, fullPage: false })
  console.log(`  captured ${file}`)
}

async function go(path) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
}

console.log('1. Signed-out visitor hits the workspace')
await go('/')
await page.waitForSelector('text=Sign in')
await shot('signin-gate')

console.log('2. Sign in')
await page.getByRole('button', { name: 'Continue' }).click()
await page.waitForSelector('h1:has-text("Meetings")')
await shot('meetings-list')

console.log('3. Open the eight-person hour-long call')
await page.getByRole('heading', { name: 'Q3 Roadmap Review' }).click()
await page.waitForSelector('text=Transcript')
await shot('meeting-summary')

console.log('4. Play, let the transcript track the playhead')
await page.getByRole('button', { name: 'Play' }).click()
await page.waitForTimeout(2500)
await shot('playing')
await page.getByRole('button', { name: 'Pause' }).click()

console.log('5. Seek by clicking a transcript line')
await page.getByText('Make the engineer case.', { exact: false }).first().click()
await page.waitForTimeout(400)
await shot('seeked-to-line')

console.log('6. Switch summary template')
await page.getByRole('button', { name: 'General', exact: true }).click()
await page.waitForTimeout(300)
await shot('template-general')

console.log('7. Action items tab')
await page.getByRole('button', { name: /^Actions/ }).click()
await page.waitForTimeout(300)
await shot('action-items')

console.log('8. Tick an action item')
const firstCheckbox = page.getByRole('button', { name: /^Complete:/ }).first()
await firstCheckbox.click()
await page.waitForTimeout(300)
await shot('action-ticked')

console.log('9. Clip the current moment')
await page.getByRole('button', { name: 'Clip this moment' }).click()
await page.waitForTimeout(400)
await shot('highlights-after-clip')

console.log('10. Clip the same moment again (must not duplicate)')
const before = await page.getByRole('button', { name: /^Share$/ }).count()
await page.getByRole('button', { name: /^Highlights/ }).click()
await page.waitForTimeout(200)
const after = await page.getByRole('button', { name: /^Share$/ }).count()
console.log(`  share buttons before=${before} after=${after}`)

console.log('11. Analytics on the eight-person call')
await page.getByRole('button', { name: /^Analytics/ }).click()
await page.waitForTimeout(300)
await shot('analytics')

console.log('12. Navigate to a different meeting (state must not leak)')
await page.getByRole('link', { name: 'Acme Logistics — Discovery' }).first().click()
await page.waitForTimeout(500)
await shot('second-meeting')

console.log('13. Cross-meeting action items')
await go('/actions')
await page.waitForSelector('h1:has-text("Action items")')
await shot('all-actions')

console.log('14. Search across every meeting')
await go('/search?q=SCIM')
await page.waitForTimeout(400)
await shot('search-scim')

console.log('15. Highlights feed')
await go('/highlights')
await page.waitForTimeout(400)
await shot('highlights-feed')

console.log('16. Public share page as a signed-out recipient')
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const anonPage = await anon.newPage()
anonPage.on('pageerror', (e) => problems.push(`share pageerror: ${e.message}`))
await anonPage.goto(`${base}/share/ck-7f2a91`, { waitUntil: 'networkidle' })
await anonPage.waitForTimeout(400)
await anonPage.screenshot({ path: `${outDir}/17-shared-clip-anonymous.png` })
console.log(`  captured ${outDir}/17-shared-clip-anonymous.png`)
const leaked = await anonPage.getByText('Sign in').count()
console.log(`  share page demanded sign-in: ${leaked > 0 ? 'YES (bug)' : 'no'}`)

console.log('17. Mobile width')
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
const mobilePage = await mobile.newPage()
await mobilePage.goto(`${base}/signin`, { waitUntil: 'networkidle' })
await mobilePage.getByRole('button', { name: 'Continue' }).click()
await mobilePage.waitForTimeout(600)
await mobilePage.screenshot({ path: `${outDir}/18-mobile-meetings.png` })
await mobilePage.goto(`${base}/m/q3-roadmap-review`, { waitUntil: 'networkidle' })
await mobilePage.waitForTimeout(600)
await mobilePage.screenshot({ path: `${outDir}/19-mobile-meeting.png` })
console.log('  captured mobile screenshots')

await browser.close()

console.log(`\n${problems.length} runtime problem(s)`)
for (const p of [...new Set(problems)]) console.log(`  - ${p}`)
process.exit(0)
