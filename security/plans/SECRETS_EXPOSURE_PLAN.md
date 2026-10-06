# Secrets Exposure Fix Plan

## Changes

No code changes required. The controls below were already in place at audit time and
were verified rather than added.

- `.gitignore` — `.env`, `.env.*`, `!.env.example` (present)
- `scripts/check-secrets.mjs` — artefact scanner wired into `npm run build` (present)
- `.env.example`, `server/.env.example` — placeholders and the `VITE_` warning (present)

## New files

None.

## Verification goals

- [x] `git ls-files .env` returns nothing
- [x] grep for secret patterns across all source returns only the fake test fixture
- [x] No `VITE_`-prefixed var holds a secret (only `VITE_API_BASE_URL`, a public URL)
- [x] `.env.example` exists with placeholder values only
- [x] `/.env`, `/.git/config`, `/package.json`, `/backup.sql` return 404 on the live site
- [x] Directory listing is not available (`/assets/` returns 404)
- [x] No `.js.map` is served (404)
- [x] `check-secrets` fails the build on a planted key (negative-tested)

## Manual verification (for the human)

- Rotate the Groq key and confirm `/health` still reports `keyConfigured: true`.
- Set a spending cap in the Groq console.
