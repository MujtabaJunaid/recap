/**
 * Ask a question across every meeting.
 *
 * Fathom's headline feature is "Stop guessing. Ask Fathom." — one place to ask anything
 * about what was said, rather than remembering which call it was in. This is that.
 *
 * Retrieval is lexical, not embeddings: the client already ranks transcripts, summaries
 * and action items for its own search, so it sends the passages it found and this picks
 * up from there. For a corpus this size that is both faster and more predictable than a
 * vector index, and it keeps the citation trail exact — every answer points at a real
 * meeting and a real second.
 */

const UPSTREAM = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = process.env.ASK_MODEL || 'openai/gpt-oss-120b'
const TIMEOUT_MS = 25_000

const TOOL_NAME = 'answer_from_meetings'

export const MAX_PASSAGES = 24
export const MAX_PASSAGE_CHARS = 700
export const MAX_QUESTION_CHARS = 400

export const SYSTEM_PROMPT = `You answer questions about meetings the user was in, using only the passages supplied.

GROUNDING — these override everything else:
- Answer ONLY from the passages. Never add a fact, a name, a number, a date or a decision that is not in them.
- Every claim in "answer" must trace to a passage you cite. If you cannot cite it, do not say it.
- If the passages do not contain the answer, say so plainly in "answer" and set "confident" to false. A clear "that was not discussed in anything I can see" is a correct and useful answer. Padding it with something adjacent is not.
- Do not speculate about what someone meant, intended or would probably say.
- If the passages disagree with each other, say so and cite both. Do not pick a side.

CITATIONS:
- Cite by the passage "id" given to you. Cite every passage you actually used, and none that you did not.
- Prefer a few precise citations to many loose ones.

STYLE:
- Plain British English. Answer the question first, then the detail. Two to five sentences.
- Quote a short phrase from a passage where the wording carries the meaning.
- Name people as the passages name them.
- No emoji, no preamble, no "Based on the transcripts".

Answer by calling ${TOOL_NAME}. No prose outside the tool call.`

export const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', maxLength: 1200 },
    citations: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string' },
    },
    confident: { type: 'boolean' },
    follow_up: { type: ['string', 'null'], maxLength: 160 },
  },
  required: ['answer', 'citations', 'confident', 'follow_up'],
  additionalProperties: false,
}

export function validateAsk(body) {
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!question) return 'a question is required'
  if (question.length > MAX_QUESTION_CHARS) return `question exceeds ${MAX_QUESTION_CHARS} characters`

  const passages = body?.passages
  if (!Array.isArray(passages) || passages.length === 0) return 'at least one passage is required'
  if (passages.length > MAX_PASSAGES) return `at most ${MAX_PASSAGES} passages`

  for (const p of passages) {
    if (!p || typeof p !== 'object') return 'each passage must be an object'
    if (typeof p.id !== 'string' || !p.id.trim()) return 'each passage needs an id'
    if (typeof p.text !== 'string' || !p.text.trim()) return 'each passage needs text'
    if (p.text.length > MAX_PASSAGE_CHARS) return 'a passage is too long'
    if (p.meeting != null && typeof p.meeting !== 'string') return 'meeting must be a string'
  }
  return null
}

/** The only route from a tool call to an answer. */
export function parseAnswer(raw, allowedIds) {
  if (!raw || typeof raw !== 'object') throw new Error('not an object')

  const answer = typeof raw.answer === 'string' ? raw.answer.trim() : ''
  if (!answer) throw new Error('missing answer')

  // A citation the model invented is worse than none: it looks like evidence and is
  // not. Anything outside the supplied set is dropped.
  const citations = Array.isArray(raw.citations)
    ? [...new Set(raw.citations.filter((c) => typeof c === 'string' && allowedIds.has(c)))]
    : []

  return {
    answer: answer.slice(0, 1200),
    citations,
    confident: raw.confident === true && citations.length > 0,
    followUp:
      typeof raw.follow_up === 'string' && raw.follow_up.trim()
        ? raw.follow_up.trim().slice(0, 160)
        : null,
  }
}

export async function ask(question, passages, apiKey) {
  const allowedIds = new Set(passages.map((p) => p.id))

  const context = passages
    .slice(0, MAX_PASSAGES)
    .map(
      (p) =>
        `[${p.id}] meeting: ${(p.meeting || 'unknown').slice(0, 120)}${
          typeof p.t === 'number' ? ` · at ${Math.round(p.t)}s` : ''
        }\n${p.text.trim()}`,
    )
    .join('\n\n')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        reasoning_effort: 'low',
        max_tokens: 2000,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `PASSAGES FROM MY MEETINGS:\n\n${context}\n\nQUESTION: ${question}`,
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: TOOL_NAME,
              description: 'Answer the question strictly from the supplied passages.',
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
    return parseAnswer(JSON.parse(call.function.arguments), allowedIds)
  } finally {
    clearTimeout(timer)
  }
}
