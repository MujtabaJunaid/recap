# Secrets Exposure Security Report

## Status: PASS

## Findings

Two deployed surfaces were checked: the static site on GitHub Pages and the proxy on
Heroku.

**Repository.** No secret of any kind is committed.

- `git ls-files .env` returns nothing. `.gitignore` carries `.env` and `.env.*` with an
  explicit `!.env.example` negation.
- `.env.example` (root) and `server/.env.example` contain placeholders and commentary
  only. No real values.
- A grep across `src/`, `server/`, `scripts/` and all config for `sk_live_`, `sk_test_`,
  `gsk_`, `AKIA`, `password =`, `secret =`, `token =`, `Bearer `, and connection strings
  returns only: a deliberately fake `sk-livekey9876543210abc` fixture inside
  `src/lib/lib.test.ts`, used to assert that redaction masks credential-shaped strings.

**Frontend env vars.** One is used: `VITE_API_BASE_URL`. It holds the proxy's public URL
and nothing else. Vite inlines every `VITE_`-prefixed variable into the public bundle, so
the rule is enforced rather than trusted — see below.

**Secrets at rest.** `GROQ_API_KEY`, `AUTH_SECRET` and `PASSWORD_HASH` exist only as
Heroku config vars, injected at runtime. `heroku config` is the only place they appear.
`PASSWORD_HASH` is an scrypt derivation, not a password.

**Served paths** (live, against `https://mujtabajunaid.github.io/recap/`):

```
/.env           404      /.git/config    404
/package.json   404      /server/index.js 404
/.env.example   404      /backup.sql     404
/assets/        404      (no directory listing)
```

GitHub Pages serves only the uploaded build artefact, which contains 22 files: HTML per
route, one JS bundle, one CSS bundle, two SVGs. Nothing else is reachable, and directory
listing is not available.

**Source maps.** `build.sourcemap` is not enabled. Requesting
`/recap/assets/index-*.js.map` returns 404.

## What's at risk

Nothing identified. The residual risk is procedural rather than technical: the Groq key
in use was transmitted in plaintext over a chat channel during development and should be
treated as compromised and rotated, independently of anything in this repository.

## What's already secure

- A build-time guard, `scripts/check-secrets.mjs`, scans the built artefact — not the
  source — for Groq, OpenAI, Anthropic, Google, GitHub, Slack and AWS key shapes plus
  PEM private-key blocks, and fails the build. It runs inside `npm run build`, so CI
  enforces it on every push. It was negative-tested by planting a fake `gsk_` key in
  `dist/` and confirming a non-zero exit with the file named.
- `.env.example` documents *why* a `VITE_`-prefixed variable cannot be a secret, which is
  the mistake the guard exists to catch.
- The proxy's `/health` endpoint reports `keyConfigured: true` as a boolean and never the
  value. Asserted in `server/smoke-test.mjs`.
- No credential appears in any log line; asserted in the smoke test.

## Recommendations

1. Rotate `GROQ_API_KEY`. It was exposed in transit during development.
   `heroku config:set GROQ_API_KEY=<new> --app recap-action-plan-proxy`. No code change.
2. Set a spend cap at the provider. The rate limiter bounds abuse from one client; it
   does not bound cost if the key leaks elsewhere.
