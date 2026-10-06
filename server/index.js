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
 *   ALLOWED_ORIGINS  comma-separated. Defaults to the GitHub Pages origin.
 *   MODEL            optional override.
 *   PORT             supplied by the platform.
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

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

const MAX_BODY_BYTES = 16 * 1024
const UPSTREAM_TIMEOUT_MS = 20_000

// ---------------------------------------------------------------------------
// Logging. JSON lines with a correlation id. Transcript content never goes in.
// ---------------------------------------------------------------------------

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

const BUCKET_RATE_PER_SEC = 0.5
const BUCKET_BURST = 5
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
    clarifying_question: { type: 'string' },
  },
  required: ['cta', 'first_step', 'steps', 'timebox', 'if_stuck', 'needs_clarification'],
  additionalProperties: false,
}

const STYLES = new Set(['momentum', 'precise', 'steady', 'deep', 'collaborative'])

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
    max_tokens: 700,
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
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

function send(res, status, body, extra = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    ...extra,
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'))
        req.destroy()
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
    res.writeHead(204, cors)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { ok: true, model: MODEL, keyConfigured: Boolean(API_KEY) }, cors)
    return
  }

  if (req.method !== 'POST' || req.url !== '/api/action-plan') {
    send(res, 404, { error: 'not found' }, cors)
    return
  }

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    log('warn', 'origin.rejected', { correlationId, origin })
    send(res, 403, { error: 'origin not allowed' }, cors)
    return
  }

  if (!API_KEY) {
    log('error', 'config.missing_key', { correlationId })
    send(res, 503, { error: 'service not configured' }, cors)
    return
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
  const retryAfterMs = takeToken(ip)
  if (retryAfterMs > 0) {
    send(res, 429, { error: 'rate limited', retryAfterMs }, {
      ...cors,
      'retry-after': String(Math.ceil(retryAfterMs / 1000)),
    })
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

    const raw = await callModel(body, correlationId)
    const result = validatePlan(raw)

    // style and duration only. The action text and transcript are user content.
    log('info', 'plan.generated', {
      correlationId,
      style: body.style,
      durationMs: Date.now() - started,
      clarified: result.plan === null,
    })

    send(res, 200, result, cors)
  } catch (error) {
    log('error', 'plan.failed', {
      correlationId,
      durationMs: Date.now() - started,
      errorName: error.name,
      errorMessage: error.message,
    })
    // The client falls back to its deterministic planner, so a failure here degrades
    // the feature rather than removing it.
    send(res, 502, { error: 'could not generate a plan', correlationId }, cors)
  }
})

server.listen(PORT, () => {
  log('info', 'server.started', {
    port: PORT,
    model: MODEL,
    keyConfigured: Boolean(API_KEY),
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
