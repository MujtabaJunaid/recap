# CORS Fix Plan

## Changes

- Heroku config — consider narrowing `ALLOWED_ORIGINS` to the production origin only:
  `heroku config:set ALLOWED_ORIGINS=https://mujtabajunaid.github.io`. Left in place for
  now so local development can exercise the real proxy; noted as a deliberate trade.

## New files

None.

## Verification goals

- [x] Proxy origin is an explicit allowlist, never a wildcard
- [x] An unlisted origin is never echoed back
- [x] Unlisted origins are rejected 403 before the handler
- [x] `Allow-Credentials` is never set
- [x] Allowed methods list only what the API uses
- [x] `Vary: origin` present so caches cannot cross-serve
- [ ] localhost removed from the production allowlist (deliberate, pending)

## Manual verification (for the human)

- Decide whether to keep `http://localhost:5180` in the production allowlist. Removing
  it means local development must run its own proxy instance.
