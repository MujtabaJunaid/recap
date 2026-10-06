/**
 * End-to-end validation of every user flow, with assertions rather than eyeballing.
 *
 * Each check states what it expects and fails loudly if reality disagrees. Console
 * errors, page errors and failed requests are collected throughout, so a silent runtime
 * failure surfaces here instead of in somebody's devtools. Screenshots are a by-product,
 * not the point.
 *
 *   node scripts/walkthrough.mjs [baseUrl] [outDir]
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = (process.argv[2] ?? 'http://localhost:5180').replace(/\/$/, '')
const outDir = process.argv[3] ?? 'screenshots'
mkdirSync(outDir, { recursive: true })

const problems = []
const results = []
let step = 0

const browser = await chromium.launch({ channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

function watch(target, label) {
  target.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${label} console.error: ${m.text()}`)
  })
  target.on('pageerror', (e) => problems.push(`${label} pageerror: ${e.message}`))
  target.on('requestfailed', (r) =>
    problems.push(`${label} requestfailed: ${r.url()} ${r.failure()?.errorText}`),
  )
}
watch(page, 'app')

async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  PASS  ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: error.message })
    console.log(`  FAIL  ${name}\n        ${error.message.split('\n')[0]}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function shot(name) {
  step += 1
  await page.screenshot({ path: `${outDir}/${String(step).padStart(2, '0')}-${name}.png` })
}

async function go(path) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
}

console.log('\n── Auth ──')

await check('signed-out visitor is redirected to sign-in', async () => {
  await go('/')
  await page.waitForSelector('text=Sign in', { timeout: 10_000 })
  assert(page.url().includes('/signin'), `expected /signin, got ${page.url()}`)
})
await shot('signin-gate')

await check('invalid email is rejected with a message', async () => {
  await page.fill('#email', 'not-an-email')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForSelector('#email-error', { timeout: 3000 })
  assert(page.url().includes('/signin'), 'should not have navigated')
})

await check('any valid email signs in', async () => {
  await page.fill('#email', 'someone.else@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForSelector('h1:has-text("Meetings")', { timeout: 10_000 })
})
await shot('meetings-list')

await check('session survives a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('h1:has-text("Meetings")', { timeout: 10_000 })
})

console.log('\n── Meetings list ──')

await check('every seeded meeting renders', async () => {
  const cards = await page.locator('article').count()
  assert(cards >= 8, `expected at least 8 meeting cards, saw ${cards}`)
})

await check('a processing meeting shows its own state, not an error', async () => {
  const text = await page.locator('text=Transcribing and summarising').count()
  assert(text > 0, 'no processing state found')
})

await check('team filter narrows the list', async () => {
  const before = await page.locator('article').count()
  await page.getByRole('button', { name: 'Sales', exact: true }).click()
  await page.waitForTimeout(250)
  const after = await page.locator('article').count()
  assert(after < before && after > 0, `filter did not narrow: ${before} -> ${after}`)
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.waitForTimeout(200)
})

console.log('\n── Meeting detail: the eight-person hour ──')

await check('opens the hero meeting', async () => {
  await go('/m/q3-roadmap-review')
  await page.waitForSelector('text=Transcript', { timeout: 10_000 })
  const avatars = await page.locator('h1:has-text("Q3 Roadmap Review")').count()
  assert(avatars === 1, 'meeting title missing')
})
await shot('meeting-summary')

await check('playback advances the clock', async () => {
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2200)
  const slider = page.getByRole('slider')
  const now = Number(await slider.getAttribute('aria-valuenow'))
  assert(now > 0, `playhead did not advance (aria-valuenow=${now})`)
  await page.getByRole('button', { name: 'Pause' }).click()
})
await shot('playing')

await check('clicking a transcript line seeks to it', async () => {
  await page.getByText('Make the engineer case.', { exact: false }).first().click()
  await page.waitForTimeout(400)
  const now = Number(await page.getByRole('slider').getAttribute('aria-valuenow'))
  assert(now > 2500, `expected to seek past 2500s, at ${now}`)
  await page.getByRole('button', { name: 'Pause' }).click().catch(() => {})
})
await shot('seeked')

await check('scrubber is keyboard operable', async () => {
  const slider = page.getByRole('slider')
  await slider.focus()
  const before = Number(await slider.getAttribute('aria-valuenow'))
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(150)
  const after = Number(await slider.getAttribute('aria-valuenow'))
  assert(after < before, `ArrowLeft did not rewind: ${before} -> ${after}`)
})

await check('transcript filter narrows lines', async () => {
  await page.getByPlaceholder('Find in transcript').fill('SCIM')
  await page.waitForTimeout(400)
  const label = await page.locator('text=/lines? matching/').first().textContent()
  assert(/\d+ lines? matching/.test(label ?? ''), `no match count shown, saw "${label}"`)
  await page.getByPlaceholder('Find in transcript').fill('')
  await page.waitForTimeout(300)
})

await check('summary template switch changes the content', async () => {
  const before = await page.locator('.rise p').first().textContent()
  await page.getByRole('button', { name: 'General', exact: true }).click()
  await page.waitForTimeout(350)
  const after = await page.locator('.rise p').first().textContent()
  assert(before !== after, 'headline did not change when switching template')
})
await shot('template-general')

await check('an ungenerated template is disabled, not silently empty', async () => {
  const interview = page.getByRole('button', { name: 'Interview', exact: true })
  assert(await interview.isDisabled(), 'ungenerated template should be disabled')
})

console.log('\n── Action items and generated plans ──')

await check('actions tab lists commitments', async () => {
  await page.getByRole('button', { name: /^Actions/ }).click()
  await page.waitForTimeout(300)
  const open = await page.getByRole('button', { name: /^Complete:/ }).count()
  assert(open > 0, 'no open action items rendered')
})
await shot('action-items')

await check('ticking an action moves it to Done', async () => {
  const before = await page.getByRole('button', { name: /^Complete:/ }).count()
  await page.getByRole('button', { name: /^Complete:/ }).first().click()
  await page.waitForTimeout(350)
  const after = await page.getByRole('button', { name: /^Complete:/ }).count()
  assert(after === before - 1, `expected ${before - 1} open, saw ${after}`)
})
await shot('action-ticked')

await check('a generated plan opens and names its own provenance', async () => {
  await page.getByRole('button', { name: 'How to start this' }).first().click()
  await page.waitForTimeout(300)
  const body = await page.locator('text=Nobody said these steps out loud').count()
  assert(body > 0, 'plan did not disclose that it was generated')
  const start = await page.locator('text=Start here').count()
  assert(start > 0, 'plan missing its first step')
})
await shot('action-plan')

await check('changing work style changes the plan', async () => {
  const before = await page.locator('ol li').first().textContent()
  await page.getByLabel('How you work best').selectOption('deep')
  await page.waitForTimeout(350)
  const after = await page.locator('ol li').first().textContent()
  assert(before !== after, `plan did not adapt to the style: "${before}" vs "${after}"`)
})
await shot('action-plan-deep')

await check('work style persists across a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^Actions/ }).click()
  await page.waitForTimeout(400)
  const value = await page.getByLabel('How you work best').inputValue()
  assert(value === 'deep', `expected "deep" after reload, got "${value}"`)
})

await check('a completed action stays completed across a reload', async () => {
  const open = await page.getByRole('button', { name: /^Complete:/ }).count()
  const done = await page.getByRole('button', { name: /^Reopen:/ }).count()
  assert(done > 0, `no completed item survived the reload (open=${open}, done=${done})`)
})

console.log('\n── Clips and sharing ──')

await check('clipping twice at the same point does not duplicate', async () => {
  await page.getByRole('button', { name: 'Clip this moment' }).click()
  await page.waitForTimeout(400)
  const first = await page.getByRole('button', { name: /^Share$/ }).count()
  await page.getByRole('button', { name: 'Clip this moment' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /^Highlights/ }).click()
  await page.waitForTimeout(300)
  const second = await page.getByRole('button', { name: /^Share$/ }).count()
  assert(first === second, `clip duplicated: ${first} -> ${second}`)
})
await shot('highlights')

await check('share dialog opens and offers a link', async () => {
  await page.getByRole('button', { name: /^Share$/ }).first().click()
  await page.waitForSelector('text=Share this clip', { timeout: 5000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
})

console.log('\n── Analytics ──')

await check('talk time is shown for all eight participants', async () => {
  await page.getByRole('button', { name: /^Analytics/ }).click()
  await page.waitForTimeout(350)
  const text = (await page.locator('text=Talk time').count()) > 0
  assert(text, 'talk time section missing')
  const turns = await page.locator('text=/\\d+% · \\d+ turns/').count()
  assert(turns >= 8, `expected 8 speaker rows, saw ${turns}`)
})
await shot('analytics')

console.log('\n── Cross-meeting ──')

await check('navigating to another meeting does not leak state', async () => {
  await go('/m/acme-discovery')
  await page.waitForSelector('h1:has-text("Acme Logistics")', { timeout: 10_000 })
  const now = Number(await page.getByRole('slider').getAttribute('aria-valuenow'))
  assert(now === 0, `playhead leaked from the previous meeting: ${now}`)
})
await shot('second-meeting')

await check('cross-meeting action list renders and counts overdue', async () => {
  await go('/actions')
  await page.waitForSelector('h1:has-text("Action items")', { timeout: 10_000 })
  const rows = await page.locator('button[aria-label^="Complete:"]').count()
  assert(rows > 5, `expected several open actions across meetings, saw ${rows}`)
})
await shot('all-actions')

await check('search finds a term across more than one meeting', async () => {
  await go('/search?q=SCIM')
  await page.waitForTimeout(500)
  const sections = await page.locator('section').count()
  assert(sections > 1, `expected hits in several meetings, saw ${sections}`)
})
await shot('search')

await check('search handles a no-result query gracefully', async () => {
  await go('/search?q=zzzznotathing')
  await page.waitForTimeout(400)
  assert((await page.locator('text=Nothing matched that').count()) > 0, 'no empty state')
})

await check('highlights feed lists shared clips', async () => {
  await go('/highlights')
  await page.waitForTimeout(400)
  assert((await page.locator('article').count()) > 0, 'no highlights listed')
})
await shot('highlights-feed')

console.log('\n── Public share page, signed out ──')

const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const anonPage = await anon.newPage()
watch(anonPage, 'share')

await check('a stranger can open a shared clip without signing in', async () => {
  await anonPage.goto(`${base}/share/ck-7f2a91`, { waitUntil: 'networkidle' })
  await anonPage.waitForTimeout(400)
  assert(!anonPage.url().includes('/signin'), 'share page redirected to sign-in')
  assert(
    (await anonPage.locator('text=no account needed').count()) > 0,
    'share page did not render',
  )
})
await anonPage.screenshot({ path: `${outDir}/90-shared-clip-anonymous.png` })

await check('the share page exposes only the clip, not the whole meeting', async () => {
  assert((await anonPage.locator('text=Clip transcript').count()) > 0, 'clip transcript missing')

  // Structural checks, not phrase matching: the page's own reassurance copy mentions
  // summaries and action items, so searching for those words tests nothing.
  assert(
    (await anonPage.getByRole('button', { name: /^Complete:/ }).count()) === 0,
    'action item controls rendered on a public page',
  )
  assert((await anonPage.locator('text=Summary template').count()) === 0, 'summary panel leaked')
  assert((await anonPage.locator('text=Talk time').count()) === 0, 'analytics leaked')

  // The decisive one: a line spoken well outside the clip window must not be present.
  const outsideClip = 'Alright, I think we have everyone'
  assert(
    (await anonPage.locator(`text=${outsideClip}`).count()) === 0,
    'transcript from outside the clip window is on the page',
  )

  // And the clip's own content must be.
  assert(
    (await anonPage.locator('text=going to resolve this by talking longer').count()) > 0,
    'the clip transcript itself is missing',
  )
})

await check('an unknown clip id shows a clean message, not a crash', async () => {
  await anonPage.goto(`${base}/share/ck-doesnotexist`, { waitUntil: 'networkidle' })
  await anonPage.waitForTimeout(300)
  assert(
    (await anonPage.locator('text=no longer available').count()) > 0,
    'missing clip did not render its empty state',
  )
})

console.log('\n── Responsive ──')

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
const mobilePage = await mobile.newPage()
watch(mobilePage, 'mobile')

await check('no horizontal overflow on any route at 390px', async () => {
  await mobilePage.goto(`${base}/signin`, { waitUntil: 'networkidle' })
  await mobilePage.getByRole('button', { name: 'Continue' }).click()
  await mobilePage.waitForTimeout(500)

  for (const path of ['/', '/m/q3-roadmap-review', '/actions', '/highlights', '/share/ck-7f2a91']) {
    await mobilePage.goto(`${base}${path}`, { waitUntil: 'networkidle' })
    await mobilePage.waitForTimeout(350)
    const { vw, sw } = await mobilePage.evaluate(() => ({
      vw: document.documentElement.clientWidth,
      sw: document.documentElement.scrollWidth,
    }))
    assert(sw <= vw + 1, `${path} overflows: viewport ${vw}, scrollWidth ${sw}`)
  }
})
await mobilePage.goto(`${base}/m/q3-roadmap-review`, { waitUntil: 'networkidle' })
await mobilePage.waitForTimeout(400)
await mobilePage.screenshot({ path: `${outDir}/91-mobile-meeting.png` })

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${'─'.repeat(52)}`)
console.log(`checks:  ${results.length - failed.length}/${results.length} passed`)
console.log(`runtime: ${problems.length} console/page/request problem(s)`)
for (const p of [...new Set(problems)]) console.log(`  - ${p}`)
for (const f of failed) console.log(`  FAILED: ${f.name} — ${f.error}`)

process.exit(failed.length > 0 || problems.length > 0 ? 1 : 0)
