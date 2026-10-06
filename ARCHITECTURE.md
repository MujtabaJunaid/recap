# Architecture

What this system is, what it deliberately is not, and where the seams are.

## Shape

A client-rendered SPA (React + TypeScript + Vite) deployed as static files to GitHub
Pages. **There is no backend.** That is a deployment constraint, not an oversight: the
session had no cloud credentials beyond a GitHub token, and GitHub Pages serves static
files only.

That constraint drives almost everything below, so it is stated once here rather than
apologised for repeatedly. Where a property genuinely cannot be achieved without a
server, this document says so instead of simulating it.

```
┌──────────────── browser ────────────────┐
│  routes/        screens                 │
│  components/    presentation            │
│  state/         session + workspace     │  ← providers, persisted, cross-tab
│  lib/           pure domain logic       │  ← analytics, search, redaction, resilience
│  data/          repository + fixtures   │  ← the one seam to a future backend
└─────────────────────────────────────────┘
```

Dependencies point inward. `lib/` imports nothing from `components/` or `routes/`, which
is what keeps it unit-testable without a DOM.

## Modularity

Single-purpose files, none large. The rule applied throughout: **anything derivable is
derived, never stored twice.**

| Module | Owns | Depends on |
| --- | --- | --- |
| `data/types.ts` | The domain contract | nothing |
| `data/meetings/*` | Seed content | types |
| `data/repository.ts` | Data access + resilience policy | resilience, observability |
| `lib/analytics.ts` | Talk time, speaker timeline, insights | types |
| `lib/search.ts` | Ranking and highlighting | data |
| `lib/redaction.ts` | PII masking | nothing |
| `lib/resilience.ts` | Timeout, retry, breaker, idempotency | nothing |
| `lib/observability.ts` | Structured logs, metrics | redaction |
| `lib/usePlayback.ts` | Playhead clock | nothing |
| `state/session.tsx` | Who the viewer is | storage |
| `state/workspace.tsx` | What the viewer changed | storage |

`lib/resilience.ts` and `lib/redaction.ts` have no imports from the app at all and are
portable as-is.

## 1. Fault tolerance and resilience

**Graceful degradation — implemented.**
- `localStorage` throws in Safari private browsing, with cookies blocked, and at quota.
  Every access goes through `lib/storage.ts`, which degrades to in-memory state. The app
  stays fully usable; only persistence is lost.
- Corrupt stored JSON hydrates to empty state rather than crashing the provider.
- An `ErrorBoundary` keeps a render-time throw from blanking the page.
- A meeting that is still `processing` renders its own state rather than an error.

**Circuit breaker — implemented at the seam, currently never trips.** `CircuitBreaker`
in `lib/resilience.ts` implements closed → open → half-open with single-probe admission,
and re-arms the open window if the probe fails. It wraps every repository read. With a
fixture source nothing fails, so it never opens today. It is there so that the day the
source is HTTP, failing fast is already the behaviour rather than a later retrofit.

**Retries with exponential backoff — implemented, full jitter.** Delay is uniform in
`[0, min(maxMs, base · 2ⁿ)]`. Equal-width backoff resynchronises every client that
failed at the same moment into a second thundering herd; full jitter is the standard
fix. Only transient faults retry — a `NotFoundError` never becomes a 200, so retrying it
just wastes the budget.

**Rate limiting and load shedding — implemented.** A token bucket at the repository seam
(20/s sustained, burst 40) smooths the sustained rate while still allowing the burst that
callers actually produce: idle, then several reads at once. It **rejects rather than
queues**, so backpressure is visible as an error instead of hidden as latency.

Ordering in the read pipeline is deliberate: de-duplication is outermost, so a repeated
read costs no budget at all; the limiter sits *inside* the retry loop, so a retry storm
is itself shed rather than amplifying the problem it is reacting to.

`RateLimitError` carries `retryAfterMs`, and the retry loop prefers it over its own
computed backoff — a server that says `Retry-After` knows more than our curve does.

Client-side limiting protects the backend from this tab and this tab from itself. It is
**not** a security control: a hostile client simply would not run it, so the
authoritative limit has to live server-side.

Search-as-you-type is debounced (120ms) so a burst of keystrokes costs one transcript
scan rather than one per character.

**What is not implemented:** bulkheads and graceful degradation *between services*,
because there is exactly one process.

## 2. Observability

**Structured logging — implemented.** `lib/observability.ts` emits JSON records with a
timestamp, level, event name and **correlation id**. `logger.child()` inherits the id, so
one user action keeps one id across everything it fans out into. `logger.span()` times an
operation and emits exactly one record with its outcome, successful or not.

**PII never reaches a log line.** The logger runs every field through redaction, and
drops denylisted keys (`transcript`, `text`, `summary`, `note`, `token`, …) outright. A
logger is the easiest place in a product like this to leak a transcript by accident, so
the protection is in the logger rather than at each call site. Tested.

**Metrics — implemented, in-process.** Counters and latency samples with percentiles, in
a bounded buffer so it cannot become a memory leak. A deployment would flush these to a
collector on an interval.

**Distributed tracing — not implemented, and would be dishonest to claim.** There is one
process and no network hop to trace. The correlation id is the piece that carries
forward: propagate it as a `traceparent` header at the repository seam and the spans
already emitted become real spans.

## 3. Security

**Least privilege.** `session.tsx` models capabilities (`workspace:read`,
`workspace:write`, `clip:share`) and components ask `can(...)` rather than assuming. The
share route is deliberately outside the guard — the recipient has no account.

**Defence in depth.** CSP (`default-src 'self'`, no remote or inline script, no
`object-src`), a referrer policy, a route guard, capability checks, and PII redaction at
the public boundary. `frame-ancestors` and `X-Content-Type-Options` need response
headers, which static hosting cannot set; behind a server, send both.

**The honest limit.** With no server, sign-in is an access *model*, not access *control*.
It decides what the UI offers and protects nothing, because nothing secret ships — the
seed data is public fixture content. `src/state/session.tsx` says this at the top of the
file so nobody mistakes it for security. A client-side gate presented as protection is
worse than no gate, because someone will trust it.

**Secrets — none, by construction.** There is no API key in this repository and no
`.env`. `fetch`, `XMLHttpRequest` and `WebSocket` appear nowhere in `src/`, so the
application makes no API call of any kind.

To be precise about the built artefact rather than only the source: the bundle contains
exactly one `fetch`, from Vite's `modulepreload` polyfill, which requests the app's own
JavaScript chunks from the same origin. That is asset loading, not an API call. CSP
`connect-src 'self'` would block a third-party request even if one were introduced, and
`npm run check:secrets` scans the artefact on every build.

### Why the summaries are fixtures, and how to make them real

The summaries are authored content in `src/data/meetings/*.ts`, not model output.

**A key cannot be used from this app.** Anything the browser can read, every visitor can
read — devtools, view-source, or the bundle itself. There is no "secret" storage in a
static frontend; obfuscation only changes how long it takes. A key pasted into this
codebase and pushed to a public repository is compromised from that moment, and bots
scrape public repositories for exactly this.

The supported path, which the current architecture is already shaped for:

1. Deploy a tiny proxy (Cloudflare Worker, Vercel function, any small server). The key
   lives in **its** environment, injected at runtime, never in source control.
2. The proxy authenticates the caller, enforces a per-user rate limit and a token budget,
   and forwards to the provider.
3. Implement `MeetingSource` against that proxy and pass it to
   `ResilientMeetingRepository`. Timeout, retry, backoff, breaker and idempotent
   de-duplication all apply with no other change.
4. Send an idempotency key derived from the meeting and template so a retried
   summarisation cannot be billed twice — the same discipline as `clipId`.
5. Summarise a long meeting map-reduce style: per-chapter summaries, then a reduce over
   those, so a three-hour transcript never has to fit in one context window.

**If a key has already been pasted anywhere shared — a chat, an issue, a commit — treat
it as compromised and rotate it.** Deleting the message does not un-send it.

## 4. Data and consistency

**Model.** Read-heavy and document-shaped: a meeting is one aggregate (transcript,
chapters, actions, highlights, summaries) and is almost always read whole. That is a
document store, not a relational schema; the current fixture map is a degenerate case of
one. Writes are tiny and user-scoped.

**Idempotency — implemented and tested, the strongest property here.**
- Action completion stores a **resolved value**, not a toggle. `setActionDone(k, true)`
  twice is a no-op. A toggle set is order-dependent and cannot be replayed or merged.
- Clip ids derive from `(meetingId, start, end)`, so re-clipping the same window is an
  upsert, not a duplicate.
- `IdempotencyCache` collapses concurrent and repeated calls on one key onto a single
  execution, and does **not** cache failures.
- Action keys are qualified `meetingId:actionId`, because action ids repeat across
  meetings and the unqualified key silently cross-wrote.

**Eventual consistency — the real instance here is multi-tab.** Two tabs are two
replicas. Both providers subscribe to `storage` events and reconcile, instead of the last
writer silently winning. Because writes are resolved values rather than toggles, the
merge is well-defined.

**Not implemented:** sharding, replication, message queues. There is no database.

## 5. Deployment

**Stateless — yes.** The app holds no server state; viewer state lives in that viewer's
browser. Static assets are CDN-cacheable and horizontally scalable by construction.

**CI/CD.** GitHub Actions runs `lint`, `test`, then `build` — the same three commands
available locally, deliberately, after a build once failed in CI because the gate ran
something a developer could not. A build plugin emits a real page per route from the same
data the router reads, so deep links return 200 rather than rendering out of a 404.

**Not implemented:** blue-green and canary. Pages publishes one artefact to one origin;
staged rollout needs a routing layer that does not exist here. Rollback is re-running an
earlier commit's workflow.

## Scaling: where this breaks first

Honest limits, in the order they would bite:

1. **Seed data is bundled into the JS.** Fine for 8 meetings; at a few hundred the bundle
   is the problem. Fixed by the repository seam — paginate from a backend.
2. **Search scans every transcript per query.** Acceptable at this size, O(n·m) beyond
   it. Fixed with an inverted index built once, or server-side search.
3. **The transcript renders every line.** ~160 lines is nothing; a three-hour meeting is
   thousands of DOM nodes. Fixed with windowing.
4. **Talk-time analytics are O(transcript) per meeting**, memoised per meeting. On a long
   list this belongs in a precomputed, versioned field on the stored document.

Each has a named fix and none requires reshaping the application.

## Testing

56 tests. They target the properties that are expensive to get wrong — idempotency,
cross-meeting isolation, breaker state transitions, backoff bounds and jitter, redaction,
corrupt-state recovery, talk-time bounds — rather than chasing coverage.

Two scripts stand in for manual QA: `scripts/walkthrough.mjs` drives Chromium through
every user flow and fails on any console error, and `scripts/check-overflow.mjs` measures
every element against a phone viewport. Both found real bugs that reading the code had
not.
