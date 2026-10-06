import type { Meeting } from './types'
import { MEETINGS, SHARED_CLIPS, type SharedClip } from './index'
import {
  CircuitBreaker,
  IdempotencyCache,
  RateLimiter,
  RateLimitError,
  retry,
  withTimeout,
  CircuitOpenError,
  TimeoutError,
} from '../lib/resilience'
import { logger, metrics, newCorrelationId, type Logger } from '../lib/observability'

/**
 * The single seam between the UI and wherever meetings actually live.
 *
 * Everything above this interface is already asynchronous and already handles loading
 * and failure, so replacing `FixtureSource` with an HTTP source is a one-file change:
 * no route, hook or component knows where the data came from. The resilience policy
 * (timeout, bounded retry with jittered backoff, circuit breaker, idempotent
 * de-duplication) lives here rather than at each call site, so it cannot be applied
 * inconsistently.
 */
export interface MeetingRepository {
  listMeetings(): Promise<Meeting[]>
  getMeeting(id: string): Promise<Meeting | undefined>
  getSharedClip(id: string): Promise<SharedClip | undefined>
}

/** The transport. Swap this, not the repository. */
export interface MeetingSource {
  readonly name: string
  listMeetings(signal: AbortSignal): Promise<Meeting[]>
  getMeeting(id: string, signal: AbortSignal): Promise<Meeting | undefined>
  getSharedClip(id: string, signal: AbortSignal): Promise<SharedClip | undefined>
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`)
    this.name = 'NotFoundError'
  }
}

/**
 * Serves the bundled seed data. Reads resolve immediately; the async signature exists so
 * the call sites are already shaped for a network source.
 */
export class FixtureSource implements MeetingSource {
  readonly name = 'fixtures'

  private readonly byId = new Map(MEETINGS.map((m) => [m.id, m]))
  private readonly clipsById = new Map(SHARED_CLIPS.map((c) => [c.id, c]))

  async listMeetings(): Promise<Meeting[]> {
    return MEETINGS
  }

  async getMeeting(id: string): Promise<Meeting | undefined> {
    return this.byId.get(id)
  }

  async getSharedClip(id: string): Promise<SharedClip | undefined> {
    return this.clipsById.get(id)
  }
}

export interface RepositoryOptions {
  timeoutMs?: number
  attempts?: number
  /** Sustained reads per second before callers are shed. */
  ratePerSecond?: number
  burst?: number
  log?: Logger
}

/** A 404 will still be a 404 next time; only transient faults are worth retrying. */
function isTransient(error: unknown): boolean {
  if (error instanceof NotFoundError) return false
  if (error instanceof CircuitOpenError) return false
  // Retryable, but only after the delay the server asked for; `retry` honours it.
  if (error instanceof RateLimitError) return true
  if (error instanceof TimeoutError) return true
  if (error instanceof Error && error.name === 'AbortError') return false
  return true
}

export class ResilientMeetingRepository implements MeetingRepository {
  private readonly breaker = new CircuitBreaker({ failureThreshold: 4, resetAfterMs: 15_000 })
  private readonly cache = new IdempotencyCache<unknown>(30_000)
  private readonly timeoutMs: number
  private readonly attempts: number
  private readonly limiter: RateLimiter
  private readonly log: Logger

  private readonly source: MeetingSource

  constructor(source: MeetingSource, options: RepositoryOptions = {}) {
    this.source = source
    this.timeoutMs = options.timeoutMs ?? 8_000
    this.attempts = options.attempts ?? 3
    this.limiter = new RateLimiter({
      ratePerSecond: options.ratePerSecond ?? 20,
      burst: options.burst ?? 40,
    })
    this.log = (options.log ?? logger).child({ source: source.name })
  }

  listMeetings(): Promise<Meeting[]> {
    return this.read('listMeetings', 'meetings:all', (signal) =>
      this.source.listMeetings(signal),
    )
  }

  getMeeting(id: string): Promise<Meeting | undefined> {
    return this.read(`getMeeting`, `meeting:${id}`, (signal) => this.source.getMeeting(id, signal))
  }

  getSharedClip(id: string): Promise<SharedClip | undefined> {
    return this.read('getSharedClip', `clip:${id}`, (signal) =>
      this.source.getSharedClip(id, signal),
    )
  }

  invalidate(key?: string): void {
    this.cache.invalidate(key)
  }

  get circuitState() {
    return this.breaker.state
  }

  /**
   * One policy, applied to every read: de-duplicate by key, shed load past the rate
   * limit, fail fast when the breaker is open, bound each attempt with a timeout, retry
   * transient faults with jittered backoff (or the server's Retry-After), and emit one
   * structured span per operation.
   *
   * Order matters. De-duplication is outermost so a repeated read costs no budget at
   * all; the limiter sits inside the retry loop so a retry storm is itself shed.
   */
  private read<T>(
    operation: string,
    key: string,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const log = this.log.withCorrelationId(newCorrelationId()).child({ operation, key })

    return this.cache.run(key, () =>
      log.span(`repository.${operation}`, () =>
        this.breaker.run(() =>
          retry(() => this.limiter.run(() => withTimeout(task, this.timeoutMs)), {
            attempts: this.attempts,
            baseMs: 150,
            maxMs: 2_000,
            isRetryable: isTransient,
            onRetry: ({ attempt, delayMs, error }) => {
              metrics.increment('repository.retry')
              if (error instanceof RateLimitError) metrics.increment('repository.rate_limited')
              log.warn('repository.retry', {
                attempt,
                delayMs,
                errorName: error instanceof Error ? error.name : 'Unknown',
              })
            },
          }),
        ),
      ),
    ) as Promise<T>
  }
}

export const meetingRepository: MeetingRepository = new ResilientMeetingRepository(
  new FixtureSource(),
)
