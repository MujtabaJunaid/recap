#!/usr/bin/env node
/**
 * Boots the real server on a random port with throwaway config and exercises the
 * security-critical paths. Runs in CI before any deploy.
 *
 * It does not call the model: GROQ_API_KEY is deliberately absent, so a plan request
 * gets as far as auth and validation and then fails upstream. That is the point —
 * everything this test cares about happens before the provider is reached.
 */
import { spawn } from 'node:child_process'
import { randomBytes, scryptSync } from 'node:crypto'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 3100 + Math.floor(Math.random() * 400)
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'smoke-test-password'
const ORIGIN = 'https://allowed.example.com'

const salt = randomBytes(16)
const hash = `${salt.toString('hex')}:${scryptSync(PASSWORD, salt, 64, { N: 16384 }).toString('hex')}`

const CWD = dirname(fileURLToPath(import.meta.url))
const SECRET = randomBytes(32).toString('hex')

/**
 * Two instances. The functional checks need generous limits or the rate limiter sheds
 * them and every assertion reports the wrong reason; the limiter itself is then tested
 * against a deliberately tight instance. Tuning via config beats a test-only backdoor
 * in production code.
 */
function start(port, limits) {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: CWD,
    env: {
      ...process.env,
      PORT: String(port),
      AUTH_SECRET: SECRET,
      ALLOWED_ORIGINS: ORIGIN,
      GROQ_API_KEY: '',
      // Nothing sits in front of the test server, so x-forwarded-for is untrusted.
      TRUSTED_PROXY_HOPS: '0',
      ...limits,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  return { child, readLog: () => log }
}

const main = start(PORT, { RATE_LIMIT_PER_SEC: '1000', RATE_LIMIT_BURST: '1000' })
const server = main.child
const STRICT_PORT = PORT + 1
const strict = start(STRICT_PORT, { RATE_LIMIT_PER_SEC: '0.2', RATE_LIMIT_BURST: '3' })

const serverLogOf = () => main.readLog()

const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  PASS  ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: error.message })
    console.log(`  FAIL  ${name}\n        ${error.message}`)
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m)
}

const post = (path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  })

async function waitForBoot(base = BASE) {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/health`)
      if (r.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`server did not start\n${main.readLog()}`)
}

try {
  await waitForBoot()
  await waitForBoot(`http://127.0.0.1:${STRICT_PORT}`)

  await check('health reports auth configured', async () => {
    const body = await (await fetch(`${BASE}/health`)).json()
    assert(body.ok === true, 'health not ok')
    assert(body.authConfigured === true, 'auth not configured')
  })

  await check('health never reveals the key or the hash', async () => {
    const text = await (await fetch(`${BASE}/health`)).text()
    assert(!text.includes(hash), 'password hash leaked in health')
    assert(!/gsk_|sk-/.test(text), 'key-shaped string in health')
  })

  await check('unknown route is 404', async () => {
    const r = await fetch(`${BASE}/admin`)
    assert(r.status === 404, `got ${r.status}`)
  })

  await check('disallowed origin is refused', async () => {
    const r = await post('/api/auth/login', { email: 'a@b.co', password: PASSWORD }, { origin: 'https://evil.example.com' })
    assert(r.status === 403, `got ${r.status}`)
  })

  await check('wrong password is 401', async () => {
    const r = await post('/api/auth/login', { email: 'a@b.co', password: 'nope' })
    assert(r.status === 401, `got ${r.status}`)
  })


  await check('bad email shape is 400', async () => {
    const r = await post('/api/auth/login', { email: 'notanemail', password: PASSWORD })
    assert(r.status === 400, `got ${r.status}`)
  })

  await check('a bad email and a bad password are indistinguishable', async () => {
    const a = await post('/api/auth/login', { email: 'nobody@nowhere.co', password: 'nope' })
    const b = await post('/api/auth/login', { email: 'a@b.co', password: 'nope' })
    assert(a.status === b.status, `enumeration: ${a.status} vs ${b.status}`)
    assert((await a.text()) === (await b.text()), 'response bodies differ')
  })

  // Every credential now belongs to an account, so the auth checks need one.
  const BASE_EMAIL = `base.${Date.now()}@example.com`
  let token = ''

  await check('an account can be created and signs in', async () => {
    const created = await post('/api/auth/signup', { email: BASE_EMAIL, password: PASSWORD })
    assert(created.status === 201, `signup got ${created.status}`)

    const r = await post('/api/auth/login', { email: BASE_EMAIL, password: PASSWORD })
    assert(r.status === 200, `login got ${r.status}`)
    const body = await r.json()
    assert(typeof body.token === 'string' && body.token.includes('.'), 'no token')
    token = body.token
  })

  await check('the login response never echoes the password', async () => {
    const r = await post('/api/auth/login', { email: BASE_EMAIL, password: PASSWORD })
    const text = await r.text()
    assert(!text.includes(PASSWORD), 'password echoed back')
  })

  await check('plan without a token is 401', async () => {
    const r = await post('/api/action-plan', { actionText: 'x', meetingTitle: 'y', transcriptExcerpt: 'z', style: 'momentum' })
    assert(r.status === 401, `got ${r.status}`)
  })

  await check('plan with a tampered token is 401', async () => {
    const bad = `${token.slice(0, -2)}XX`
    const r = await post(
      '/api/action-plan',
      { actionText: 'x', meetingTitle: 'y', transcriptExcerpt: 'z', style: 'momentum' },
      { authorization: `Bearer ${bad}` },
    )
    assert(r.status === 401, `got ${r.status}`)
  })

  await check('a self-issued token is rejected', async () => {
    const forged = `${Buffer.from(JSON.stringify({ sub: 'attacker@evil.co', exp: 2000000000 })).toString('base64url')}.notavalidmac`
    const r = await post(
      '/api/action-plan',
      { actionText: 'x', meetingTitle: 'y', transcriptExcerpt: 'z', style: 'momentum' },
      { authorization: `Bearer ${forged}` },
    )
    assert(r.status === 401, `got ${r.status}`)
  })

  await check('an expired token is rejected', async () => {
    const expired = `${Buffer.from(JSON.stringify({ sub: 'a@b.co', exp: 1 })).toString('base64url')}.whatever`
    const r = await post(
      '/api/action-plan',
      { actionText: 'x', meetingTitle: 'y', transcriptExcerpt: 'z', style: 'momentum' },
      { authorization: `Bearer ${expired}` },
    )
    assert(r.status === 401, `got ${r.status}`)
  })

  await check('authenticated but invalid input is 400', async () => {
    const r = await post(
      '/api/action-plan',
      { actionText: 'x', meetingTitle: 'y', transcriptExcerpt: 'z', style: 'not-a-style' },
      { authorization: `Bearer ${token}` },
    )
    assert(r.status === 400, `got ${r.status}`)
  })

  await check('an oversized body is 413, not a dropped connection', async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(40_000) }),
    })
    assert(r.status === 413, `got ${r.status}`)
  })

  await check('errors never expose a stack trace or file path', async () => {
    const r = await post('/api/auth/login', { email: 'a@b.co' })
    const text = await r.text()
    assert(!/\bat \w+ \(|\.js:\d+|node_modules|\/app\//.test(text), `leaked internals: ${text}`)
  })

  await check('all security headers are present on a success response', async () => {
    const r = await fetch(`${BASE}/health`)
    const want = {
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    }
    for (const [h, v] of Object.entries(want)) {
      assert(r.headers.get(h) === v, `${h}: expected ${v}, got ${r.headers.get(h)}`)
    }
    const hsts = r.headers.get('strict-transport-security') || ''
    assert(/max-age=(\d+)/.test(hsts) && Number(hsts.match(/max-age=(\d+)/)[1]) >= 31536000, `weak HSTS: ${hsts}`)
    assert(hsts.includes('includeSubDomains'), 'HSTS missing includeSubDomains')
    const csp = r.headers.get('content-security-policy') || ''
    for (const d of ["default-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'"]) {
      assert(csp.includes(d), `CSP missing ${d}`)
    }
  })

  await check('security headers are present on an error response too', async () => {
    const r = await fetch(`${BASE}/nope`)
    assert(r.status === 404, `got ${r.status}`)
    assert(r.headers.get('x-frame-options') === 'DENY', 'error response missing headers')
  })

  await check('preflight advertises every method the API serves', async () => {
    const r = await fetch(`${BASE}/api/state`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type, authorization',
      },
    })
    const allowed = (r.headers.get('access-control-allow-methods') || '')
      .split(',')
      .map((m) => m.trim().toUpperCase())
    for (const method of ['GET', 'POST', 'PUT', 'OPTIONS']) {
      assert(allowed.includes(method), `preflight omits ${method}: ${allowed.join(',')}`)
    }
    const headers = (r.headers.get('access-control-allow-headers') || '').toLowerCase()
    assert(headers.includes('authorization'), 'preflight omits the authorization header')
  })

  await check('CORS never echoes an unlisted origin', async () => {
    const r = await fetch(`${BASE}/health`, { headers: { origin: 'https://evil.example.com' } })
    const allow = r.headers.get('access-control-allow-origin')
    assert(allow !== 'https://evil.example.com', 'reflected an unlisted origin')
    assert(allow !== '*', 'wildcard origin')
  })

  await check('rate limiting sheds a burst', async () => {
    const burst = await Promise.all(
      Array.from({ length: 20 }, () =>
        fetch(`http://127.0.0.1:${STRICT_PORT}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ email: 'a@b.co', password: 'nope' }),
        }),
      ),
    )
    assert(burst.some((r) => r.status === 429), 'no request was rate limited')
  })

  await check('a rate-limited response says when to come back', async () => {
    const r = await fetch(`http://127.0.0.1:${STRICT_PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: 'a@b.co', password: 'nope' }),
    })
    assert(r.status === 429, `expected the bucket to still be empty, got ${r.status}`)
    assert(Number(r.headers.get('retry-after')) > 0, 'no Retry-After header')
  })

  await check('a spoofed x-forwarded-for cannot reset the bucket', async () => {
    // Each request claims a different client IP. With the leftmost value trusted this
    // would mint a fresh bucket every time and never be limited.
    const burst = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        fetch(`http://127.0.0.1:${STRICT_PORT}/api/auth/login`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: ORIGIN,
            'x-forwarded-for': `10.0.0.${i}`,
          },
          body: JSON.stringify({ email: 'a@b.co', password: 'nope' }),
        }),
      ),
    )
    assert(burst.some((r) => r.status === 429), 'spoofed XFF bypassed the rate limiter')
  })

  await check('repeated failed logins lock out before the general limiter would', async () => {
    const port = PORT + 2
    const lock = start(port, { RATE_LIMIT_PER_SEC: '1000', RATE_LIMIT_BURST: '1000' })
    try {
      await waitForBoot(`http://127.0.0.1:${port}`)
      let locked = false
      for (let i = 0; i < 14; i++) {
        const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ email: 'a@b.co', password: 'nope' }),
        })
        if (r.status === 429) {
          locked = true
          break
        }
      }
      assert(locked, 'failed logins never locked out despite a generous general limiter')
    } finally {
      lock.child.kill('SIGTERM')
    }
  })

  // The account routes need a database. CI provides DATABASE_URL; without it these
  // are skipped rather than reported as failures of code they do not exercise.
  const hasDb = Boolean(process.env.DATABASE_URL)
  if (!hasDb) {
    console.log('  SKIP  account checks (no DATABASE_URL in this environment)')
  } else {
    const unique = `smoke.${Date.now()}@example.com`

    await check('signup creates an account and returns a token', async () => {
      const r = await post('/api/auth/signup', {
        email: unique,
        password: 'a-sufficiently-long-password',
        displayName: 'Smoke Test',
      })
      assert(r.status === 201, `got ${r.status}`)
      const body = await r.json()
      assert(typeof body.token === 'string' && body.token.length > 0, 'no token')
      assert(body.user?.email === unique, 'user not echoed')
    })

    await check('signup never returns the password', async () => {
      const r = await post('/api/auth/signup', {
        email: `dup.${Date.now()}@example.com`,
        password: 'a-sufficiently-long-password',
      })
      const text = await r.text()
      assert(!text.includes('a-sufficiently-long-password'), 'password echoed')
    })

    await check('a duplicate email is refused', async () => {
      const r = await post('/api/auth/signup', {
        email: unique,
        password: 'a-sufficiently-long-password',
      })
      assert(r.status === 409, `got ${r.status}`)
    })

    await check('a short password is refused', async () => {
      const r = await post('/api/auth/signup', { email: `s.${Date.now()}@example.com`, password: 'short' })
      assert(r.status === 400, `got ${r.status}`)
    })

    let userToken = ''
    await check('the new account can sign in', async () => {
      const r = await post('/api/auth/login', { email: unique, password: 'a-sufficiently-long-password' })
      assert(r.status === 200, `got ${r.status}`)
      userToken = (await r.json()).token
    })

    await check('a wrong password on a real account is refused', async () => {
      const r = await post('/api/auth/login', { email: unique, password: 'not-the-password' })
      assert(r.status === 401, `got ${r.status}`)
    })

    await check('per-user state round-trips', async () => {
      const put = await fetch(`${BASE}/api/state`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ state: { workStyle: 'deep' } }),
      })
      assert(put.status === 204, `PUT got ${put.status}`)

      const got = await fetch(`${BASE}/api/state`, {
        headers: { origin: ORIGIN, authorization: `Bearer ${userToken}` },
      })
      assert(got.status === 200, `GET got ${got.status}`)
      assert((await got.json()).state.workStyle === 'deep', 'state did not round-trip')
    })

    await check('one account cannot read another account state', async () => {
      const other = `other.${Date.now()}@example.com`
      const signup = await post('/api/auth/signup', { email: other, password: 'another-long-password' })
      const otherToken = (await signup.json()).token
      const got = await fetch(`${BASE}/api/state`, {
        headers: { origin: ORIGIN, authorization: `Bearer ${otherToken}` },
      })
      const body = await got.json()
      assert(Object.keys(body.state).length === 0, 'leaked another account state')
    })

    await check('state requires a token', async () => {
      const r = await fetch(`${BASE}/api/state`, { headers: { origin: ORIGIN } })
      assert(r.status === 401, `got ${r.status}`)
    })
  }

  await check('there is no master password that opens any address', async () => {
    // Regression guard: a shared credential used to authenticate any email at all.
    // Runs on its own instance because deliberate failures would otherwise consume
    // the lockout budget the later checks depend on.
    const port = PORT + 3
    const inst = start(port, { RATE_LIMIT_PER_SEC: '1000', RATE_LIMIT_BURST: '1000' })
    try {
      await waitForBoot(`http://127.0.0.1:${port}`)
      for (const candidate of ['recap-demo-2026', PASSWORD, 'password', 'demo', '']) {
        const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({
            email: `nobody.${Date.now()}.${Math.random()}@nowhere.test`,
            password: candidate,
          }),
        })
        assert(r.status === 401, `"${candidate}" authenticated an unknown address (${r.status})`)
      }
    } finally {
      inst.child.kill('SIGTERM')
    }
  })

  await check('no password, secret, email or content appears in the server log', async () => {
    const log = serverLogOf()
    assert(!log.includes(PASSWORD), 'password in log')
    assert(!log.includes(hash), 'password hash in log')
    assert(!log.includes(SECRET), 'auth secret in log')
    assert(!log.includes('a@b.co'), 'raw email in log')
    assert(!log.includes(BASE_EMAIL), 'account email in log')
    assert(!/@example\.com|@nowhere\.test/.test(log), 'an email address reached the log')
    assert(!log.includes(process.env.DATABASE_URL ?? ' '), 'connection string in log')
  })

  await check('a transcript never reaches a log line, even via an error message', async () => {
    const canary = 'ZEBRAQUARTZ-transcript-canary-9471'
    await post(
      '/api/action-plan',
      {
        actionText: `Do the thing ${canary}`,
        meetingTitle: `Meeting ${canary}`,
        transcriptExcerpt: `someone: ${canary}`,
        style: 'momentum',
      },
      { authorization: `Bearer ${token}` },
    )
    assert(!serverLogOf().includes(canary), 'transcript content reached the log')
  })
} finally {
  // Let in-flight responses finish before the process goes away; killing mid-write
  // trips a libuv assertion on Windows and buries the real result.
  await new Promise((r) => setTimeout(r, 300))
  server.kill('SIGTERM')
  strict.child.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 200))
}

const failed = results.filter((r) => !r.ok)
console.log(`\nsmoke test: ${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) {
  console.log(serverLogOf())
  process.exit(1)
}
