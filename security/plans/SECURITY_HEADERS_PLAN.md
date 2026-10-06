# Security Headers Fix Plan

## Changes

- `server/index.js` — introduce a single `SECURITY_HEADERS` constant applied by `send()`
  and by the OPTIONS short-circuit, so every response including errors and preflights
  carries CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`, CORP and Permissions-Policy.
- `server/smoke-test.mjs` — assert each header on a success response, parse HSTS for
  `max-age >= 31536000` and `includeSubDomains`, and assert headers on a 404 too.
- `index.html` — CSP already strict; `frame-ancestors` deliberately absent because it is
  ignored in a meta tag.

## New files

None.

## Verification goals

- [x] Proxy sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- [x] Headers come from one global place, not per route
- [x] Headers present on error responses, not only success
- [x] CSP declares `default-src`, `object-src 'none'`, `base-uri`, `form-action`,
      `frame-ancestors`
- [x] No `unsafe-inline` or `unsafe-eval` in any `script-src`
- [x] HSTS `max-age >= 31536000; includeSubDomains` on the proxy
- [x] App still works under the enforced CSP — 35/35 E2E, zero console violations
- [ ] Static-host headers — blocked by GitHub Pages, needs a hosting move

## Manual verification (for the human)

- Decide whether clickjacking on the static site is worth moving hosts for. If yes,
  Cloudflare Pages with a `_headers` file takes the existing CSP unchanged.
- `preload` for HSTS is deliberately not recommended: it is hard to reverse and the
  apex domain is not ours.
