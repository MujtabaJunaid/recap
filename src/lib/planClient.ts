import type { ActionItem, Meeting } from '../data/types'
import { buildActionPlan, type ActionPlan, type WorkStyleId } from './coaching'
import { excerptAround, parseActionPlan } from './prompts'
import { person } from '../data/people'
import { CircuitBreaker, IdempotencyCache, retry, RateLimitError } from './resilience'
import { logger, metrics } from './observability'

/**
 * Fetches a generated plan from the proxy when one is configured, and falls back to the
 * deterministic planner when it is not, or when anything goes wrong.
 *
 * The fallback is the point. A meeting tool whose action items stop working because a
 * model provider is having an afternoon is a worse product than one that quietly uses
 * its own planner. The user should never see an error here — only a slightly less
 * tailored plan, labelled honestly.
 */

const API_BASE = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

export const isHostedPlanningEnabled = Boolean(API_BASE)

export type PlanSource = 'model' | 'local'

export interface PlanResult {
  plan: ActionPlan
  source: PlanSource
  clarifyingQuestion: string | null
  /** Set when the hosted path was tried and failed, for the UI to disclose. */
  degraded: boolean
}

const breaker = new CircuitBreaker({ failureThreshold: 3, resetAfterMs: 30_000 })
const cache = new IdempotencyCache<PlanResult>(5 * 60_000)
const log = logger.child({ component: 'planClient' })

function localResult(item: ActionItem, meeting: Meeting, style: WorkStyleId, degraded: boolean): PlanResult {
  return {
    plan: buildActionPlan(item, meeting, style),
    source: 'local',
    clarifyingQuestion: null,
    degraded,
  }
}

export async function getActionPlan(
  item: ActionItem,
  meeting: Meeting,
  style: WorkStyleId,
  token?: string | null,
): Promise<PlanResult> {
  // No proxy, or no session token to present to it: use the local planner rather than
  // making a call that will be refused.
  if (!API_BASE || !token) return localResult(item, meeting, style, false)

  // Same item and style must not be billed twice.
  const key = `${meeting.id}:${item.id}:${style}`

  try {
    return await cache.run(key, () =>
      breaker.run(() =>
        retry(() => requestPlan(item, meeting, style, token), {
          attempts: 2,
          baseMs: 300,
          maxMs: 2_000,
          isRetryable: (error) =>
            error instanceof RateLimitError || !(error instanceof BadRequestError),
          onRetry: () => metrics.increment('planClient.retry'),
        }),
      ),
    )
  } catch (error) {
    metrics.increment('planClient.fallback')
    log.warn('plan.fallback', {
      errorName: error instanceof Error ? error.name : 'Unknown',
    })
    return localResult(item, meeting, style, true)
  }
}

class BadRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadRequestError'
  }
}

async function requestPlan(
  item: ActionItem,
  meeting: Meeting,
  style: WorkStyleId,
  token: string,
): Promise<PlanResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)

  try {
    const response = await fetch(`${API_BASE}/api/action-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      signal: controller.signal,
      body: JSON.stringify({
        actionText: item.text,
        ownerName: item.owner ? person(item.owner).name : null,
        due: item.due ?? null,
        meetingTitle: meeting.title,
        // Only the moment the commitment was made. Sending a whole hour of transcript
        // per action item is how this gets expensive.
        transcriptExcerpt: excerptAround(meeting.transcript, item.t),
        style,
      }),
    })

    if (response.status === 429) {
      const body = await response.json().catch(() => ({}))
      throw new RateLimitError(Number(body?.retryAfterMs) || 2_000)
    }
    if (response.status === 400) throw new BadRequestError('proxy rejected the request')
    // An expired or revoked token will not succeed on retry; fall back immediately.
    if (response.status === 401) throw new BadRequestError('session expired')
    if (!response.ok) throw new Error(`proxy ${response.status}`)

    const body: unknown = await response.json()
    const payload = body as { plan?: unknown; clarifyingQuestion?: unknown }

    const derivedFrom = `Generated for ${meeting.title}. Nobody said these steps out loud.`

    if (payload.plan === null && typeof payload.clarifyingQuestion === 'string') {
      // The model said the item is too vague to plan. Show its question alongside the
      // deterministic plan rather than hiding either.
      return {
        plan: buildActionPlan(item, meeting, style),
        source: 'local',
        clarifyingQuestion: payload.clarifyingQuestion,
        degraded: false,
      }
    }

    if (!payload.plan || typeof payload.plan !== 'object') {
      throw new Error('proxy returned no plan')
    }
    const parsed = parseActionPlan(payload.plan, derivedFrom)
    if (!parsed.plan) throw new Error('proxy returned no plan')

    return { plan: parsed.plan, source: 'model', clarifyingQuestion: null, degraded: false }
  } finally {
    clearTimeout(timer)
  }
}
