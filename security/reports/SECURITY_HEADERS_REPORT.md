# Security Headers Report

## Status: MEDIUM — proxy fixed during this audit; static host has limits that cannot be fixed from the app

Checked both deployments live, not only the code.

## Findings

### Proxy (Heroku) — was missing most headers, now complete

Before this audit, `send()` set only `x-content-type-options` and `cache-control`. Live
check confirmed no HSTS, no framing protection, no referrer policy, no CSP.

Now every response — success, error, and preflight — carries a single
`SECURITY_HEADERS` object applied in one place, so no route can forget it:

```
content-security-policy: default-src 'none'; frame-ancestors 'none';
                         base-uri 'none'; form-action 'none'
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: no-referrer
cross-origin-resource-policy: same-site
permissions-policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
cache-control: no-store
```

`default-src 'none'` is correct here rather than lazy: this endpoint only ever returns
JSON, so every fetch directive should be denied. `base-uri`, `form-action` and
`frame-ancestors` are declared explicitly because they do not inherit from `default-src`.

Two smoke-test assertions now pin this: one on a success response checking each header
and parsing HSTS for `max-age >= 31536000` plus `includeSubDomains`, and one on a 404
confirming error responses carry them too.

### GitHub Pages — partially outside our control

Live response headers for both the HTML and a static asset:

```
Strict-Transport-Security: max-age=31556952        (no includeSubDomains)
Access-Control-Allow-Origin: *
Server: GitHub.com
```

GitHub Pages does not support custom response headers. There is no `_headers`,
`vercel.json`, `netlify.toml` or `nginx.conf` in this project because none would be read.
So:

| Header | Status on Pages | Can we fix it? |
| --- | --- | --- |
| Content-Security-Policy | meta tag on the HTML document only | Partly — meta cannot cover assets, and `frame-ancestors` is ignored in meta |
| Strict-Transport-Security | `max-age=31556952`, no `includeSubDomains` | No — host-set |
| X-Frame-Options | absent | No — needs a response header |
| X-Content-Type-Options | absent | No — needs a response header |
| Referrer-Policy | meta tag only | Partly |

The CSP that *is* delivered, via meta, is itself strict:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self' <proxy origin>;
base-uri 'self'; form-action 'self'; object-src 'none'
```

`script-src 'self'` with no `'unsafe-inline'`, no `'unsafe-eval'`, no wildcard, no
`data:`. `object-src 'none'`. `base-uri` and `form-action` declared. `connect-src` names
exactly one external origin. `style-src 'unsafe-inline'` is present and is the accepted
exception.

`frame-ancestors` was initially included and removed: the browser reported that it is
ignored when delivered via meta. Shipping a directive that does nothing is worse than
omitting it, because it reads as protection in a review.

## What's at risk

- **Clickjacking on the static site.** No `X-Frame-Options` and no enforceable
  `frame-ancestors` means the page can be framed. Impact is limited — there are no
  destructive one-click actions behind the session — but the sign-in form could be
  framed for a credential-harvesting overlay.
- **HSTS without `includeSubDomains`** leaves a theoretical gap on sibling
  `*.github.io` names. Not fixable by us.

## What's already secure

- Proxy headers are now complete, set once globally, and regression-tested.
- The frontend CSP has no `unsafe-inline` or `unsafe-eval` in `script-src` — the single
  most load-bearing directive, and the one most commonly weakened.
- No `.js.map` served, so the CSP is not undermined by handing out readable source.

## Recommendations

1. Accept the Pages limits, or move the frontend to a host that allows response headers
   (Cloudflare Pages `_headers`, Netlify `_headers`, Vercel `headers`). That is a hosting
   decision, not a code change — the CSP is already written.
2. If clickjacking matters before such a move, add a framebuster script. Given `script-src
   'self'` that would work, but it is strictly weaker than the header.
