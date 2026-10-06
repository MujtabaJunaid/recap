# 05 — Using it like a user, then hardening

A second session with a different instruction: drive the app the way a person would, fix
what that turns up, and take the code to production grade — scalability, idempotency,
race conditions, auth, PII.

## Getting eyes on it

The previous session shipped without anyone ever looking at a rendered page, and
`04-review-pass.md` named that as the biggest gap. The first thing done here was to close
it: Playwright and Chromium installed locally, and `scripts/walkthrough.mjs` written to
drive the real flows and screenshot each step while collecting console errors, page
errors and failed requests.

That script is the proxy for "use it like a user" and it earned its keep immediately.

A second script, `scripts/check-overflow.mjs`, measures every element against a 390px
viewport and names the offenders. It found a layout break that a desktop screenshot could
not show.

## Bugs found by reading the code adversarially

### Action ids collide across meetings — the worst one

Action items are identified as `a1`, `a2` and so on **within** a meeting. Several meetings
ship an `a1`. Completion state was keyed by the bare id, so ticking one meeting's first
action also ticked another meeting's first action — visible immediately on the
cross-meeting `/actions` view.

Every cross-meeting reference is now qualified as `meetingId:actionId`, and two tests
pin the isolation in both directions.

### Completion state was a toggle set, which is not idempotent

The old model stored a set of "toggled" ids and XORed against the seed value. Applying the
same user intent twice flipped it back, and the stored state was order-dependent — it
could not be replayed, merged or synced.

It now stores the **resolved** value per key. `setActionDone(id, true)` twice is a no-op.
This is the difference between a toggle and an idempotent write, and it is what lets the
same state survive a multi-tab merge.

### Clip creation duplicated

Clip ids were `local-${Date.now()}`: two clips in the same millisecond collide, and
clicking "Clip this moment" twice at the same playhead produced two identical rows.

Ids are now derived from `(meetingId, start, end)` with an FNV-1a hash, so the same window
always yields the same id and a repeat is an upsert. Verified in the browser as well as in
tests — the walkthrough counts share buttons before and after a repeat clip and reports
`before=4 after=4`.

### State leaked between meetings

`/m/a` and `/m/b` are the same route, so React reused the component instance. The playhead,
summary template, open tab and locally-created clips all carried over — and if the new
meeting had no summary for the carried-over template, it falsely showed "no summary yet".

The route element is now keyed by meeting id, so navigation remounts.

### An impure reducer in the playback loop

`setPlaying(false)` was being called from inside a `setTime` updater. Updaters must be
pure; React may call them twice, and StrictMode does. Stopping at the end moved to an
effect, and the callbacks now read the playhead from a ref so they stay referentially
stable across animation frames instead of being rebuilt sixty times a second.

### Transcript auto-scroll dragged the whole page

`scrollIntoView` walks every scrollable ancestor, so following the transcript scrolled the
window as well as the pane. Replaced with an explicit `pane.scrollTo`.

### No error boundary

Any render-time throw blanked the entire app with the cause visible only in the console.
Added one that reports the message and offers a reload — and deliberately logs no
transcript content.

## Found by actually looking at it

- **The video area was dead space.** At `t=0` there is no active speaker, so the largest
  element on the most important screen said "No one speaking" into a void. It now shows a
  participant grid, which is both useful and what a call actually looks like.
- **The speaker timeline read as dust.** Lanes were 3px with transparent gaps. Taller
  lanes with a visible track behind them turned it into something you can read.
- **Mobile was broken** — the control row, transcript header and tab bar all overflowed,
  clipping content off the right edge.

The overflow fix is the one worth recording. `check-overflow.mjs` pointed at the
participant grid I had *just* added: grid and flex children default to `min-width: auto`,
so the participant names set a floor on the track width and pushed the whole column past
the viewport. `min-w-0` on the tracks let truncation work. One round later the same script
pointed at the four tab buttons, which now drop their labels below `sm` and keep an
`aria-label`.

Measuring beat guessing twice in a row.

## Production-grade work

**Scalability.** Derived analytics are memoised per meeting rather than recomputed on
every render — the meetings list was calling `speakerStats` for every card on every
filter change. Chapter bars now scale against the longest chapter instead of total
duration, so they are comparable rather than uniformly tiny.

**Races.** Both state providers listen for `storage` events, so two open tabs converge
instead of the last writer silently winning. The playback effect cancels its frame on
cleanup. Scrub-dragging listens on the window so the pointer can leave the track without
the playhead sticking.

**Storage.** Every `localStorage` access goes through `lib/storage.ts`, which swallows the
throws that happen in Safari private browsing, blocked-cookie settings and quota
exhaustion. Corrupt stored JSON hydrates to empty state instead of crashing the provider;
there is a test for that.

**Auth.** A session provider with sign-in, sign-out, capability checks and a route guard.
Share routes stay public. The header comment in `src/state/session.tsx` states plainly
that this is an access *model* and not access *control*, because there is no server — and
describes exactly what changes when there is one. Writing a client-side gate and calling
it security would have been the dishonest option.

**PII.** `lib/redaction.ts` masks emails, card and account numbers, phone numbers and
credential-shaped strings, applied at the public share boundary only — inside the
workspace the viewer is a participant and sees the transcript verbatim. The share page
tells the viewer when something was masked. This is defence in depth; the real control is
server-side scoping, and the code says so.

**CSP.** Added via meta tag. The browser immediately reported that `frame-ancestors` is
ignored when delivered that way, which is exactly the kind of thing that would otherwise
have shipped as a false sense of security. Removed, with a comment saying it needs a
response header.

## Verification

- 31 tests across idempotency, cross-meeting isolation, persistence, corrupt-state
  recovery, redaction, talk-time bounds, search ranking and formatting edge cases.
- Full walkthrough: 0 console errors, 0 page errors, 0 failed requests.
- Overflow check clean at 390px on every route.
- `tsc -b`, `oxlint`, production build all green. CI runs lint, test and build.

One test failed on first run — and it was the test that was wrong, not the code. It
asserted that another meeting's `a1` would read `false`, when that item is seeded
`done: true`, so the fallback correctly returned `true`. Rewritten to assert against the
seed value and to check isolation in both directions, which is what it should have done.

## Still not done

- No live model, no real capture, no backend. Unchanged from the first session and stated
  in the README.
- The three lint warnings triaged in `04` remain triaged.
- The walkthrough asserts that pages render and do not error. It does not assert pixel
  layout, so a visual regression could still slip through between screenshot reviews.

---

## Third pass: architecture, resilience, observability, secret hygiene

### A data-access seam instead of scattered policy

`src/data/repository.ts` is now the only thing that knows where meetings come from.
`MeetingRepository` is the interface the UI would talk to; `MeetingSource` is the
transport. Swapping `FixtureSource` for an HTTP source changes one file and no caller.

The resilience policy lives at that seam rather than at each call site, so it cannot be
applied inconsistently: de-duplicate by key, fail fast if the breaker is open, bound each
attempt with a timeout, retry transient faults with jittered backoff, emit one structured
span.

### Resilience primitives, and the bug testing them found

`lib/resilience.ts` has timeout-with-abort, bounded retry with **full jitter**
(`[0, min(max, base·2ⁿ)]` — equal-width backoff resynchronises failed clients into a
second herd), a circuit breaker with closed/open/half-open and single-probe admission,
and an idempotency cache that collapses concurrent duplicate work without caching
failures.

Writing the breaker tests surfaced a real bug in the breaker: `openedAt` was set only
when `failures === threshold`, so a **failed half-open probe** incremented past the
threshold without re-arming the window, leaving the circuit permanently half-open and
admitting a probe on every call. Now any failure at or above the threshold re-arms it.
That is a bug which would only ever appear during an outage — the worst time to find it.

Honest note: with a fixture source nothing fails, so the breaker never opens today. It
exists so that the behaviour is already correct when the source is a network.

### Observability

`lib/observability.ts` emits JSON records carrying a correlation id that `child()`
inherits, so one user action keeps one id across everything it fans out into. `span()`
times an operation and emits one record with its outcome either way.

The part that matters for this product: **every field passes through redaction, and
denylisted keys are dropped outright.** A logger is the easiest place to leak a
transcript by accident, so the protection sits in the logger rather than relying on
every call site to remember. Tested directly.

Distributed tracing is not implemented and claiming it would be false — there is one
process and no hop to trace. The correlation id is the part that carries forward.

### Secret hygiene, and the trap in the obvious answer

`.env` and `.env.*` are gitignored with a committed `.env.example`. That is necessary
and not sufficient, which is the point worth recording: **Vite inlines every
`VITE_`-prefixed variable into the built JavaScript.** Gitignoring `.env` keeps a key out
of git and does nothing to keep it out of the browser. A `VITE_`-prefixed key is public
the moment it builds.

So the guard checks the artefact that actually ships. `scripts/check-secrets.mjs` scans
`dist/` for Groq, OpenAI, Anthropic, Google, GitHub, Slack and AWS key shapes plus
private-key blocks, and fails the build. It runs inside `npm run build`, so CI enforces
it on every push. It was negative-tested by planting a fake key in `dist/` and confirming
a non-zero exit, because a security check that has never failed is not known to work.

The repository still contains no key and makes no outbound request of any kind.

### Route drift, fixed properly the second time

`/signin` deployed as a 404: the route was added to the router but not to the prerender
list. The same class of mistake had already happened once. Rather than fix it a second
time by hand, `src/routes/manifest.ts` became the single list, `vite.config.ts` reads it,
and `manifest.test.ts` parses `App.tsx` and fails with the exact paths to add. The test
also asserts it found routes at all, so it cannot pass vacuously. Verified by deleting an
entry and watching it fail with a useful message.

### Verification

- 58 tests.
- Full walkthrough run **against the deployed production URL**, not just localhost: 0
  console errors, 0 page errors, 0 failed requests.
- Every route returns 200 live, including the share link and `/signin`.
- Secret scan clean; `npm audit` clean for production dependencies.

### What a reader should still be sceptical about

- The breaker, retry and idempotency cache are correct and tested, but they currently sit
  in front of a source that cannot fail. They are the right shape, not proven in anger.
- The walkthrough asserts pages render and do not error. It does not assert pixel layout.
- `ARCHITECTURE.md` lists four places this design breaks as it scales. None are fixed;
  all are named with a concrete fix, because a static bundle of eight meetings has not
  earned an inverted index or a virtualised list yet.
