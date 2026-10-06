import { redactForPublic } from './redaction'

/**
 * Structured logging and counters.
 *
 * Two rules drive the design. Logs are JSON so they are machine-readable the day they
 * reach a collector, and every record carries a correlation id so one user action can be
 * traced across the calls it fans out into. Meeting content never appears in a log line:
 * transcripts are the most sensitive thing this product holds, and a logger is the
 * easiest place to leak them by accident.
 */

export type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface LogRecord {
  ts: string
  level: Level
  event: string
  correlationId: string
  durationMs?: number
  [field: string]: unknown
}

export type Sink = (record: LogRecord) => void

/** Field names whose values are dropped outright rather than redacted. */
const DENYLIST = new Set(['transcript', 'text', 'lines', 'summary', 'note', 'password', 'token'])

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]'
  if (typeof value === 'string') {
    const { text } = redactForPublic(value)
    return text.length > 256 ? `${text.slice(0, 256)}…` : text
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = DENYLIST.has(k) ? '[redacted]' : scrub(v, depth + 1)
    }
    return out
  }
  return value
}

export function newCorrelationId(): string {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c) return c.randomUUID().slice(0, 8)
  return Math.random().toString(16).slice(2, 10)
}

const consoleSink: Sink = (record) => {
  const line = JSON.stringify(record)
  if (record.level === 'error') console.error(line)
  else if (record.level === 'warn') console.warn(line)
  else console.log(line)
}

export class Logger {
  private readonly correlationId: string
  private readonly minLevel: Level
  private readonly sink: Sink
  private readonly base: Record<string, unknown>

  constructor(
    correlationId: string = newCorrelationId(),
    minLevel: Level = 'info',
    sink: Sink = consoleSink,
    base: Record<string, unknown> = {},
  ) {
    this.correlationId = correlationId
    this.minLevel = minLevel
    this.sink = sink
    this.base = base
  }

  /** A child shares the parent's correlation id, which is the point of the id. */
  child(fields: Record<string, unknown>): Logger {
    return new Logger(this.correlationId, this.minLevel, this.sink, { ...this.base, ...fields })
  }

  withCorrelationId(id: string): Logger {
    return new Logger(id, this.minLevel, this.sink, this.base)
  }

  log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
    if (ORDER[level] < ORDER[this.minLevel]) return
    this.sink({
      ts: new Date().toISOString(),
      level,
      event,
      correlationId: this.correlationId,
      ...(scrub({ ...this.base, ...fields }) as Record<string, unknown>),
    })
  }

  debug(event: string, fields?: Record<string, unknown>) {
    this.log('debug', event, fields)
  }

  info(event: string, fields?: Record<string, unknown>) {
    this.log('info', event, fields)
  }

  warn(event: string, fields?: Record<string, unknown>) {
    this.log('warn', event, fields)
  }

  error(event: string, fields?: Record<string, unknown>) {
    this.log('error', event, fields)
  }

  /** Times a span and emits one record with the outcome, successful or not. */
  async span<T>(event: string, task: () => Promise<T>, fields: Record<string, unknown> = {}) {
    const started = performance.now()
    try {
      const result = await task()
      this.info(event, { ...fields, outcome: 'ok', durationMs: round(performance.now() - started) })
      return result
    } catch (error) {
      this.error(event, {
        ...fields,
        outcome: 'error',
        durationMs: round(performance.now() - started),
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Counters and latency samples. In-process only; a real deployment forwards these to a
 * collector on an interval. Kept deliberately small so it cannot become a memory leak.
 */
export class Metrics {
  private readonly counters = new Map<string, number>()
  private readonly samples = new Map<string, number[]>()
  private static readonly MAX_SAMPLES = 200

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by)
  }

  observe(name: string, value: number): void {
    const list = this.samples.get(name) ?? []
    list.push(value)
    if (list.length > Metrics.MAX_SAMPLES) list.shift()
    this.samples.set(name, list)
  }

  percentile(name: string, p: number): number | undefined {
    const list = this.samples.get(name)
    if (!list || list.length === 0) return undefined
    const sorted = [...list].sort((a, b) => a - b)
    const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
    return sorted[index]
  }

  snapshot(): { counters: Record<string, number>; p50: Record<string, number> } {
    const p50: Record<string, number> = {}
    for (const name of this.samples.keys()) {
      const value = this.percentile(name, 50)
      if (value !== undefined) p50[name] = value
    }
    return { counters: Object.fromEntries(this.counters), p50 }
  }

  reset(): void {
    this.counters.clear()
    this.samples.clear()
  }
}

export const metrics = new Metrics()

export const logger = new Logger(
  newCorrelationId(),
  import.meta.env?.DEV ? 'debug' : 'warn',
)
