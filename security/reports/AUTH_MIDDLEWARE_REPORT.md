# Auth Middleware Security Report

## Status: PASS (one issue found and fixed during this audit)

## Findings

### Every proxy route, exhaustively

| Method | Route | Auth required | Enforced before handler | Notes |
| --- | --- | --- | --- | --- |
| GET | `/health` | no, by design | n/a | Returns booleans only, never values. |
| POST | `/api/auth/login` | no, it issues auth | n/a | Rate limited, origin checked, body capped. |
| POST | `/api/action-plan` | **yes** | yes | Bearer token verified before the body is read. |
| any | anything else | n/a | n/a | 404. |

The order in the request handler is fixed and there is no path around it:

```
OPTIONS short-circuit  ->  route match (404 otherwise)
  ->  origin allowlist (403)
  ->  auth config present (503)
  ->  per-IP rate limit (429)
  ->  [login]  validate -> verify password -> issue token
  ->  [plan]   verify Bearer token (401) -> read body -> validate (400)
               -> provider key present (503) -> generate
```

Token verification happens **before** `readBody`, so an unauthenticated caller cannot
even make the server parse a payload.

### The issue this audit found

The provider-key check was originally global, running before the login branch:

```js
if (!API_KEY) { send(res, 503, ...); return }   // ran for /api/auth/login too
```

A missing or rotated `GROQ_API_KEY` would therefore have taken **authentication** down
with it, even though login does not use that key. Found by `server/smoke-test.mjs`,
which boots the server with `GROQ_API_KEY: ''` and expects login to still work.

The first fix moved it too far the other way — ahead of input validation — so a
malformed request received `503` instead of the accurate `400`. It now sits after
validation, inside the generation branch only.

### Frontend route guard

`RequireSession` in `src/App.tsx` wraps the whole workspace. `/share/:clipId` and
`/signin` sit outside it deliberately: a clip recipient has no account. This guard
decides what the UI offers; it is not a security boundary, and `src/state/session.tsx`
says so at the top of the file. The boundary that matters is the proxy's token check.

## What's at risk

Nothing currently. Before the fix, a routine key rotation would have produced a
confusing outage in which nobody could sign in, for a reason unrelated to sign-in.

## What's already secure

- Token verification precedes body parsing on the only protected route.
- Forged, tampered and expired tokens are each rejected, with a dedicated assertion in
  the smoke test — including a self-issued token carrying a plausible payload and a
  junk MAC.
- Signature comparison is constant-time (`timingSafeEqual`) behind a length guard.
- Expiry lives inside the signed payload, so a client cannot extend its own session.
- The frontend treats an expired token as no session rather than rendering a signed-in
  shell that cannot call anything.

## Recommendations

1. There is one shared demo password and therefore one identity. Before real users:
   per-user credentials, with `sub` from the token used to scope data.
2. No refresh rotation and no revocation list. Twelve-hour tokens are acceptable for a
   demo and not for production.
