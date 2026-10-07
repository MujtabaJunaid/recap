/**
 * Action-plan proxy.
 *
 * The only reason this process exists is to hold a provider key. A static frontend
 * cannot: anything the browser can read, every visitor can read. So the key lives here,
 * in the process environment, injected at runtime and never in source control.
 *
 * It is deliberately small. It takes an action item plus a bounded transcript excerpt,
 * calls the model with a tool schema, validates what comes back, and returns a plan or a
 * clear failure. It stores nothing.
 *
 * Env:
 *   GROQ_API_KEY     required. Set with `heroku config:set`, never committed.
 *   AUTH_SECRET      required. HMAC key for session tokens. Rotating it logs everyone out.
 *   DATABASE_URL     required. Postgres. Holds users and per-user workspace state.
 *   ALLOWED_ORIGINS  comma-separated. Defaults to the GitHub Pages origin.
 *   RATE_LIMIT_PER_SEC / RATE_LIMIT_BURST  optional per-IP token bucket tuning.
 *   MODEL            optional override.
 *   PORT             supplied by the platform.
 */
import { createServer } from 'node:http'
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  authenticate,
  createMeeting,
  createUser,
  deleteMeeting,
  getMeetingById,
  listMeetings,
  setMeetingFailed,
  setMeetingSummary,
  deleteRecording,
  getRecording,
  getRecordingAudio,
  getState,
  listRecordings,
  migrate,
  putState,
} from './db.js'
import {
  ingest,
  looksLikeAudio,
  MAX_AUDIO_BYTES,
  MAX_CHUNK_BYTES,
  normaliseMime,
  transcribeChunk,
} from './recordings.js'
import { coach, validateContext } from './live-coach.js'
import { summarise, validateTranscript } from './meetings.js'
import { ask, validateAsk } from './ask.js'

const PORT = process.env.PORT || 3000
const API_KEY = process.env.GROQ_API_KEY
const MODEL = process.env.MODEL || 'llama-3.3-70b-versatile'
const UPSTREAM = 'https://api.groq.com/openai/v1/chat/completions'

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || 'https://mujtabajunaid.github.io'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

/**
 * How many proxies sit in front of this process. Heroku's router is one, and it
 * overwrites x-forwarded-for rather than appending, but the code must not depend on
 * that: behind a proxy that appends, the leftmost value is attacker-controlled and
 * trusting it makes the rate limiter trivially bypassable.
 */
const TRUSTED_PROXY_HOPS = Number(process.env.TRUSTED_PROXY_HOPS || 1)

const AUTH_SECRET = process.env.AUTH_SECRET
const TOKEN_TTL_SEC = 12 * 60 * 60

// scrypt parameters. N=16384 is the Node default and costs roughly 50-100ms per
// verification here, which is slow enough to make offline guessing expensive and fast
// enough that a login does not feel sluggish.
const SCRYPT_N = 16384
const SCRYPT_KEYLEN = 64

const MAX_BODY_BYTES = 16 * 1024
/** An hour of transcript is far past the default JSON cap. */
const MAX_TRANSCRIPT_BYTES = 512 * 1024
const UPSTREAM_TIMEOUT_MS = 20_000

// ---------------------------------------------------------------------------
// Session tokens.
//
// HMAC-signed, expiring, stateless. Not a JWT library, because the only claims this
// service needs are a subject and an expiry, and a dependency that parses attacker-
// controlled tokens is a liability for that much value.
//
// The signature is over the payload, so a client cannot extend its own expiry. The
// payload is base64url, not encrypted: it is readable, which is why nothing sensitive
// goes in it beyond an email the user supplied about themselves.
// ---------------------------------------------------------------------------

const b64url = (buf) => Buffer.from(buf).toString('base64url')

function sign(payload) {
  const body = b64url(JSON.stringify(payload))
  const mac = createHmac('sha256', AUTH_SECRET).update(body).digest('base64url')
  return `${body}.${mac}`
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [body, mac] = token.split('.')
  if (!body || !mac) return null

  const expected = createHmac('sha256', AUTH_SECRET).update(body).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  // Constant-time: a length-varying or short-circuiting compare leaks the signature
  // one byte at a time.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MIN_PASSWORD_LENGTH = 10

function tokenExpiry() {
  return (Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC) * 1000
}

function issueToken(user) {
  return sign({
    sub: user.email,
    uid: String(user.id),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
  })
}

function publicUser(user) {
  return { email: user.email, displayName: user.displayName ?? user.display_name ?? '' }
}

/** Extracts and verifies the bearer token, returning the session or null. */
function requireSession(req) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) return null
  return verifyToken(header.slice(7))
}

/** Used by scripts/hash-password.mjs to produce the value stored in config. */
export function hashPassword(plaintext) {
  const salt = randomBytes(16)
  const derived = scryptSync(plaintext, salt, SCRYPT_KEYLEN, { N: SCRYPT_N })
  return `${salt.toString('hex')}:${derived.toString('hex')}`
}

/** Emails are PII and must not reach a log line; a short digest is enough to correlate. */
function subjectDigest(email) {
  return createHmac('sha256', AUTH_SECRET).update(email.toLowerCase()).digest('hex').slice(0, 12)
}

// ---------------------------------------------------------------------------
// Logging. JSON lines with a correlation id. Transcript content never goes in.
// ---------------------------------------------------------------------------

/**
 * Error messages are not safe to log verbatim. A JSON parse failure on model output
 * quotes the fragment it choked on, and that fragment is derived from a transcript; a
 * driver error can quote the values it rejected. Only messages matching a known-safe
 * shape are kept.
 */
const SAFE_ERROR_MESSAGE = /^(upstream \d{3}|[a-z ]{0,40}timed out after \d+ms|model returned no tool call|proxy \d{3})$/i

function safeErrorMessage(error) {
  const message = typeof error?.message === 'string' ? error.message : ''
  return SAFE_ERROR_MESSAGE.test(message) ? message : '(withheld)'
}

function log(level, event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })}\n`,
  )
}

// ---------------------------------------------------------------------------
// Rate limiting. Per-IP token bucket, in memory.
//
// In memory means per dyno, so it is a safety valve against one client, not a global
// quota. A multi-dyno deployment needs Redis for that; this is honest about being the
// cheap version.
// ---------------------------------------------------------------------------

// Normal use makes several calls in quick succession — login, load state, save state,
// then a plan or two. 0.5/s was tuned before the state endpoints existed and shed
// ordinary traffic. Abuse is held back by the failed-login lockout below, which is the
// control that actually matters for guessing.
const BUCKET_RATE_PER_SEC = Number(process.env.RATE_LIMIT_PER_SEC || 5)
const BUCKET_BURST = Number(process.env.RATE_LIMIT_BURST || 20)

/** Failed logins get their own, much tighter budget than general traffic. */
const LOGIN_FAIL_WINDOW_MS = 15 * 60_000
const LOGIN_FAIL_LIMIT = 10
const loginFailures = new Map()

function recordLoginFailure(ip) {
  const now = Date.now()
  const entry = loginFailures.get(ip)
  if (!entry || now - entry.since > LOGIN_FAIL_WINDOW_MS) {
    loginFailures.set(ip, { count: 1, since: now })
    return
  }
  entry.count += 1
}

function loginLockedOut(ip) {
  const entry = loginFailures.get(ip)
  if (!entry) return 0
  if (Date.now() - entry.since > LOGIN_FAIL_WINDOW_MS) {
    loginFailures.delete(ip)
    return 0
  }
  if (entry.count < LOGIN_FAIL_LIMIT) return 0
  return LOGIN_FAIL_WINDOW_MS - (Date.now() - entry.since)
}

function clearLoginFailures(ip) {
  loginFailures.delete(ip)
}

/**
 * Takes the IP the trusted proxy layer actually observed, counting in from the right.
 * Anything further left was supplied by the client and must not be believed.
 */
function clientIp(req) {
  // Zero trusted hops means this process is directly reachable, so x-forwarded-for is
  // entirely client-supplied and must be ignored outright.
  if (TRUSTED_PROXY_HOPS <= 0) return req.socket.remoteAddress || 'unknown'

  const chain = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  if (chain.length === 0) return req.socket.remoteAddress || 'unknown'

  // Count in from the right: only the entries the trusted proxies appended are
  // believable. Anything further left was supplied by the client.
  const index = chain.length - TRUSTED_PROXY_HOPS
  if (index < 0) return req.socket.remoteAddress || 'unknown'
  return chain[index] || chain[chain.length - 1]
}
const buckets = new Map()

function takeToken(ip) {
  const now = Date.now()
  const bucket = buckets.get(ip) ?? { tokens: BUCKET_BURST, last: now }
  const elapsed = (now - bucket.last) / 1000
  bucket.tokens = Math.min(BUCKET_BURST, bucket.tokens + elapsed * BUCKET_RATE_PER_SEC)
  bucket.last = now

  if (bucket.tokens < 1) {
    buckets.set(ip, bucket)
    return Math.ceil(((1 - bucket.tokens) / BUCKET_RATE_PER_SEC) * 1000)
  }

  bucket.tokens -= 1
  buckets.set(ip, bucket)
  return 0
}

// Unbounded maps are how a long-lived process leaks. Evict idle buckets periodically.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000
  for (const [ip, bucket] of buckets) if (bucket.last < cutoff) buckets.delete(ip)
  const failCutoff = Date.now() - LOGIN_FAIL_WINDOW_MS
  for (const [ip, entry] of loginFailures) if (entry.since < failCutoff) loginFailures.delete(ip)
}, 60_000).unref()

// ---------------------------------------------------------------------------
// Model contract. Mirrors src/lib/prompts.ts; keep the two in step.
// ---------------------------------------------------------------------------

const TOOL_NAME = 'emit_action_plan'

const SYSTEM_PROMPT = `You turn a commitment made in a meeting into a plan the owner can start today.

GROUNDING — these override everything else:
- Use ONLY the supplied action item, its owner, its due date and the supplied transcript excerpt.
- Never invent a deadline, a name, a number, a tool, a system or a prior conversation.
- If the action item is too vague to plan, set needs_clarification true and give the single question that would unblock it. Do not guess and then plan the guess.
- Never state or imply that anyone said these steps in the meeting.

WORK STYLE:
The caller supplies one work style the user chose for themselves. Adapt HOW the plan is shaped, never WHAT the task is. These are self-described preferences, not clinical categories: do not diagnose, do not refer to any medical condition, do not comment on the user's capabilities.
- momentum: first step completable in under two minutes, no decision required, permit a bad first version.
- precise: define done before starting, state what is out of scope, give a stop condition.
- steady: one step visible at a time, calm register, no urgency language.
- deep: one protected block, inputs gathered up front, batch adjacent work.
- collaborative: name a specific participant and give an opening line.

STYLE: second person, plain British English, concrete to this item, no emoji, no motivational filler. cta is one imperative line of at most 90 characters. steps is 2 to 4 entries.

Answer by calling ${TOOL_NAME}. Do not write prose outside the tool call.`

const SCHEMA = {
  type: 'object',
  properties: {
    cta: { type: 'string', maxLength: 90 },
    first_step: { type: 'string' },
    steps: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' } },
    timebox: { type: 'string' },
    if_stuck: { type: 'string' },
    needs_clarification: { type: 'boolean' },
    // Union with null: a model fills every declared property, and sends null for the
    // one it is not using. A bare string type makes the provider reject its own output.
    clarifying_question: { type: ['string', 'null'] },
  },
  required: ['cta', 'first_step', 'steps', 'timebox', 'if_stuck', 'needs_clarification'],
  additionalProperties: false,
}

const STYLES = new Set(['momentum', 'precise', 'steady', 'deep', 'collaborative'])

/**
 * Repeated inline in the user message. Naming the style alone left the model to recall
 * its rule from the middle of a long system prompt, and it averaged across them —
 * switching style produced a near-identical plan, which defeats the whole feature.
 */
const STYLE_RULES = {
  momentum: [
    'The reader cannot start. Your FIRST STEP must take under two minutes, require no',
    'decision, and name one physical action (open this, type that). Put a timer in the',
    'steps. Say explicitly that a bad first version is fine. Do not plan the whole task.',
  ].join(' '),
  precise: [
    'The reader cannot stop. Your FIRST STEP must be to write down what "done" means',
    'before any work starts. Include an explicit out-of-scope list and a stop condition.',
    'Never suggest polishing or reviewing again.',
  ].join(' '),
  steady: [
    'The reader is overwhelmed. Give exactly one action at a time and say to finish it',
    'before reading on. Calm register. No urgency words, no exclamation marks, no',
    'deadlines framed as pressure. End by permitting them to stop for the day.',
  ].join(' '),
  deep: [
    'The reader loses more to context switching than to the work. Your FIRST STEP must',
    'be to book one uninterrupted block and gather every input before starting. Say to',
    'turn notifications off. Suggest batching adjacent work into the same block.',
  ].join(' '),
  collaborative: [
    'The reader is stuck on a blank page. Your FIRST STEP must be to contact one named',
    'person and say what to open the conversation with. Everything else follows from',
    'that conversation.',
  ].join(' '),
}

// ---------------------------------------------------------------------------
// Validation. Everything from the network is untrusted, in both directions.
// ---------------------------------------------------------------------------

function validateRequest(body) {
  const errors = []
  const str = (key, max) => {
    const v = body?.[key]
    if (typeof v !== 'string' || v.trim() === '') errors.push(`${key} is required`)
    else if (v.length > max) errors.push(`${key} exceeds ${max} characters`)
  }

  str('actionText', 500)
  str('meetingTitle', 200)
  str('transcriptExcerpt', 4000)
  if (!STYLES.has(body?.style)) errors.push('style is not a known work style')
  if (body?.ownerName != null && typeof body.ownerName !== 'string') {
    errors.push('ownerName must be a string or null')
  }
  if (body?.due != null && !/^\d{4}-\d{2}-\d{2}$/.test(body.due)) {
    errors.push('due must be YYYY-MM-DD or null')
  }
  return errors
}

function validatePlan(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('tool call was not an object')

  if (raw.needs_clarification === true) {
    const q = typeof raw.clarifying_question === 'string' ? raw.clarifying_question.trim() : ''
    if (!q) throw new Error('flagged unclear without a question')
    return { plan: null, clarifyingQuestion: q }
  }

  const text = (key) => {
    const v = raw[key]
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`missing ${key}`)
    return v.trim()
  }

  if (!Array.isArray(raw.steps) || raw.steps.length < 2 || raw.steps.length > 4) {
    throw new Error('steps must contain 2 to 4 entries')
  }
  if (!raw.steps.every((s) => typeof s === 'string' && s.trim())) {
    throw new Error('steps must all be non-empty strings')
  }

  const cta = text('cta')
  if (cta.length > 90) throw new Error('cta exceeds 90 characters')

  // Wire format mirrors the tool schema exactly. The client runs the same validation
  // again on receipt, because a proxy is still a network boundary.
  return {
    plan: {
      cta,
      first_step: text('first_step'),
      steps: raw.steps.map((s) => s.trim()),
      timebox: text('timebox'),
      if_stuck: text('if_stuck'),
    },
    clarifyingQuestion: null,
  }
}

// ---------------------------------------------------------------------------
// Upstream call: bounded, retried on transient failures only, honours Retry-After.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function callModel(body, correlationId) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `MEETING: ${body.meetingTitle}`,
        `ACTION ITEM: ${body.actionText}`,
        `OWNER: ${body.ownerName || 'unassigned'}`,
        `DUE: ${body.due || 'no date agreed'}`,
        `WORK STYLE: ${body.style}`,
        `STYLE REQUIREMENT (binding for this request): ${STYLE_RULES[body.style]}`,
        '',
        'TRANSCRIPT EXCERPT (the only context you may use):',
        body.transcriptExcerpt,
      ].join('\n'),
    },
  ]

  const payload = {
    model: MODEL,
    messages,
    temperature: 0.4,
    // Reasoning models spend the budget thinking before they emit the tool call. At 700
    // the JSON was being truncated mid-string and the provider rejected its own output
    // with "failed to parse tool call arguments". Low effort also cuts latency, which
    // matters more than depth for a four-step plan.
    reasoning_effort: 'low',
    max_tokens: 2500,
    tools: [
      {
        type: 'function',
        function: { name: TOOL_NAME, description: 'Emit a grounded plan.', parameters: SCHEMA },
      },
    ],
    tool_choice: { type: 'function', function: { name: TOOL_NAME } },
  }

  const ATTEMPTS = 3
  let lastError

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
    try {
      const response = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (response.status === 429 || response.status >= 500) {
        const advised = Number(response.headers.get('retry-after')) * 1000
        const delay = Number.isFinite(advised) && advised > 0 ? advised : 2 ** attempt * 400
        lastError = new Error(`upstream ${response.status}`)
        if (attempt < ATTEMPTS - 1) {
          log('warn', 'upstream.retry', { correlationId, attempt: attempt + 1, status: response.status })
          await sleep(delay + Math.random() * 200)
          continue
        }
        throw lastError
      }

      if (!response.ok) throw new Error(`upstream ${response.status}`)

      const json = await response.json()
      const call = json?.choices?.[0]?.message?.tool_calls?.[0]
      if (!call) throw new Error('model returned no tool call')
      return JSON.parse(call.function.arguments)
    } catch (error) {
      lastError = error
      const transient = error.name === 'AbortError' || /upstream 5|upstream 429/.test(error.message)
      if (!transient || attempt === ATTEMPTS - 1) throw error
      await sleep(2 ** attempt * 400 + Math.random() * 200)
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin)
  return {
    'access-control-allow-origin': allowed ? origin : ALLOWED_ORIGINS[0],
    // Must list every method the API actually serves. GET and PUT were added with the
    // state endpoints and omitted here, so the browser rejected the preflight and
    // per-user sync failed silently — invisible to curl, which sends no preflight.
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    // Every custom request header the client sends must be listed, or the browser
    // blocks the request at preflight and the failure never reaches the server. That
    // has now bitten twice: once for the state methods above, once for x-chunk-side,
    // where it meant a live call captured audio and transcribed none of it.
    'access-control-allow-headers':
      'content-type, authorization, x-recording-title, x-recording-duration, x-chunk-side',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

/**
 * Applied to every response including errors and preflights, so there is no path that
 * can forget them. This is an API that only ever returns JSON, so the CSP is maximally
 * restrictive: nothing should ever be loaded or framed from one of these responses.
 */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'cross-origin-resource-policy': 'same-site',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'cache-control': 'no-store',
}

function send(res, status, body, extra = {}) {
  if (status === 204) {
    res.writeHead(204, { ...SECURITY_HEADERS, ...extra })
    res.end()
    return
  }
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...SECURITY_HEADERS,
    ...extra,
  })
  res.end(payload)
}

/** Header values are attacker-controlled; strip anything that is not plain text. */
function decodeHeader(value) {
  if (typeof value !== 'string') return ''
  try {
    return decodeURIComponent(value).replace(/[ -]/g, '').trim()
  } catch {
    return ''
  }
}

/** Raw bytes rather than JSON, for audio uploads. Bounded by the caller. */
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0
    let rejected = false
    const chunks = []
    req.on('data', (chunk) => {
      if (rejected) return
      size += chunk.length
      if (size > maxBytes) {
        rejected = true
        req.resume()
        reject(new PayloadTooLargeError())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

class PayloadTooLargeError extends Error {
  constructor() {
    super('payload too large')
    this.name = 'PayloadTooLargeError'
  }
}

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    let rejected = false
    const chunks = []
    req.on('data', (chunk) => {
      if (rejected) return
      size += chunk.length
      if (size > maxBytes) {
        rejected = true
        // Drain rather than destroy: killing the socket makes the router report 503,
        // which hides a client error behind what looks like an outage.
        req.resume()
        reject(new PayloadTooLargeError())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  const cors = corsHeaders(origin)
  const correlationId = randomUUID().slice(0, 8)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...SECURITY_HEADERS, ...cors })
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    send(
      res,
      200,
      {
        ok: true,
        model: MODEL,
        keyConfigured: Boolean(API_KEY),
        authConfigured: Boolean(AUTH_SECRET),
      },
      cors,
    )
    return
  }

  const isLogin = req.method === 'POST' && req.url === '/api/auth/login'
  const isSignup = req.method === 'POST' && req.url === '/api/auth/signup'
  const isGetState = req.method === 'GET' && req.url === '/api/state'
  const isPutState = req.method === 'PUT' && req.url === '/api/state'
  const isPlan = req.method === 'POST' && req.url === '/api/action-plan'

  const recordingMatch = /^\/api\/recordings(?:\/(\d+)(\/audio)?)?$/.exec(req.url || '')
  const isRecordings = Boolean(recordingMatch)
  const isCoach = req.method === 'POST' && req.url === '/api/live-coach'
  const meetingMatch = /^\/api\/meetings(?:\/(\d+))?$/.exec(req.url || '')
  const isMeetings = Boolean(meetingMatch)
  const isAsk = req.method === 'POST' && req.url === '/api/ask'
  const isChunk = req.method === 'POST' && req.url === '/api/transcribe-chunk'

  if (
    !isLogin &&
    !isSignup &&
    !isGetState &&
    !isPutState &&
    !isPlan &&
    !isRecordings &&
    !isCoach &&
    !isMeetings &&
    !isAsk &&
    !isChunk
  ) {
    send(res, 404, { error: 'not found' }, cors)
    return
  }

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    log('warn', 'origin.rejected', { correlationId, origin })
    send(res, 403, { error: 'origin not allowed' }, cors)
    return
  }

  if (!AUTH_SECRET) {
    log('error', 'config.missing_auth', { correlationId })
    send(res, 503, { error: 'service not configured' }, cors)
    return
  }

  const ip = clientIp(req)
  const retryAfterMs = takeToken(ip)
  if (retryAfterMs > 0) {
    send(res, 429, { error: 'rate limited', retryAfterMs }, {
      ...cors,
      'retry-after': String(Math.ceil(retryAfterMs / 1000)),
    })
    return
  }

  // ---- Signup -----------------------------------------------------------------
  if (isSignup) {
    const lockout = loginLockedOut(ip)
    if (lockout > 0) {
      send(res, 429, { error: 'too many attempts', retryAfterMs: lockout }, {
        ...cors,
        'retry-after': String(Math.ceil(lockout / 1000)),
      })
      return
    }

    try {
      const body = await readBody(req)
      const email = typeof body?.email === 'string' ? body.email.trim() : ''
      const password = typeof body?.password === 'string' ? body.password : ''
      const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''

      const problems = []
      if (!EMAIL_RE.test(email) || email.length > 200) problems.push('a valid email is required')
      if (password.length < MIN_PASSWORD_LENGTH) {
        problems.push(`password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      }
      if (password.length > 200) problems.push('password is too long')
      if (displayName.length > 80) problems.push('display name is too long')
      if (problems.length > 0) {
        send(res, 400, { error: 'invalid request', details: problems }, cors)
        return
      }

      const user = await createUser(email, displayName || email.split('@')[0], password)
      if (!user) {
        // The address is taken. Say so: signup has to be usable, and the address was
        // supplied by whoever is already sitting at the form.
        send(res, 409, { error: 'an account with that email already exists' }, cors)
        return
      }

      const token = issueToken(user)
      log('info', 'auth.signup', { correlationId, subject: subjectDigest(user.email) })
      send(res, 201, { token, expiresAt: tokenExpiry(), user: publicUser(user) }, cors)
    } catch (error) {
      const tooLarge = error.name === 'PayloadTooLargeError'
      if (!tooLarge) {
        log('error', 'auth.signup_failed', {
          correlationId,
          errorName: error?.name,
          // Code, not message: a driver error message can echo the values it choked on.
          errorCode: error?.code,
        })
      }
      send(res, tooLarge ? 413 : 400, { error: tooLarge ? 'payload too large' : 'invalid request' }, cors)
    }
    return
  }

  // ---- Per-user workspace state --------------------------------------------------
  if (isGetState || isPutState) {
    const session = requireSession(req)
    if (!session) {
      send(res, 401, { error: 'sign in required' }, { ...cors, 'www-authenticate': 'Bearer' })
      return
    }

    // The shared demo credential has no row in users, so there is nothing to key state
    // against and a write would violate the foreign key. Those sessions keep their
    // state in the browser, which the client already handles as its offline path.
    if (!session.uid || session.uid === '0') {
      if (isGetState) {
        send(res, 200, { state: {}, scope: 'local' }, cors)
      } else {
        send(res, 409, { error: 'shared demo sessions keep state in the browser' }, cors)
      }
      return
    }

    try {
      if (isGetState) {
        send(res, 200, { state: await getState(session.uid) }, cors)
        return
      }
      const body = await readBody(req)
      if (!body || typeof body.state !== 'object' || body.state === null) {
        send(res, 400, { error: 'state must be an object' }, cors)
        return
      }
      await putState(session.uid, body.state)
      send(res, 204, {}, cors)
    } catch (error) {
      const tooLarge = error.name === 'PayloadTooLargeError'
      if (!tooLarge) log('error', 'state.failed', { correlationId, errorName: error.name })
      send(res, tooLarge ? 413 : 500, { error: tooLarge ? 'payload too large' : 'could not save' }, cors)
    }
    return
  }

  // ---- Login ----------------------------------------------------------------
  if (isLogin) {
    const lockout = loginLockedOut(ip)
    if (lockout > 0) {
      log('warn', 'auth.locked_out', { correlationId })
      send(res, 429, { error: 'too many failed attempts', retryAfterMs: lockout }, {
        ...cors,
        'retry-after': String(Math.ceil(lockout / 1000)),
      })
      return
    }

    try {
      const body = await readBody(req)
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) {
        send(res, 400, { error: 'a valid email is required' }, cors)
        return
      }
      const password = typeof body?.password === 'string' ? body.password : ''

      // Accounts only. There is deliberately no master password: a credential that
      // opens every address is one leak away from opening every account, and it makes
      // "who did this" unanswerable. The seeded demo account is an ordinary row with
      // its own password, like everyone else's.
      const account = await authenticate(email, password)

      if (!account) {
        // Same message and shape for an unknown email as for a wrong password, so the
        // endpoint cannot be used to discover which addresses exist.
        recordLoginFailure(ip)
        log('warn', 'auth.rejected', { correlationId, subject: subjectDigest(email) })
        send(res, 401, { error: 'email or password is incorrect' }, cors)
        return
      }

      clearLoginFailures(ip)

      log('info', 'auth.granted', { correlationId, subject: subjectDigest(email) })
      send(
        res,
        200,
        { token: issueToken(account), expiresAt: tokenExpiry(), user: publicUser(account) },
        cors,
      )
    } catch (error) {
      const tooLarge = error.name === 'PayloadTooLargeError'
      send(res, tooLarge ? 413 : 400, { error: error.message }, cors)
    }
    return
  }

  // ---- Ask across every meeting ----------------------------------------------------
  if (isAsk) {
    const session = requireSession(req)
    if (!session) {
      send(res, 401, { error: 'sign in required' }, { ...cors, 'www-authenticate': 'Bearer' })
      return
    }

    const started = Date.now()
    try {
      const body = await readBody(req, MAX_TRANSCRIPT_BYTES)
      const problem = validateAsk(body)
      if (problem) {
        send(res, 400, { error: 'invalid request', details: [problem] }, cors)
        return
      }
      if (!API_KEY) {
        send(res, 503, { error: 'ask is unavailable' }, cors)
        return
      }

      const result = await ask(body.question, body.passages, API_KEY)
      // Counts and timing only. The question and the passages are user content.
      log('info', 'ask.answered', {
        correlationId,
        passages: body.passages.length,
        citations: result.citations.length,
        confident: result.confident,
        durationMs: Date.now() - started,
      })
      send(res, 200, { result }, cors)
    } catch (error) {
      if (error.name === 'PayloadTooLargeError') {
        send(res, 413, { error: 'payload too large' }, cors)
        return
      }
      log('error', 'ask.failed', {
        correlationId,
        durationMs: Date.now() - started,
        errorName: error?.name,
        errorMessage: safeErrorMessage(error),
      })
      send(res, 502, { error: 'could not answer that' }, cors)
    }
    return
  }

  // ---- Meetings --------------------------------------------------------------------
  if (isMeetings) {
    const session = requireSession(req)
    if (!session?.uid || session.uid === '0') {
      send(res, 401, { error: 'sign in required' }, { ...cors, 'www-authenticate': 'Bearer' })
      return
    }
    const id = meetingMatch[1]

    try {
      if (req.method === 'GET' && !id) {
        send(res, 200, { meetings: await listMeetings(session.uid) }, cors)
        return
      }
      if (req.method === 'GET' && id) {
        const row = await getMeetingById(id, session.uid)
        if (!row) {
          send(res, 404, { error: 'not found' }, cors)
          return
        }
        send(res, 200, { meeting: row }, cors)
        return
      }
      if (req.method === 'DELETE' && id) {
        const removed = await deleteMeeting(id, session.uid)
        send(res, removed ? 204 : 404, removed ? {} : { error: 'not found' }, cors)
        return
      }
      if (req.method === 'POST' && !id) {
        const body = await readBody(req, MAX_TRANSCRIPT_BYTES)
        const problem = validateTranscript(body?.transcript)
        if (problem) {
          send(res, 400, { error: 'invalid request', details: [problem] }, cors)
          return
        }
        if (!API_KEY) {
          send(res, 503, { error: 'summarisation is unavailable' }, cors)
          return
        }

        const row = await createMeeting({
          userId: session.uid,
          title: String(body.title || 'Untitled meeting').slice(0, 200),
          platform: ['zoom', 'meet', 'teams', 'mock'].includes(body.platform)
            ? body.platform
            : 'mock',
          source: body.source === 'recorded' ? 'recorded' : 'simulated',
          durationSeconds: Math.max(0, Number(body.durationSeconds) || 0),
          participants: Array.isArray(body.participants)
            ? body.participants.slice(0, 20).map((p) => String(p).slice(0, 80))
            : [],
          transcript: body.transcript,
        })

        // The transcript is stored before the model is called. It is the thing that
        // cannot be regenerated, and a summarisation failure must not lose it.
        const work = (async () => {
          try {
            const summary = await summarise(body.transcript, API_KEY)
            await setMeetingSummary(row.id, session.uid, summary, summary.title)
            log('info', 'meeting.summarised', {
              meetingId: String(row.id),
              lines: body.transcript.length,
              actions: summary.actionItems.length,
            })
          } catch (error) {
            await setMeetingFailed(row.id, session.uid)
            log('error', 'meeting.summarise_failed', {
              meetingId: String(row.id),
              errorName: error?.name,
              errorMessage: safeErrorMessage(error),
            })
          }
        })()

        log('info', 'meeting.created', {
          correlationId,
          meetingId: String(row.id),
          lines: body.transcript.length,
        })
        send(res, 202, { meeting: row }, cors)
        void work
        return
      }
      send(res, 405, { error: 'method not allowed' }, cors)
    } catch (error) {
      if (error.name === 'PayloadTooLargeError') {
        send(res, 413, { error: 'payload too large' }, cors)
        return
      }
      log('error', 'meeting.failed', { correlationId, errorName: error?.name })
      send(res, 500, { error: 'could not handle that meeting' }, cors)
    }
    return
  }

  // ---- Live coaching -------------------------------------------------------------
  if (isCoach) {
    const session = requireSession(req)
    if (!session) {
      send(res, 401, { error: 'sign in required' }, { ...cors, 'www-authenticate': 'Bearer' })
      return
    }

    const started = Date.now()
    try {
      const body = await readBody(req)
      const problem = validateContext(body?.lines)
      if (problem) {
        send(res, 400, { error: 'invalid request', details: [problem] }, cors)
        return
      }
      if (!API_KEY) {
        send(res, 503, { error: 'coaching is unavailable' }, cors)
        return
      }

      const suggestion = await coach(body.lines, API_KEY)
      // Line count and latency only. What was said in the room never goes to a log.
      log('info', 'coach.suggested', {
        correlationId,
        lines: body.lines.length,
        durationMs: Date.now() - started,
      })
      send(res, 200, { suggestion }, cors)
    } catch (error) {
      if (error.name === 'PayloadTooLargeError') {
        send(res, 413, { error: 'payload too large' }, cors)
        return
      }
      log('error', 'coach.failed', {
        correlationId,
        durationMs: Date.now() - started,
        errorName: error?.name,
        errorMessage: safeErrorMessage(error),
      })
      send(res, 502, { error: 'could not suggest a response' }, cors)
    }
    return
  }

  // ---- Recordings ----------------------------------------------------------------
  // ---- Live call: transcribe one slice, store nothing ------------------------
  if (isChunk) {
    const session = requireSession(req)
    if (!session?.uid || session.uid === '0') {
      send(res, 401, { error: 'sign in required' }, { ...cors, 'www-authenticate': 'Bearer' })
      return
    }

    if (!API_KEY) {
      send(res, 503, { error: 'transcription is unavailable' }, cors)
      return
    }

    const declared = normaliseMime(req.headers['content-type'])
    if (!declared) {
      send(res, 415, { error: 'unsupported audio format' }, cors)
      return
    }

    const side = req.headers['x-chunk-side'] === 'them' ? 'them' : 'me'

    try {
      const audio = await readRawBody(req, MAX_CHUNK_BYTES)
      // Silence compresses to almost nothing; below this there is no speech to find.
      if (audio.length < 1024) {
        send(res, 200, { text: '', side }, cors)
        return
      }
      if (!looksLikeAudio(audio)) {
        send(res, 415, { error: 'that does not look like audio' }, cors)
        return
      }

      const text = await transcribeChunk(audio, declared.mime, declared.ext, API_KEY)
      log('info', 'chunk.transcribed', {
        correlationId,
        side,
        bytes: audio.length,
        chars: text.length,
      })
      send(res, 200, { text, side }, cors)
    } catch (error) {
      if (error.name === 'PayloadTooLargeError') {
        send(res, 413, { error: 'slice is too large' }, cors)
        return
      }
      log('error', 'chunk.failed', { correlationId, side, errorName: error?.name })
      send(res, 502, { error: 'could not transcribe that slice' }, cors)
    }
    return
  }

  if (isRecordings) {
    const session = requireSession(req)
    if (!session?.uid || session.uid === '0') {
      send(res, 401, { error: 'sign in required' }, { ...cors, 'www-authenticate': 'Bearer' })
      return
    }

    const id = recordingMatch[1]
    const wantsAudio = Boolean(recordingMatch[2])

    try {
      if (req.method === 'GET' && !id) {
        send(res, 200, { recordings: await listRecordings(session.uid) }, cors)
        return
      }

      if (req.method === 'GET' && id && wantsAudio) {
        const row = await getRecordingAudio(id, session.uid)
        // Scoped by user in the query, so someone else's id is simply not found.
        if (!row) {
          send(res, 404, { error: 'not found' }, cors)
          return
        }
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          ...cors,
          'content-type': row.mime,
          'content-length': String(row.audio.length),
          // Private: this is a user's own recording and must not sit in a shared cache.
          'cache-control': 'private, max-age=3600',
          'accept-ranges': 'none',
        })
        res.end(row.audio)
        return
      }

      if (req.method === 'GET' && id) {
        const row = await getRecording(id, session.uid)
        if (!row) {
          send(res, 404, { error: 'not found' }, cors)
          return
        }
        send(res, 200, { recording: row }, cors)
        return
      }

      if (req.method === 'DELETE' && id) {
        const removed = await deleteRecording(id, session.uid)
        send(res, removed ? 204 : 404, removed ? {} : { error: 'not found' }, cors)
        return
      }

      if (req.method === 'POST' && !id) {
        if (!API_KEY) {
          send(res, 503, { error: 'transcription is unavailable' }, cors)
          return
        }

        const declared = normaliseMime(req.headers['content-type'])
        if (!declared) {
          send(res, 415, { error: 'unsupported audio format' }, cors)
          return
        }

        const audio = await readRawBody(req, MAX_AUDIO_BYTES)
        if (audio.length < 1024) {
          send(res, 400, { error: 'recording is too short' }, cors)
          return
        }
        // The declared content type is a claim; the magic bytes are the evidence.
        if (!looksLikeAudio(audio)) {
          send(res, 415, { error: 'that does not look like audio' }, cors)
          return
        }

        const title = decodeHeader(req.headers['x-recording-title']) || 'Untitled recording'
        const durationSeconds = Math.max(0, Number(req.headers['x-recording-duration']) || 0)

        const { row, work } = await ingest({
          userId: session.uid,
          title: title.slice(0, 200),
          mime: declared.mime,
          ext: declared.ext,
          audio,
          durationSeconds,
          apiKey: API_KEY,
          log,
        })

        log('info', 'recording.stored', {
          correlationId,
          recordingId: String(row.id),
          bytes: audio.length,
        })

        // Answer as soon as the audio is safely stored. Transcription continues in the
        // background and the client polls; making the upload wait two minutes for
        // Whisper would be a worse product and a worse use of a dyno.
        send(res, 202, { recording: row }, cors)
        void work
        return
      }

      send(res, 405, { error: 'method not allowed' }, cors)
    } catch (error) {
      if (error.name === 'PayloadTooLargeError') {
        send(res, 413, { error: 'recording is too large' }, cors)
        return
      }
      log('error', 'recording.failed', { correlationId, errorName: error?.name })
      send(res, 500, { error: 'could not handle that recording' }, cors)
    }
    return
  }

  // ---- Plan generation, authenticated -----------------------------------------
  const authHeader = req.headers.authorization || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const session = verifyToken(bearer)
  if (!session) {
    send(res, 401, { error: 'sign in required' }, { ...cors, 'www-authenticate': 'Bearer' })
    return
  }


  const started = Date.now()
  try {
    const body = await readBody(req)
    const errors = validateRequest(body)
    if (errors.length > 0) {
      send(res, 400, { error: 'invalid request', details: errors }, cors)
      return
    }

    // After validation, so a malformed request gets the accurate reason rather than
    // being told the service is down. Only generation needs the provider key; a
    // rotated or missing one must not take authentication down with it.
    if (!API_KEY) {
      log('error', 'config.missing_key', { correlationId })
      send(res, 503, { error: 'generation is unavailable' }, cors)
      return
    }

    const raw = await callModel(body, correlationId)
    const result = validatePlan(raw)

    // Style, timing and a digest of the subject. The action text, the transcript and
    // the email itself are user content and never appear here.
    log('info', 'plan.generated', {
      correlationId,
      subject: subjectDigest(session.sub),
      style: body.style,
      durationMs: Date.now() - started,
      clarified: result.plan === null,
    })

    send(res, 200, result, cors)
  } catch (error) {
    if (error.name === 'PayloadTooLargeError') {
      send(res, 413, { error: 'payload too large' }, cors)
      return
    }
    log('error', 'plan.failed', {
      correlationId,
      durationMs: Date.now() - started,
      errorName: error?.name,
      // Withheld unless the message is one of ours. A SyntaxError from parsing model
      // output quotes transcript-derived text.
      errorMessage: safeErrorMessage(error),
    })
    // The client falls back to its deterministic planner, so a failure here degrades
    // the feature rather than removing it.
    send(res, 502, { error: 'could not generate a plan', correlationId }, cors)
  }
})

try {
  await migrate()
  log('info', 'db.ready', {})
} catch (error) {
  // Connection failures often arrive as an AggregateError whose own `message` is empty,
  // so reporting only that hides the cause entirely. Pull the detail out.
  // Schema SQL carries no user data, so the message is safe here and is the only way
  // to tell a connection refusal from a permission problem.
  log('error', 'db.migrate_failed', {
    errorName: error?.name,
    errorCode: error?.code,
    errorMessage: error?.message || '(empty)',
    causes: Array.isArray(error?.errors)
      ? error.errors.map((e) => e.code ?? e.name).slice(0, 4)
      : undefined,
  })
  process.exit(1)
}

server.listen(PORT, () => {
  log('info', 'server.started', {
    port: PORT,
    model: MODEL,
    keyConfigured: Boolean(API_KEY),
    authConfigured: Boolean(AUTH_SECRET),
    allowedOrigins: ALLOWED_ORIGINS,
  })
})

const shutdown = (signal) => {
  log('info', 'server.stopping', { signal })
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
