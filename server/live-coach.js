/**
 * Live coaching during a call.
 *
 * Takes the last few things said in the room and suggests how the user could respond,
 * while the conversation is still happening. Latency is the whole product here: advice
 * that arrives after the moment has passed is worse than none, because the user spent
 * attention reading it.
 *
 * So: a small model, a short output cap, low reasoning effort, and a hard timeout well
 * under the time it takes a conversation to move on.
 */

const UPSTREAM = 'https://api.groq.com/openai/v1/chat/completions'
// 20b would not hold the grounding rule: it kept inventing justifications the user
// had never said ("based on our velocity"). 120b follows it and still lands under 2s.
const MODEL = process.env.LIVE_COACH_MODEL || 'openai/gpt-oss-120b'
const TIMEOUT_MS = 8_000

export const MAX_CONTEXT_LINES = 8
export const MAX_LINE_CHARS = 400

const TOOL_NAME = 'suggest_response'

export const SYSTEM_PROMPT = `You are coaching someone silently during a live meeting. They can see your suggestion; nobody else can. The conversation is still moving, so be immediately usable.

GROUNDING — the hardest rule, and the one most often broken:
- Use ONLY the lines supplied. Never invent a fact, a name, a number, a commitment or anything said earlier that is not in front of you.
- This includes justifications. Do NOT invent a reason the user holds a position: no "based on our velocity", no "according to the plan", no "our testing shows". If you did not read it in the lines, the user did not say it and may not be able to back it up.
- When a claim would help but you do not have one, say the honest version instead: name what you would need, or offer to come back with it. A response the user can actually stand behind beats a confident one they cannot.
- If the lines do not contain a question or anything needing a response, say so in "read" and leave "say_next" as the single most useful thing they could add. Do not manufacture urgency.
- Never guess what someone meant. If it is ambiguous, the best response is usually the clarifying question.

WHAT TO RETURN:
- "read": one sentence on what is actually being asked or what the room is waiting for. Plain, not a summary.
- "say_next": something they could say out loud, more or less verbatim, in their own plain voice. One or two sentences. No corporate register, no "I appreciate you raising that".
- "because": one short line on why that is the right move here.
- "watch_out": one risk in how they might answer badly — overcommitting, answering a question nobody asked, agreeing to a date they cannot hold. Omit if there is genuinely none.

STYLE:
- Second person. British English. Plain words.
- "say_next" must sound like a person, not a script. Contractions are fine.
- No emoji. No praise. No filler. Never tell them to "be confident".
- Be brief. They are reading this while someone is still talking.

Answer by calling ${TOOL_NAME}. No prose outside the tool call.`

export const SCHEMA = {
  type: 'object',
  properties: {
    read: { type: 'string', maxLength: 200 },
    say_next: { type: 'string', maxLength: 320 },
    because: { type: 'string', maxLength: 200 },
    watch_out: { type: ['string', 'null'], maxLength: 200 },
  },
  required: ['read', 'say_next', 'because', 'watch_out'],
  additionalProperties: false,
}

/** Model output is untrusted; this is the only route from a tool call to a suggestion. */
export function parseSuggestion(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('not an object')
  const text = (key, max) => {
    const value = raw[key]
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing ${key}`)
    return value.trim().slice(0, max)
  }
  const watchOut =
    typeof raw.watch_out === 'string' && raw.watch_out.trim() !== ''
      ? raw.watch_out.trim().slice(0, 200)
      : null

  return {
    read: text('read', 200),
    sayNext: text('say_next', 320),
    because: text('because', 200),
    watchOut,
  }
}

export function validateContext(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return 'at least one line is required'
  if (lines.length > MAX_CONTEXT_LINES) return `at most ${MAX_CONTEXT_LINES} lines`
  for (const line of lines) {
    if (!line || typeof line !== 'object') return 'each line must be an object'
    if (typeof line.text !== 'string' || line.text.trim() === '') return 'each line needs text'
    if (line.text.length > MAX_LINE_CHARS) return `a line exceeds ${MAX_LINE_CHARS} characters`
    if (line.speaker != null && typeof line.speaker !== 'string') return 'speaker must be a string'
  }
  return null
}

export async function coach(lines, apiKey) {
  const transcript = lines
    .slice(-MAX_CONTEXT_LINES)
    .map((l) => `${(l.speaker || 'someone').slice(0, 60)}: ${l.text.trim()}`)
    .join('\n')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        // Low effort and a tight cap: this has to land before the conversation moves on.
        reasoning_effort: 'low',
        max_tokens: 900,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `THE LAST THINGS SAID IN THE ROOM (oldest first):\n${transcript}\n\nWhat should I say next?`,
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: TOOL_NAME,
              description: 'Suggest how the user should respond right now.',
              parameters: SCHEMA,
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: TOOL_NAME } },
      }),
    })

    if (!response.ok) throw new Error(`upstream ${response.status}`)

    const body = await response.json()
    const call = body?.choices?.[0]?.message?.tool_calls?.[0]
    if (!call) throw new Error('model returned no tool call')
    return parseSuggestion(JSON.parse(call.function.arguments))
  } finally {
    clearTimeout(timer)
  }
}
