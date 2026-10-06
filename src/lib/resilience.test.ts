import { describe, expect, it, vi } from 'vitest'
import {
  backoffDelay,
  CircuitBreaker,
  CircuitOpenError,
  IdempotencyCache,
  retry,
  TimeoutError,
  withTimeout,
} from './resilience'
import { Logger, Metrics, type LogRecord } from './observability'

const noSleep = async () => {}

describe('backoff', () => {
  it('grows exponentially and is capped', () => {
    const full = () => 1
    expect(backoffDelay(0, 100, 1000, full)).toBe(100)
    expect(backoffDelay(1, 100, 1000, full)).toBe(200)
    expect(backoffDelay(2, 100, 1000, full)).toBe(400)
    expect(backoffDelay(9, 100, 1000, full)).toBe(1000)
  })

  it('applies full jitter, so clients do not resynchronise into a herd', () => {
    expect(backoffDelay(3, 100, 10_000, () => 0)).toBe(0)
    expect(backoffDelay(3, 100, 10_000, () => 0.5)).toBe(400)
    expect(backoffDelay(3, 100, 10_000, () => 1)).toBe(800)
  })
})

describe('retry', () => {
  it('returns the first success without retrying', async () => {
    const task = vi.fn().mockResolvedValue('ok')
    await expect(retry(task, { sleep: noSleep })).resolves.toBe('ok')
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('retries transient failures up to the attempt limit', async () => {
    const task = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('ok')

    await expect(retry(task, { attempts: 3, sleep: noSleep })).resolves.toBe('ok')
    expect(task).toHaveBeenCalledTimes(3)
  })

  it('gives up after the limit and rethrows the last error', async () => {
    const task = vi.fn().mockRejectedValue(new Error('still broken'))
    await expect(retry(task, { attempts: 3, sleep: noSleep })).rejects.toThrow('still broken')
    expect(task).toHaveBeenCalledTimes(3)
  })

  it('does not retry what cannot succeed', async () => {
    const task = vi.fn().mockRejectedValue(new Error('bad request'))
    await expect(
      retry(task, { attempts: 5, sleep: noSleep, isRetryable: () => false }),
    ).rejects.toThrow('bad request')
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('reports each retry for observability', async () => {
    const onRetry = vi.fn()
    const task = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('ok')
    await retry(task, { sleep: noSleep, onRetry })
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1 })
  })
})

describe('timeout', () => {
  it('rejects slow work and aborts the signal', async () => {
    vi.useFakeTimers()
    let aborted = false
    const promise = withTimeout(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true
          })
          setTimeout(resolve, 10_000)
        }),
      100,
    )
    const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(200)
    await assertion
    expect(aborted).toBe(true)
    vi.useRealTimers()
  })

  it('passes a fast result straight through', async () => {
    await expect(withTimeout(async () => 'fast', 1000)).resolves.toBe('fast')
  })
})

describe('circuit breaker', () => {
  const failing = () => Promise.reject(new Error('down'))

  it('stays closed below the threshold', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 })
    await expect(breaker.run(failing)).rejects.toThrow('down')
    expect(breaker.state).toBe('closed')
  })

  it('opens at the threshold and then fails fast without calling through', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetAfterMs: 1000, now: () => 0 })
    const task = vi.fn().mockRejectedValue(new Error('down'))

    await expect(breaker.run(task)).rejects.toThrow('down')
    await expect(breaker.run(task)).rejects.toThrow('down')
    expect(breaker.state).toBe('open')

    await expect(breaker.run(task)).rejects.toBeInstanceOf(CircuitOpenError)
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('half-opens after the reset window and closes on a successful probe', async () => {
    let clock = 0
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetAfterMs: 1000,
      now: () => clock,
    })

    await expect(breaker.run(failing)).rejects.toThrow('down')
    expect(breaker.state).toBe('open')

    clock = 1500
    expect(breaker.state).toBe('half-open')

    await expect(breaker.run(async () => 'recovered')).resolves.toBe('recovered')
    expect(breaker.state).toBe('closed')
  })

  it('reopens if the probe fails', async () => {
    let clock = 0
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetAfterMs: 1000,
      now: () => clock,
    })

    await expect(breaker.run(failing)).rejects.toThrow('down')
    clock = 1500
    await expect(breaker.run(failing)).rejects.toThrow('down')
    expect(breaker.state).toBe('open')
  })
})

describe('idempotency', () => {
  it('collapses concurrent calls with the same key onto one execution', async () => {
    const cache = new IdempotencyCache<string>()
    const task = vi.fn().mockResolvedValue('once')

    const [a, b, c] = await Promise.all([
      cache.run('k', task),
      cache.run('k', task),
      cache.run('k', task),
    ])

    expect([a, b, c]).toEqual(['once', 'once', 'once'])
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('serves a repeat call from cache within the TTL', async () => {
    const cache = new IdempotencyCache<string>(1000, () => 0)
    const task = vi.fn().mockResolvedValue('v')

    await cache.run('k', task)
    await cache.run('k', task)

    expect(task).toHaveBeenCalledTimes(1)
  })

  it('re-executes after the TTL expires', async () => {
    let clock = 0
    const cache = new IdempotencyCache<string>(1000, () => clock)
    const task = vi.fn().mockResolvedValue('v')

    await cache.run('k', task)
    clock = 2000
    await cache.run('k', task)

    expect(task).toHaveBeenCalledTimes(2)
  })

  it('keeps different keys independent', async () => {
    const cache = new IdempotencyCache<string>()
    const task = vi.fn().mockResolvedValue('v')

    await Promise.all([cache.run('a', task), cache.run('b', task)])

    expect(task).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure', async () => {
    const cache = new IdempotencyCache<string>()
    const task = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('ok')

    await expect(cache.run('k', task)).rejects.toThrow('x')
    await expect(cache.run('k', task)).resolves.toBe('ok')
  })
})

describe('structured logging', () => {
  function capture() {
    const records: LogRecord[] = []
    return { records, sink: (r: LogRecord) => records.push(r) }
  }

  it('emits machine-readable records carrying a correlation id', () => {
    const { records, sink } = capture()
    new Logger('abc123', 'info', sink).info('thing.happened', { count: 2 })

    expect(records[0]).toMatchObject({
      level: 'info',
      event: 'thing.happened',
      correlationId: 'abc123',
      count: 2,
    })
    expect(() => JSON.stringify(records[0])).not.toThrow()
  })

  it('shares the correlation id with children, which is the point of it', () => {
    const { records, sink } = capture()
    const parent = new Logger('trace-1', 'debug', sink)
    parent.child({ component: 'player' }).info('a')
    parent.child({ component: 'search' }).info('b')

    expect(records.map((r) => r.correlationId)).toEqual(['trace-1', 'trace-1'])
    expect(records[0].component).toBe('player')
  })

  it('respects the minimum level', () => {
    const { records, sink } = capture()
    const log = new Logger('x', 'warn', sink)
    log.debug('skipped')
    log.info('skipped')
    log.warn('kept')
    expect(records).toHaveLength(1)
  })

  it('never lets meeting content reach a log line', () => {
    const { records, sink } = capture()
    new Logger('x', 'info', sink).info('summarised', {
      transcript: 'Priya: the contract says near real time',
      note: 'sensitive',
      contact: 'priya@northbeam.io',
    })

    expect(records[0].transcript).toBe('[redacted]')
    expect(records[0].note).toBe('[redacted]')
    expect(records[0].contact).toBe('[email removed]')
  })

  it('times a span and records the failure without throwing it away', async () => {
    const { records, sink } = capture()
    const log = new Logger('x', 'info', sink)

    await expect(log.span('work', async () => Promise.reject(new Error('nope')))).rejects.toThrow(
      'nope',
    )
    expect(records[0]).toMatchObject({ level: 'error', outcome: 'error', errorMessage: 'nope' })
    expect(typeof records[0].durationMs).toBe('number')
  })
})

describe('metrics', () => {
  it('counts and summarises', () => {
    const m = new Metrics()
    m.increment('repository.retry')
    m.increment('repository.retry')
    m.observe('latency', 10)
    m.observe('latency', 30)

    const snap = m.snapshot()
    expect(snap.counters['repository.retry']).toBe(2)
    expect(snap.p50.latency).toBeGreaterThanOrEqual(10)
  })

  it('bounds its sample buffer so it cannot leak', () => {
    const m = new Metrics()
    for (let i = 0; i < 1000; i++) m.observe('latency', i)
    expect(m.percentile('latency', 50)).toBeGreaterThan(800)
  })
})
