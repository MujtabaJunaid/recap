# CORS Security Report

## Status: LOW — proxy correct; the static host sets a wildcard we cannot change

## Findings

### Proxy — explicit allowlist, verified live

```
ALLOWED_ORIGINS = https://mujtabajunaid.github.io, http://localhost:5180
```

Live response headers:

```
Access-Control-Allow-Origin: https://mujtabajunaid.github.io
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: content-type, authorization
Access-Control-Max-Age: 86400
Vary: origin
```

- Not a wildcard.
- An unlisted origin is **not reflected**: `corsHeaders()` falls back to the first
  allowlisted origin rather than echoing what was sent, and the request is separately
  rejected with 403 before reaching a handler. Both behaviours are smoke-tested
  (`disallowed origin is refused`, `CORS never echoes an unlisted origin`).
- `Access-Control-Allow-Credentials` is never set, which is correct: the app uses no
  cookies, and the wildcard-plus-credentials footgun cannot occur.
- Methods are exactly what the API uses. `GET` is absent from the advertised list even
  though `/health` answers it, which is slightly conservative and harmless.
- `Vary: origin` is set, so a shared cache cannot serve one origin's response to another.

### GitHub Pages — wildcard, host-controlled

```
Access-Control-Allow-Origin: *
```

GitHub's CDN sets this on every static asset. It cannot be overridden from the app. The
practical impact is low: these are public static files with no credentials, no cookies
and no API, so permitting any origin to read them grants nothing that `curl` does not
already grant. It is still worth naming, because an auditor will see it and because it
would matter instantly if an authenticated endpoint ever moved onto that origin.

## What's at risk

Little. The wildcard applies only to public static assets. The endpoint that actually
has authority — the proxy — uses a strict allowlist.

## What's already secure

- Origin is checked on every request, not only on preflight. An attacker cannot skip the
  preflight to bypass the check.
- The allowlist lives in config, so adding a staging origin needs no code change.
- The 403 path is asserted in the smoke test rather than assumed from reading the code.

## Recommendations

1. Remove `http://localhost:5180` from the production allowlist. It is there for local
   development against the live proxy and is not needed by the deployed app. Low
   severity — an attacker would need to control something on a victim's localhost:5180 —
   but it costs nothing to tighten.
2. Never host an authenticated endpoint on the Pages origin while it carries a wildcard.
