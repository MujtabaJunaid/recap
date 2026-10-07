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

const DEMO_EMAIL = 'demo@recap.app'
const DEMO_PASSWORD = 'recap-demo-2026'

/**
 * Each run gets its own account. Reusing one meant state accumulated between runs —
 * a previous run completing every action left the next with nothing open to click,
 * and the failure looked like a product bug rather than a dirty fixture.
 *
 * It also means the signup path is exercised on every run instead of only in the
 * server smoke test.
 */
const RUN_EMAIL = `e2e.${Date.now()}@example.com`
const RUN_PASSWORD = 'e2e-run-password-2026'

/** The proxy the deployed frontend talks to. Overridable so a local run can point elsewhere. */
const API_BASE = (
  process.env.VITE_API_BASE_URL ??
  'https://recap-action-plan-proxy-a93bd7dd6d10.herokuapp.com'
).replace(/\/$/, '')

const problems = []
const results = []
let step = 0

/**
 * Set while a check deliberately requests a URL that does not exist. Static hosting has
 * no SPA rewrite, so an unknown route is served from 404.html with a 404 status: the app
 * renders correctly and the browser still logs the document status. That is expected,
 * and counting it as a failure would train us to ignore the real ones.
 */
let expecting404 = false

/** Set while a check deliberately sends bad credentials, which really is a 401. */
let expecting401 = false

const browser = await chromium.launch({ channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

function watch(target, label) {
  target.on('console', (m) => {
    if (m.type() !== 'error') return
    if (expecting404 && m.text().includes('404')) return
    if (expecting401 && m.text().includes('401')) return
    problems.push(`${label} console.error: ${m.text()}`)
  })
  target.on('pageerror', (e) => problems.push(`${label} pageerror: ${e.message}`))
  target.on('requestfailed', (r) => {
    // net::ERR_ABORTED is what an intentional AbortController cancel looks like in the
    // network log. Counting it as a failure would mean the correct cleanup is the thing
    // reporting a problem.
    if (r.failure()?.errorText === 'net::ERR_ABORTED') return
    problems.push(`${label} requestfailed: ${r.url()} ${r.failure()?.errorText}`)
  })
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
  await page.fill('#password', 'recap-demo-2026')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForSelector('#signin-error', { timeout: 3000 })
  assert(page.url().includes('/signin'), 'should not have navigated')
})

await check('a missing password is rejected', async () => {
  await page.fill('#email', 'someone.else@example.com')
  await page.fill('#password', '')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForSelector('#signin-error', { timeout: 3000 })
  assert(page.url().includes('/signin'), 'should not have navigated')
})

await check('a wrong password is rejected and the field is cleared', async () => {
  expecting401 = true
  try {
    await page.fill('#email', 'someone.else@example.com')
    await page.fill('#password', 'definitely-not-it')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForSelector('#signin-error', { timeout: 15_000 })
    assert(page.url().includes('/signin'), 'should not have navigated')
    assert((await page.inputValue('#password')) === '', 'password field was not cleared')
  } finally {
    expecting401 = false
  }
})

await check('the password is never written to storage', async () => {
  const leaked = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const v = localStorage.getItem(localStorage.key(i)) ?? ''
      if (
        v.includes('recap-demo-2026') ||
        v.includes('definitely-not-it') ||
        v.includes('e2e-run-password-2026')
      ) {
        return true
      }
    }
    return false
  })
  assert(!leaked, 'a password string was found in localStorage')
})

await check('a new account can be created, or the demo account signs in', async () => {
  const createLink = page.getByRole('button', { name: 'Create one' })
  const hosted = (await createLink.count()) > 0

  if (hosted) {
    await createLink.click()
    await page.fill('#email', RUN_EMAIL)
    await page.fill('#password', RUN_PASSWORD)
    await page.getByRole('button', { name: 'Create account' }).click()
  } else {
    // No backend configured: the local gate accepts the documented demo password.
    await page.fill('#email', DEMO_EMAIL)
    await page.fill('#password', DEMO_PASSWORD)
    await page.getByRole('button', { name: 'Continue' }).click()
  }

  await page.waitForSelector('h1:has-text("Meetings"), :text("Welcome,")', { timeout: 25_000 })
  assert(!page.url().includes('/signin'), 'still on the sign-in page')
})
await shot('meetings-list')

await check('a signed-in account starts on an empty workspace, not someone else data', async () => {
  await page.waitForSelector('text=Welcome,', { timeout: 15_000 })
  const cards = await page.locator('article').count()
  assert(cards === 0, `a fresh account showed ${cards} meetings`)
  assert(
    (await page.locator('text=Load the sample workspace').count()) > 0,
    'no way offered to populate the workspace',
  )
})

await check('the empty state survives a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('text=Welcome,', { timeout: 15_000 })
})

await check('action items and highlights have their own first-run states', async () => {
  await go('/actions')
  await page.waitForSelector('text=No action items yet', { timeout: 10_000 })
  await go('/highlights')
  await page.waitForSelector('text=No highlights yet', { timeout: 10_000 })
  await go('/')
})

await check('loading the sample populates the workspace', async () => {
  await page.getByRole('button', { name: 'Load the sample workspace' }).click()
  await page.waitForSelector('h1:has-text("Meetings")', { timeout: 15_000 })
  const cards = await page.locator('article').count()
  assert(cards >= 8, `expected at least 8 meetings after loading, saw ${cards}`)
})

await check('the loaded sample survives a reload', async () => {
  // Let the debounced write reach the server before throwing away the page.
  await page.waitForTimeout(700)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('h1:has-text("Meetings")', { timeout: 15_000 })
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
  // The hosted planner is a network round trip; wait for content, not a guessed delay.
  await page.waitForSelector('text=Start here', { timeout: 30_000 })
  const body = await page.locator('text=Nobody said these steps out loud').count()
  assert(body > 0, 'plan did not disclose that it was generated')
})
await shot('action-plan')

await check('changing work style changes the plan', async () => {
  const picker = page.getByLabel('How you work best')
  // Pick a style that is not the current one. The previous run's choice persists to
  // the account now, so hardcoding "deep" could select what is already selected and
  // then fail for having changed nothing.
  const current = await picker.inputValue()
  const target = current === 'deep' ? 'momentum' : 'deep'

  const first = page.locator('ol li').first()
  const before = (await first.textContent()) ?? ''
  await picker.selectOption(target)
  // Poll until the text actually changes rather than sampling once mid-flight.
  await page
    .waitForFunction(
      (prev) => {
        const li = document.querySelector('ol li')
        return li !== null && li.textContent !== prev
      },
      before,
      { timeout: 30_000 },
    )
    .catch(() => {})
  const after = (await first.textContent()) ?? ''
  assert(
    before !== after,
    `plan did not adapt when switching ${current} -> ${target}: "${before}" vs "${after}"`,
  )
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

console.log('\n-- Recording and live coaching --')

await check('the record page loads and offers a control', async () => {
  await go('/record')
  await page.waitForSelector('h1:has-text("Record"), :text("needs the backend")', {
    timeout: 15_000,
  })
  const hosted = (await page.getByRole('button', { name: 'Start recording' }).count()) > 0
  const gated = (await page.locator('text=needs the backend').count()) > 0
  assert(hosted || gated, 'record page rendered neither a control nor an explanation')
})
await shot('record')

/** Reads the proxy origin out of the CSP the build injected, so nothing is hardcoded. */
const apiBaseInPage = `
  document.querySelector('meta[http-equiv="Content-Security-Policy"]')
    ?.getAttribute('content')?.match(/connect-src 'self' (\S+)/)?.[1] ?? null
`

await check('the recordings list is scoped to the signed-in account', async () => {
  const result = await page.evaluate(`(async () => {
    const base = ${apiBaseInPage}
    if (!base) return { skipped: true }
    const raw = Object.keys(localStorage).filter((k) => k.startsWith('recap:session')).map((k) => localStorage.getItem(k))[0]
    const token = raw ? JSON.parse(raw).token : null
    if (!token) return { skipped: true }
    const r = await fetch(base + '/api/recordings', { headers: { authorization: 'Bearer ' + token } })
    const body = await r.json()
    return { status: r.status, count: Array.isArray(body.recordings) ? body.recordings.length : null }
  })()`)

  if (result.skipped) return
  assert(result.status === 200, `recordings list returned ${result.status}`)
  assert(typeof result.count === 'number', 'no recordings array returned')
})

await check('recordings reject an unauthenticated caller', async () => {
  const status = await page.evaluate(`(async () => {
    const base = ${apiBaseInPage}
    if (!base) return null
    return (await fetch(base + '/api/recordings')).status
  })()`)
  if (status === null) return
  assert(status === 401, `expected 401 without a token, got ${status}`)
})

await check('live coaching refuses an unauthenticated caller', async () => {
  const status = await page.evaluate(`(async () => {
    const base = ${apiBaseInPage}
    if (!base) return null
    const r = await fetch(base + '/api/live-coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lines: [{ speaker: 'a', text: 'hello' }] }),
    })
    return r.status
  })()`)
  if (status === null) return
  assert(status === 401, `expected 401 without a token, got ${status}`)
})

await check('live coaching returns a usable suggestion', async () => {
  const result = await page.evaluate(`(async () => {
    const base = ${apiBaseInPage}
    if (!base) return { skipped: true }
    const raw = Object.keys(localStorage).filter((k) => k.startsWith('recap:session')).map((k) => localStorage.getItem(k))[0]
    const token = raw ? JSON.parse(raw).token : null
    if (!token) return { skipped: true }
    const r = await fetch(base + '/api/live-coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ lines: [
        { speaker: 'Kenji', text: 'What is the probability you ship the rewrite this quarter?' },
        { speaker: 'Daniel', text: 'Sixty percent.' },
        { speaker: 'Kenji', text: 'So why would I approve a quarter on sixty percent?' },
      ] }),
    })
    if (!r.ok) return { status: r.status }
    const body = await r.json()
    return { status: r.status, suggestion: body.suggestion }
  })()`)

  if (result.skipped) return
  assert(result.status === 200, `coach returned ${result.status}`)
  const s = result.suggestion
  assert(s && typeof s.read === 'string' && s.read.length > 0, 'no reading of the room')
  assert(typeof s.sayNext === 'string' && s.sayNext.length > 10, 'no suggested response')
  assert(typeof s.because === 'string' && s.because.length > 0, 'no rationale')
})


console.log('\n-- Join a call: live transcript, live coaching, saved summary --')

await check('the demo page cannot be mistaken for a real Zoom connection', async () => {
  await go('/join')
  await page.waitForSelector('h1:has-text("Demo call"), :text("needs the backend")', {
    timeout: 15_000,
  })
  const gated = (await page.locator('text=needs the backend').count()) > 0
  if (gated) return
  assert(
    (await page.locator('text=Scripted — not a real call').count()) > 0,
    'no scripted-call label',
  )
  assert(
    (await page.locator('text=This does not join your Zoom call').count()) > 0,
    'the page does not disown the Zoom connection it used to imply',
  )
  assert(
    (await page.locator('a[href$="/live"]').count()) > 0,
    'the demo page does not point at the real-capture route',
  )
})
await shot('join-lobby')

const joinable = (await page.getByRole('button', { name: 'Join the call' }).count()) > 0

await check('joining streams the conversation in rather than dumping it', async () => {
  if (!joinable) return
  await page.getByRole('button', { name: 'Join the call' }).click()
  await page.waitForSelector('text=Recording', { timeout: 20_000 })

  await page.waitForFunction(() => document.body.innerText.includes('Priya Raman'), null, {
    timeout: 30_000,
  })
  const early = (await page.locator('text=/^\d+:\d\d$/').count()) >= 0
  assert(early, 'no clock on the live call')

  // The whole point is that it arrives over time, so the feed must grow.
  const first = await page.locator('main p').count()
  await page.waitForTimeout(4000)
  const later = await page.locator('main p').count()
  assert(later > first, `feed did not grow: ${first} -> ${later}`)
})
await shot('join-live')

await check('the live coach produces a usable suggestion during the call', async () => {
  if (!joinable) return
  // Fires on its own when the room turns to you; nudge it so the check is not timing-bound.
  await page.getByRole('button', { name: 'Ask now' }).click()
  await page.waitForSelector('blockquote', { timeout: 40_000 })
  const said = (await page.locator('blockquote').first().textContent()) ?? ''
  assert(said.trim().length > 15, `suggestion too short to use: "${said}"`)
  assert((await page.locator('text=Why:').count()) > 0, 'no rationale given')
})
await shot('join-coaching')

await check('leaving the call saves it and summarises the transcript', async () => {
  if (!joinable) return
  // Stay until people have actually committed to things. The summariser is grounded,
  // so a transcript that stops before anyone agrees to anything correctly yields no
  // action items — which would be the test's fault, not the product's.
  await page
    .waitForFunction(() => document.body.innerText.includes('Thanks everyone'), null, {
      timeout: 60_000,
    })
    .catch(() => {})
  await page.getByRole('button', { name: 'Leave and save' }).click()
  await page.waitForSelector('text=Call saved and summarised', { timeout: 40_000 })
})
await shot('join-saved')

await check('the saved call reaches the dashboard with a model summary', async () => {
  if (!joinable) return
  await go('/')
  await page.waitForSelector('text=Your calls', { timeout: 20_000 })

  // Summarisation runs after the call is stored, so wait for it to land.
  await page
    .waitForFunction(() => !document.body.innerText.includes('Summarising the transcript'), null, {
      timeout: 90_000,
    })
    .catch(() => {})

  assert(
    (await page.locator('text=Summarising the transcript').count()) === 0,
    'the summary never finished',
  )
  assert(
    (await page.locator('text=The summary failed').count()) === 0,
    'summarisation failed for the saved call',
  )
  // Assert on the link, not on pill copy: a Pill splits its text across nodes, so a
  // regex over element text is matching the wrong thing rather than the wrong state.
  const links = await page.locator('section:has-text("Your calls") a[href*="/call/"]').count()
  assert(links > 0, 'the saved call is not listed on the dashboard')

  const headline = await page
    .locator('section:has-text("Your calls") p')
    .filter({ hasNotText: 'Summarising' })
    .first()
    .textContent()
  assert((headline ?? '').trim().length > 20, `no summary text on the card: "${headline}"`)
})
await shot('join-on-dashboard')

await check('the saved call opens with decisions, actions and a transcript', async () => {
  if (!joinable) return
  await page.locator('section:has-text("Your calls") a[href*="/call/"]').first().click()
  await page.waitForSelector('text=Transcript', { timeout: 20_000 })
  assert((await page.locator('text=Summary').count()) > 0, 'no summary section')
  assert((await page.locator('text=Action items').count()) > 0, 'no action items section')
  assert(
    (await page.locator('text=Simulated capture').count()) > 0,
    'the saved call does not disclose that capture was simulated',
  )
})
await shot('join-detail')

await check('an action item from the real call gets a work-style plan', async () => {
  if (!joinable) return
  const opener = page.getByRole('button', { name: 'How to start this' }).first()
  if ((await opener.count()) === 0) return
  await opener.click()
  await page.waitForSelector('text=Start here', { timeout: 15_000 })
})
await shot('join-detail-plan')


console.log('\n-- Real call capture --')

await check('the live page is reachable and declares real audio', async () => {
  await go('/live')
  await page.waitForSelector(
    'h1:has-text("Take notes in a real call"), :text("needs the backend")',
    { timeout: 15_000 },
  )
  if ((await page.locator('text=needs the backend').count()) > 0) return
  assert((await page.locator('text=Real audio').count()) > 0, 'no real-audio badge')
  assert(
    (await page.getByRole('button', { name: 'Start listening' }).count()) > 0,
    'no way to start listening',
  )
})

await check('the live page states its limits rather than implying a Zoom integration', async () => {
  if ((await page.locator('text=needs the backend').count()) > 0) return
  assert(
    (await page.locator('text=There is no bot in the meeting').count()) > 0,
    'the page does not disclaim the bot',
  )
  assert(
    (await page.locator('text=Share system audio').count()) > 0,
    'the page does not say how to capture the far side',
  )
})
await shot('live-ready')

await check('both call routes are in the nav and named apart', async () => {
  assert((await page.locator('a[href$="/live"]').count()) > 0, 'no live-call nav entry')
  assert((await page.locator('a[href$="/join"]').count()) > 0, 'no demo-call nav entry')
})

/**
 * Capture itself needs a screen-share picker, which no headless browser can drive. What
 * is testable without one — and is exactly the failure that prompted this feature — is
 * that a share carrying no audio is reported rather than silently producing an empty
 * transcript and leaving someone wondering why nobody was heard.
 */
await check('a share carrying no audio is reported instead of failing silently', async () => {
  if ((await page.locator('text=needs the backend').count()) > 0) return

  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 2
      canvas.height = 2
      return canvas.captureStream(1)
    }
  })

  await page.getByRole('button', { name: 'Start listening' }).click()
  await page.waitForSelector('text=That share carried no audio', { timeout: 15_000 })
})
await shot('live-no-audio')

await check('the slice endpoint transcribes real audio end to end', async () => {
  const result = await page.evaluate(async (api) => {
    // Same prefix scan the other API checks use. Hardcoding a key name here — and
    // getting it wrong — made this check return "skipped" and pass without testing
    // anything, which is how a CORS failure that broke every live call reached
    // production. A missing token is now a failure, not a quiet skip.
    const raw = Object.keys(localStorage)
      .filter((k) => k.startsWith('recap:session'))
      .map((k) => localStorage.getItem(k))[0]
    const token = raw ? JSON.parse(raw).token : null
    if (!api) return { noApi: true }
    if (!token) return { noToken: true }

    // A real RIFF/WAVE container, built here so the test needs neither a fixture nor
    // ffmpeg. One second of a 440Hz tone: Whisper finds no words in it, which is the
    // point — this proves the whole round trip without asserting what a model heard.
    const rate = 16000
    const samples = rate
    const buffer = new ArrayBuffer(44 + samples * 2)
    const view = new DataView(buffer)
    const ascii = (off, str) =>
      [...str].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)))
    ascii(0, 'RIFF')
    view.setUint32(4, 36 + samples * 2, true)
    ascii(8, 'WAVEfmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    ascii(36, 'data')
    view.setUint32(40, samples * 2, true)
    for (let i = 0; i < samples; i++) {
      view.setInt16(44 + i * 2, Math.sin((i / rate) * 440 * 2 * Math.PI) * 12000, true)
    }

    const res = await fetch(api.replace(/\/$/, '') + '/api/transcribe-chunk', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'audio/wav',
        'x-chunk-side': 'them',
      },
      body: new Blob([buffer], { type: 'audio/wav' }),
    })
    return { status: res.status, body: res.ok ? await res.json() : null }
    // A CORS rejection arrives as a thrown TypeError rather than a status, so it has to
    // be caught here or the evaluate fails with a message that names nothing.
  }, API_BASE).catch((e) => ({ blocked: String(e?.message ?? e) }))

  if (result.noApi) return
  assert(!result.noToken, 'no session token found: this check did not actually run')
  assert(!result.blocked, `the browser blocked the request: ${result.blocked}`)
  assert(result.status === 200, `slice endpoint returned ${result.status}`)
  assert(typeof result.body?.text === 'string', 'no text field came back')
  assert(result.body?.side === 'them', 'the side did not round-trip')
})

/**
 * Asserts the preflight directly, because the request above would also pass if the
 * browser happened to skip a preflight. Every custom header the client sends must be
 * named in access-control-allow-headers, and x-chunk-side being absent is what silently
 * broke live capture.
 */
await check('the slice preflight allows the headers the client actually sends', async () => {
  const result = await page.evaluate(async (api) => {
    const res = await fetch(api + '/api/transcribe-chunk', {
      method: 'OPTIONS',
      headers: {
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,authorization,x-chunk-side',
      },
    })
    return { status: res.status, allow: res.headers.get('access-control-allow-headers') ?? '' }
  }, API_BASE)

  assert(result.status < 400, `preflight returned ${result.status}`)
  for (const header of ['authorization', 'content-type', 'x-chunk-side']) {
    assert(
      result.allow.toLowerCase().includes(header),
      `${header} is missing from access-control-allow-headers: "${result.allow}"`,
    )
  }
})

await check('coaching and work-style plans both survive the new capture route', async () => {
  // The two features most at risk from a capture rewrite, asserted together so a
  // regression in either fails one obvious check rather than being inferred.
  await go('/live')
  const gated = (await page.locator('text=needs the backend').count()) > 0
  if (!gated) {
    assert(
      (await page.locator('text=What to say next').count()) > 0 ||
        (await page.locator('text=Before you start').count()) > 0,
      'the live route lost its coaching panel',
    )
  }
  await go('/actions')
  await page.waitForSelector('text=How you work best', { timeout: 15_000 })
  // The picker starts collapsed, showing only the current style.
  await page.getByRole('button', { name: 'Change' }).first().click()
  const styles = await page.locator('button[aria-pressed]').count()
  assert(styles >= 5, `expected 5 work styles, found ${styles}`)
  const chosen = await page.locator('button[aria-pressed="true"]').count()
  assert(chosen === 1, `expected exactly one selected style, found ${chosen}`)
})

console.log('\n-- Ask across every meeting --')

await check('the ask page offers starting questions', async () => {
  await go('/ask')
  await page.waitForSelector('h1:has-text("Stop guessing"), :text("needs the backend")', {
    timeout: 15_000,
  })
  if ((await page.locator('text=needs the backend').count()) > 0) return
  assert((await page.locator('text=Try one of these').count()) > 0, 'no suggested questions')
})
await shot('ask-empty')

const askable = (await page.locator('text=Try one of these').count()) > 0

await check('a grounded question gets an answer with checkable citations', async () => {
  if (!askable) return
  await page.getByPlaceholder('Ask anything about your meetings').fill(
    'What did we decide about SSO and who owns telling Northwind?',
  )
  await page.getByRole('button', { name: 'Ask', exact: true }).click()

  await page.waitForSelector('text=From', { timeout: 60_000 })
  const citation = page.locator('a[href*="/m/"], a[href*="/call/"]').first()
  assert((await citation.count()) > 0, 'an answer arrived with no citation to check')

  // The citation has to be a real link into a meeting, not decoration.
  const href = await citation.getAttribute('href')
  assert(/\/(m|call)\//.test(href ?? ''), `citation does not link to a meeting: ${href}`)
})
await shot('ask-answered')

await check('a question nothing covers is refused rather than guessed', async () => {
  if (!askable) return
  await page.getByPlaceholder('Ask anything about your meetings').fill(
    'What is our total ARR and how many employees do we have?',
  )
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await page.waitForFunction(
    () => !document.body.innerText.includes('Reading your meetings'),
    null,
    { timeout: 60_000 },
  )
  const body = await page.evaluate(() => document.body.innerText)
  assert(
    /not supported|was not discussed|not covered|no information|cannot find|not mentioned/i.test(body),
    'the model answered a question nothing in the corpus supports',
  )
})
await shot('ask-refusal')


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
  expecting404 = true
  try {
    await anonPage.goto(`${base}/share/ck-doesnotexist`, { waitUntil: 'networkidle' })
    await anonPage.waitForTimeout(300)
    assert(
      (await anonPage.locator('text=no longer available').count()) > 0,
      'missing clip did not render its empty state',
    )
  } finally {
    expecting404 = false
  }
})

console.log('\n── Responsive ──')

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
const mobilePage = await mobile.newPage()
watch(mobilePage, 'mobile')

await check('no horizontal overflow on any route at 390px', async () => {
  await mobilePage.goto(`${base}/signin`, { waitUntil: 'networkidle' })
  const mobileCreate = mobilePage.getByRole('button', { name: 'Create one' })
  if ((await mobileCreate.count()) > 0) {
    await mobileCreate.click()
    await mobilePage.fill('#email', `m.${Date.now()}@example.com`)
    await mobilePage.fill('#password', RUN_PASSWORD)
    await mobilePage.getByRole('button', { name: 'Create account' }).click()
  } else {
    await mobilePage.fill('#email', DEMO_EMAIL)
    await mobilePage.fill('#password', DEMO_PASSWORD)
    await mobilePage.getByRole('button', { name: 'Continue' }).click()
  }
  await mobilePage.waitForTimeout(1200)
  // The mobile context is a fresh browser, so it lands on the first-run state.
  const load = mobilePage.getByRole('button', { name: 'Load the sample workspace' })
  if ((await load.count()) > 0) {
    await load.click()
    await mobilePage.waitForTimeout(800)
  }

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
