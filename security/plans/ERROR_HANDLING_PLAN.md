# Error Handling Fix Plan

## Changes

- `server/index.js` — add `process.on('unhandledRejection')` and
  `process.on('uncaughtException')` that log structurally and exit non-zero, letting the
  platform restart rather than running on in an undefined state.

## New files

None.

## Verification goals

- [x] Every response goes through one `send()` helper
- [x] No stack trace, file path, or library name in any client response (asserted)
- [x] Full error detail logged server-side only
- [x] Emails are logged as a digest, never in plaintext
- [x] No API docs, GraphQL playground, or framework debug endpoint exists (verified live)
- [x] Frontend error boundary logs no transcript content
- [ ] Unhandled rejection and uncaught exception handlers
- [ ] Logs shipped to a retained store

## Manual verification (for the human)

- Decide on a log destination. Heroku's buffer is short and an incident will outlive it.
