# Password Hashing Fix Plan

## Changes

- `server/index.js` — replace the plaintext `DEMO_PASSWORD` comparison with scrypt
  verification against `PASSWORD_HASH` (`salt:derivedKey`, hex). Constant-time compare
  over derived keys with a length guard.
- `server/index.js` — add a failed-login lockout, 10 attempts per 15 minutes per client
  IP, separate from the general rate limiter.
- Heroku config — set `PASSWORD_HASH`, then `heroku config:unset DEMO_PASSWORD`.

## New files

- `server/hash-password.mjs` — derives the verifier locally and prints only the
  derivation.

## Verification goals

- [x] Passwords verified with scrypt; no MD5, SHA-1 or bare SHA-256
- [x] No plaintext password stored in config, source, or anywhere else
- [x] Per-credential random salt
- [x] Constant-time comparison with a length guard
- [x] Correct and incorrect passwords take indistinguishable time (measured live)
- [x] Bad email and bad password are indistinguishable in status and body
- [x] Neither password nor hash appears in any log line (asserted)
- [x] No password string reaches `localStorage` (asserted in E2E)
- [x] Failed logins lock out after 10 in 15 minutes
- [ ] Per-user credentials (requires a user store)

## Manual verification (for the human)

- `heroku config --app recap-action-plan-proxy` and confirm `DEMO_PASSWORD` is gone and
  `PASSWORD_HASH` is a `salt:key` hex pair.
- To change the password:
  `node server/hash-password.mjs '<new>'` then `heroku config:set PASSWORD_HASH=<out>`.
