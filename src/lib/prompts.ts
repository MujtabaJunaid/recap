import type { ActionPlan, WorkStyleId } from './coaching'
import { WORK_STYLES } from './coaching'

/**
 * The hosted contract for action-plan generation.
 *
 * Nothing here calls a model: this build has no backend and therefore nowhere safe to
 * hold a key. What this file does is pin the contract — system prompt, tool schema,
 * per-provider shapes, and validation of whatever comes back — so the hosted path is a
 * transport change rather than a redesign, and so the rules that keep a model honest
 * live in source review rather than in somebody's console history.
 *
 * Validation is the part that matters most. A model that returns plausible JSON is not
 * the same as a model that returned *true* JSON, and `parseActionPlan` is the only way
 * model output is allowed to become an `ActionPlan`.
 */

export const ACTION_PLAN_TOOL_NAME = 'emit_action_plan'

export const SYSTEM_PROMPT = `You turn a commitment made in a meeting into a plan the owner can start today.

GROUNDING — these override everything else:
- Use ONLY the supplied action item, its owner, its due date and the supplied transcript excerpt.
- Never invent a deadline, a name, a number, a tool, a system or a prior conversation. If it is not in the input, it does not exist.
- If the action item is too vague to plan, set "needs_clarification" to true and put the single question that would unblock it in "clarifying_question". Do not guess and then plan the guess.
- Never state or imply that anyone said these steps in the meeting. They are your suggestion.

WORK STYLE:
The caller supplies one work style, which the user chose for themselves. Adapt HOW the plan is shaped, never WHAT the task is. These are self-described working preferences, not clinical categories: do not diagnose, do not refer to any medical condition, and do not comment on the user's capabilities.

- momentum: the obstacle is starting. First step must be completable in under two minutes and must not require any decision. Prefer a timer. Explicitly permit a bad first version.
- precise: the obstacle is stopping. Define done before starting, state what is out of scope, and give an explicit stop condition.
- steady: the obstacle is overwhelm. Exactly one step visible at a time, calm register, no urgency language, no exclamation marks.
- deep: the obstacle is context switching. One protected block, inputs gathered up front, batch adjacent work.
- collaborative: the obstacle is a blank page. Name a specific person from the participants and give an opening line for them.

STYLE:
- Second person, plain language, British English.
- Concrete and specific to this item. A step that would apply to any task is a failed step.
- No emoji. No motivational filler. No praise.
- "cta" is one imperative line, at most 90 characters.
- "steps" is 2 to 4 entries, each one sentence.

Return your answer by calling the ${ACTION_PLAN_TOOL_NAME} tool. Do not write prose outside the tool call.`

/** JSON Schema shared by every provider; each adapter only rewraps it. */
export const ACTION_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    cta: {
      type: 'string',
      maxLength: 90,
      description: 'One imperative line: the next action, in the owner\'s own terms.',
    },
    first_step: {
      type: 'string',
      description: 'The very first thing to do, sized according to the work style.',
    },
    steps: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: { type: 'string' },
    },
    timebox: { type: 'string', description: 'How long to give it, phrased for the work style.' },
    if_stuck: { type: 'string', description: 'One concrete unblocking move.' },
    needs_clarification: {
      type: 'boolean',
      description: 'True when the action item is too vague to plan without guessing.',
    },
    clarifying_question: {
      // Union with null: a model fills every declared property and sends null for the
      // one it is not using. A bare string type makes the provider reject its own
      // tool call before it ever reaches us.
      type: ['string', 'null'],
      description: 'The question to ask when needs_clarification is true; null otherwise.',
    },
  },
  required: ['cta', 'first_step', 'steps', 'timebox', 'if_stuck', 'needs_clarification'],
  additionalProperties: false,
} as const

const TOOL_DESCRIPTION =
  'Emit a grounded, work-style-adapted plan for a single meeting action item.'

/** Anthropic Messages API tool-use shape. */
export function toAnthropicTool() {
  return {
    name: ACTION_PLAN_TOOL_NAME,
    description: TOOL_DESCRIPTION,
    input_schema: ACTION_PLAN_SCHEMA,
  }
}

/** OpenAI-compatible function shape. Groq, Together and others accept the same. */
export function toOpenAITool() {
  return {
    type: 'function' as const,
    function: {
      name: ACTION_PLAN_TOOL_NAME,
      description: TOOL_DESCRIPTION,
      parameters: ACTION_PLAN_SCHEMA,
      strict: true,
    },
  }
}

/** Gemini function-declaration shape. */
export function toGeminiTool() {
  return {
    functionDeclarations: [
      {
        name: ACTION_PLAN_TOOL_NAME,
        description: TOOL_DESCRIPTION,
        parameters: ACTION_PLAN_SCHEMA,
      },
    ],
  }
}

export interface PlanRequest {
  actionText: string
  ownerName: string | null
  due: string | null
  meetingTitle: string
  /** Only the lines around the commitment. Sending the whole transcript is the expensive mistake. */
  transcriptExcerpt: string
  style: WorkStyleId
}

export function buildUserMessage(request: PlanRequest): string {
  const style = WORK_STYLES.find((s) => s.id === request.style)
  return [
    `MEETING: ${request.meetingTitle}`,
    `ACTION ITEM: ${request.actionText}`,
    `OWNER: ${request.ownerName ?? 'unassigned'}`,
    `DUE: ${request.due ?? 'no date agreed'}`,
    `WORK STYLE: ${request.style} — ${style?.blurb ?? ''}`,
    '',
    'TRANSCRIPT EXCERPT (the only context you may use):',
    request.transcriptExcerpt,
  ].join('\n')
}

export class InvalidPlanError extends Error {
  constructor(reason: string) {
    super(`Model returned an unusable plan: ${reason}`)
    this.name = 'InvalidPlanError'
  }
}

export interface ParsedPlan {
  plan: ActionPlan | null
  clarifyingQuestion: string | null
}

/**
 * The only route from model output to an `ActionPlan`. A tool call is still untrusted
 * input: providers drift, `strict` is not universally honoured, and a retried call can
 * return a different shape. Anything that fails here falls back to the deterministic
 * planner rather than rendering half a plan.
 */
export function parseActionPlan(raw: unknown, derivedFrom: string): ParsedPlan {
  if (!raw || typeof raw !== 'object') throw new InvalidPlanError('not an object')
  const v = raw as Record<string, unknown>

  // Absent means "not flagged": the proxy screens this before forwarding, and a direct
  // tool call always supplies it because the schema requires it.
  if (v.needs_clarification === true) {
    const question = typeof v.clarifying_question === 'string' ? v.clarifying_question.trim() : ''
    if (!question) throw new InvalidPlanError('flagged unclear without supplying a question')
    return { plan: null, clarifyingQuestion: question }
  }

  const text = (key: string): string => {
    const value = v[key]
    if (typeof value !== 'string' || value.trim() === '') {
      throw new InvalidPlanError(`missing ${key}`)
    }
    return value.trim()
  }

  const steps = v.steps
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 4) {
    throw new InvalidPlanError('steps must contain 2 to 4 entries')
  }
  if (!steps.every((s) => typeof s === 'string' && s.trim() !== '')) {
    throw new InvalidPlanError('steps must all be non-empty strings')
  }

  const cta = text('cta')
  if (cta.length > 90) throw new InvalidPlanError('cta exceeds 90 characters')

  return {
    plan: {
      cta,
      firstStep: text('first_step'),
      steps: steps.map((s) => (s as string).trim()),
      timebox: text('timebox'),
      ifStuck: text('if_stuck'),
      derivedFrom,
    },
    clarifyingQuestion: null,
  }
}

/**
 * A one-hour meeting is roughly 8–10k words, so sending whole transcripts per action
 * item is how this gets expensive. Plans only ever need the moment the commitment was
 * made, and the excerpt is bounded on both sides.
 */
export function excerptAround(
  lines: { t: number; text: string; speaker: string }[],
  at: number,
  leadSec = 45,
  tailSec = 30,
  maxLines = 12,
): string {
  return lines
    .filter((l) => l.t >= at - leadSec && l.t <= at + tailSec)
    .slice(0, maxLines)
    .map((l) => `${l.speaker}: ${l.text}`)
    .join('\n')
}
