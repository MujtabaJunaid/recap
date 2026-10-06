# Auth Middleware Fix Plan

## Changes

- `server/index.js` — move the `GROQ_API_KEY` availability check out of the global
  preamble and into the generation branch, after request validation. Login must not
  depend on the provider key, and a malformed request must get `400` rather than `503`.
- `server/smoke-test.mjs` — boot the server with an empty `GROQ_API_KEY` so this
  ordering is asserted rather than assumed.

## New files

- `server/smoke-test.mjs` — boots the real server on a random port with throwaway
  config and exercises the full auth matrix. Runs in CI before any deploy.

## Verification goals

- [x] Unauthenticated `POST /api/action-plan` returns 401
- [x] Tampered token returns 401
- [x] Self-issued token with a plausible payload and junk MAC returns 401
- [x] Expired token returns 401
- [x] Token verification runs before the request body is read
- [x] Login succeeds while `GROQ_API_KEY` is absent
- [x] Authenticated request with invalid input returns 400, not 503
- [x] Unknown routes return 404
- [x] Security headers present on error responses as well as success

## Manual verification (for the human)

- Rotate `GROQ_API_KEY` on the live app and confirm sign-in still works while plan
  generation degrades to the local planner.
