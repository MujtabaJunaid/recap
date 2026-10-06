# Password Hashing Security Report

## Status: PASS (was CRITICAL earlier in this audit; fixed)

## Findings

### What it was

The first version of authentication stored the password as a **plaintext Heroku config
var** and compared it with `timingSafeEqual` against the submitted value:

```js
const DEMO_PASSWORD = process.env.DEMO_PASSWORD
// ...
return timingSafeEqual(Buffer.from(supplied), Buffer.from(DEMO_PASSWORD))
```

Constant-time comparison of a plaintext secret is still a plaintext secret. Anyone with
config access — `heroku config`, the dashboard, a leaked CI log — read the password
directly.

### What it is now

scrypt, via `node:crypto`, with a random 16-byte salt per credential:

```js
const derived = scryptSync(supplied, salt, 64, { N: 16384 })
return derived.length === expected.length && timingSafeEqual(derived, expected)
```

- **Algorithm:** scrypt — memory-hard, and one of the three the brief names as
  acceptable. No MD5, SHA-1 or bare SHA-256 appears anywhere in the codebase for any
  purpose related to passwords.
- **Stored form:** `PASSWORD_HASH` as `salt:derivedKey`, both hex. The plaintext is not
  recoverable from it.
- **Cost:** `N=16384`, ~50-100ms per verification. Slow enough that offline guessing is
  expensive, fast enough that a login does not feel sluggish.
- **Comparison:** constant-time over the derived keys, behind a length guard.
- **Lifetime of the plaintext:** it exists as a function argument for the duration of one
  verification. It is never stored, never logged, never returned, and an E2E assertion
  confirms no password string reaches `localStorage`.
- **Generation:** `server/hash-password.mjs` derives the verifier locally and prints only
  the derivation. The plaintext never leaves the operator's terminal.

The old `DEMO_PASSWORD` config var was removed with `heroku config:unset`, not merely
superseded.

### Timing

Measured against the live deployment, three runs each: correct password averaged 0.960s,
wrong password 0.914s. The difference is network variance — scrypt dominates both paths,
which is the point. A wrong length does not short-circuit.

## What's at risk

Nothing in the hashing itself. The remaining weakness is organisational: there is **one
shared password for all users**, so it cannot be rotated per person and a leak affects
everyone. That is a deliberate demo trade-off, not a hashing flaw, and it is stated
on the sign-in screen.

## What's already secure

- scrypt with per-credential salt and constant-time comparison.
- Identical response shape and status for a bad email and a bad password, so the endpoint
  cannot enumerate addresses. Asserted in the smoke test by comparing both bodies.
- Failed attempts now lock out after 10 in 15 minutes, per client IP.
- The server log is asserted to contain neither the password nor the hash.

## Recommendations

1. Per-user credentials when there are real users. One shared password cannot be revoked
   for one person.
2. Consider Argon2id if a native dependency becomes acceptable; scrypt in `node:crypto`
   was chosen partly to keep the proxy dependency-free.
3. Re-derive with a higher `N` periodically as hardware improves. The stored format
   already carries its own salt, so a parameter version can be added alongside it.
