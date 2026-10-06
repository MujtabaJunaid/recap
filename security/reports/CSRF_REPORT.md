# CSRF Security Report

## Status: PASS

## Findings

**No cookies are used anywhere.** `document.cookie` appears nowhere in the codebase, and
the proxy never issues `Set-Cookie`. The session token is held in `localStorage` and sent
explicitly as an `Authorization: Bearer` header.

That design choice is what makes CSRF structurally impossible here. A cross-site form
POST or `<img>` request cannot attach an `Authorization` header — only same-origin
JavaScript that can read `localStorage` can do that, and that is already the attacker
having XSS, which is a different and worse problem.

**State-changing endpoints:**

| Endpoint | Protection |
| --- | --- |
| `POST /api/auth/login` | No ambient credential exists to ride on. Rate limited. |
| `POST /api/action-plan` | Requires `Authorization: Bearer`, which a cross-site form cannot set. |

**GET routes that change state: none.** `/health` is the only GET and it is read-only.

**Preflight.** Because the request sets `authorization` and `content-type:
application/json`, it is not a CORS "simple request", so the browser sends an `OPTIONS`
preflight first. The proxy answers that preflight with its origin allowlist, giving a
second independent barrier.

## What's at risk

Nothing from this category.

## What's already secure

- Header-based auth instead of cookie-based, which removes the attack class rather than
  mitigating it.
- Origin allowlist checked on every request, not only preflights.
- `localStorage` is origin-scoped, so another site cannot read the token.

## Recommendations

If cookies are ever introduced — for refresh-token rotation, most likely — then all of
the following become required at once: `HttpOnly`, `Secure`, `SameSite=Lax` or `Strict`,
and a CSRF token on every state-changing endpoint. Moving to cookies without those is a
regression from where this build already is.
