# Rate Limiting Fix Plan

## Changes

- `server/index.js` — derive the client IP from the last `x-forwarded-for` entry rather
  than the first, so an appended spoof cannot win.
- `server/index.js` — add a dedicated failed-login counter, keyed by IP, stricter than
  the general bucket.
- `server/smoke-test.mjs` — assert that a spoofed `x-forwarded-for` does not reset the
  bucket.

## New files

None.

## Verification goals

- [x] Login is rate limited
- [x] Rate-limited requests return 429 with `Retry-After`
- [x] The limiter runs before any expensive work
- [x] Bucket memory is bounded
- [ ] Spoofing `x-forwarded-for` cannot reset the bucket
- [ ] Failed logins have a stricter dedicated limit (10 per 15 minutes)
- [ ] Shared limiter state before scaling past one dyno

## Manual verification (for the human)

- Confirm whether the deployment will ever run more than one dyno. If so, Redis-backed
  limiting becomes required rather than advisable.
