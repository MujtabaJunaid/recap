/**
 * Transport-agnostic resilience primitives.
 *
 * This build serves meetings from in-memory fixtures, so nothing here currently retries
 * a real network call. They exist at the data-access seam (`src/data/repository.ts`)
 * rather than as decoration: when that seam is backed by HTTP, the call sites already
 * time out, retry with backoff, trip a breaker and dedupe by idempotency key, and no
 * caller changes.
 */

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export class CircuitOpenError extends Error {
  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super(`Circuit open; retry in ${retryAfterMs}ms`)
    this.name = 'CircuitOpenError'
    this.retryAfterMs = retryAfterMs
  }
}

export function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new TimeoutError(ms))
    }, ms)
    task(controller.signal).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export interface RetryOptions {
  attempts?: number
  baseMs?: number
  maxMs?: number
  /** Only transient failures should be retried; a 400 never becomes a 200. */
  isRetryable?: (error: unknown) => boolean
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Full jitter: delay is uniform in [0, min(maxMs, base * 2^n)]. Equal-width backoff
 * without jitter synchronises every client that failed at the same moment into a
 * thundering herd on the next attempt.
 */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt)
  return Math.round(random() * ceiling)
}

export async function retry<T>(task: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    baseMs = 200,
    maxMs = 4000,
    isRetryable = () => true,
    sleep = defaultSleep,
    random = Math.random,
    onRetry,
  } = options

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      const final = attempt === attempts - 1
      if (final || !isRetryable(error)) throw error
      const delayMs = backoffDelay(attempt, baseMs, maxMs, random)
      onRetry?.({ attempt: attempt + 1, delayMs, error })
      await sleep(delayMs)
    }
  }
  throw lastError
}

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitOptions {
  failureThreshold?: number
  resetAfterMs?: number
  now?: () => number
}

/**
 * Fails fast once a dependency is clearly down, so a slow backend degrades into an
 * immediate fallback instead of queueing every caller behind its timeout.
 */
export class CircuitBreaker {
  private failures = 0
  private openedAt = 0
  private halfOpenInFlight = false

  private readonly failureThreshold: number
  private readonly resetAfterMs: number
  private readonly now: () => number

  constructor(options: CircuitOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5
    this.resetAfterMs = options.resetAfterMs ?? 10_000
    this.now = options.now ?? Date.now
  }

  get state(): CircuitState {
    if (this.failures < this.failureThreshold) return 'closed'
    return this.now() - this.openedAt >= this.resetAfterMs ? 'half-open' : 'open'
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    const state = this.state
    if (state === 'open') {
      throw new CircuitOpenError(this.resetAfterMs - (this.now() - this.openedAt))
    }
    // In half-open, admit exactly one probe; the rest keep failing fast.
    if (state === 'half-open') {
      if (this.halfOpenInFlight) {
        throw new CircuitOpenError(this.resetAfterMs)
      }
      this.halfOpenInFlight = true
    }

    try {
      const result = await task()
      this.failures = 0
      this.halfOpenInFlight = false
      return result
    } catch (error) {
      this.failures += 1
      this.halfOpenInFlight = false
      if (this.failures >= this.failureThreshold) this.openedAt = this.now()
      throw error
    }
  }

  reset(): void {
    this.failures = 0
    this.openedAt = 0
    this.halfOpenInFlight = false
  }
}

/**
 * Collapses concurrent and repeated calls that carry the same key onto one execution.
 * A retried write must not produce a second side effect, and two components asking for
 * the same meeting at once should produce one request.
 */
export class IdempotencyCache<T> {
  private readonly inFlight = new Map<string, Promise<T>>()
  private readonly settled = new Map<string, { value: T; at: number }>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(ttlMs = 30_000, now: () => number = Date.now) {
    this.ttlMs = ttlMs
    this.now = now
  }

  async run(key: string, task: () => Promise<T>): Promise<T> {
    const done = this.settled.get(key)
    if (done && this.now() - done.at < this.ttlMs) return done.value

    const existing = this.inFlight.get(key)
    if (existing) return existing

    const promise = task()
      .then((value) => {
        this.settled.set(key, { value, at: this.now() })
        return value
      })
      .finally(() => {
        this.inFlight.delete(key)
      })

    this.inFlight.set(key, promise)
    return promise
  }

  invalidate(key?: string): void {
    if (key === undefined) {
      this.inFlight.clear()
      this.settled.clear()
      return
    }
    this.inFlight.delete(key)
    this.settled.delete(key)
  }
}
