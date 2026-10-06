/**
 * Turning a finished call into a saved meeting.
 *
 * Takes the transcript a call produced and asks the model for a summary, decisions and
 * action items with owners. The transcript is real input and the summary is a real
 * model call; only the *capture* of the conversation is simulated, and the UI says so.
 */

const UPSTREAM = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = process.env.SUMMARY_MODEL || 'openai/gpt-oss-120b'
const TIMEOUT_MS = 60_000

const TOOL_NAME = 'emit_meeting_summary'

export const MAX_TRANSCRIPT_LINES = 400
export const MAX_LINE_CHARS = 1200

export const SYSTEM_PROMPT = `You summarise a meeting from its transcript, for someone deciding what happens next.

GROUNDING — these override everything else:
- Use ONLY the transcript. Never invent a decision, a name, a date, a number or a commitment.
- An action item requires someone to have actually taken it on. "We should probably look at that" is not an action item. If nobody owned it, either leave it out or set owner to null and say so.
- Never attribute a line to the wrong speaker. If you cannot tell who owns an action, owner is null.
- If the transcript is too short or too thin to summarise, say that in the headline rather than padding.

WHAT TO RETURN:
- "title": a short specific name for this meeting, from what was actually discussed. Not "Team Meeting".
- "headline": two or three sentences a person who missed it could read and know where things stand. Lead with what was decided, not what was discussed.
- "decisions": things that were actually settled. Empty array if nothing was.
- "action_items": each with the text, the owner's name exactly as it appears in the transcript (or null), and the approximate second it was agreed.
- "open_questions": things raised and left unresolved. This is often the most useful part; do not pad it either.

STYLE:
- Plain British English. Specific over general. No corporate register, no "the team aligned on".
- Quote a number or a phrase from the transcript where it carries the meaning.
- No emoji.

Answer by calling ${TOOL_NAME}. No prose outside the tool call.`

export const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 90 },
    headline: { type: 'string', maxLength: 700 },
    decisions: { type: 'array', maxItems: 8, items: { type: 'string' } },
    action_items: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          owner: { type: ['string', 'null'] },
          at_second: { type: 'number' },
        },
        required: ['text', 'owner', 'at_second'],
        additionalProperties: false,
      },
    },
    open_questions: { type: 'array', maxItems: 6, items: { type: 'string' } },
  },
  required: ['title', 'headline', 'decisions', 'action_items', 'open_questions'],
  additionalProperties: false,
}

export function validateTranscript(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return 'a transcript is required'
  if (lines.length > MAX_TRANSCRIPT_LINES) return `at most ${MAX_TRANSCRIPT_LINES} lines`
  for (const line of lines) {
    if (!line || typeof line !== 'object') return 'each line must be an object'
    if (typeof line.text !== 'string' || line.text.trim() === '') return 'each line needs text'
    if (line.text.length > MAX_LINE_CHARS) return 'a line is too long'
    if (typeof line.t !== 'number' || !Number.isFinite(line.t) || line.t < 0) {
      return 'each line needs a numeric timestamp'
    }
    if (line.speaker != null && typeof line.speaker !== 'string') return 'speaker must be a string'
  }
  return null
}

/** The only route from model output to a stored summary. */
export function parseSummary(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('not an object')

  const text = (key, max) => {
    const value = raw[key]
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing ${key}`)
    return value.trim().slice(0, max)
  }
  const strings = (key) =>
    Array.isArray(raw[key])
      ? raw[key].filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim())
      : []

  const actionItems = Array.isArray(raw.action_items)
    ? raw.action_items
        .filter((a) => a && typeof a.text === 'string' && a.text.trim())
        .map((a, i) => ({
          id: `a${i + 1}`,
          text: a.text.trim(),
          owner: typeof a.owner === 'string' && a.owner.trim() ? a.owner.trim() : null,
          t: Number.isFinite(Number(a.at_second)) ? Math.max(0, Math.round(Number(a.at_second))) : 0,
          done: false,
        }))
    : []

  return {
    title: text('title', 90),
    headline: text('headline', 700),
    decisions: strings('decisions'),
    actionItems,
    openQuestions: strings('open_questions'),
  }
}

export async function summarise(lines, apiKey) {
  const transcript = lines
    .slice(0, MAX_TRANSCRIPT_LINES)
    .map((l) => `[${Math.round(l.t)}s] ${(l.speaker || 'someone').slice(0, 60)}: ${l.text.trim()}`)
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
        reasoning_effort: 'low',
        max_tokens: 3000,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `TRANSCRIPT (timestamps in seconds from the start):\n${transcript}`,
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: TOOL_NAME,
              description: 'Emit a grounded summary of this meeting.',
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
    return parseSummary(JSON.parse(call.function.arguments))
  } finally {
    clearTimeout(timer)
  }
}
