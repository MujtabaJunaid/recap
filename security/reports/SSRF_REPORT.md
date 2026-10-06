# SSRF Security Report

## Status: PASS (not applicable)

## Findings

No code anywhere fetches a URL derived from user input.

The application makes exactly three outbound requests, all to fixed, hardcoded
destinations:

| Caller | Destination | Source of the URL |
| --- | --- | --- |
| `src/state/session.tsx` | `${VITE_API_BASE_URL}/api/auth/login` | Build-time constant |
| `src/lib/planClient.ts` | `${VITE_API_BASE_URL}/api/action-plan` | Build-time constant |
| `server/index.js` | `https://api.groq.com/openai/v1/chat/completions` | Module constant |

There is no link preview, no image proxy, no webhook tester, no import-from-URL, and no
field anywhere that accepts a URL from a user.

## What's at risk

Nothing. There is no user-controlled destination to redirect.

## What's already secure

- `UPSTREAM` in the proxy is a module-level constant, not configurable by environment.
  Even an operator with config access cannot repoint it at an internal address without a
  code change and a deploy.
- CSP `connect-src` on the frontend restricts the browser to `'self'` plus the single
  proxy origin, so even a successful XSS could not exfiltrate to an arbitrary host.

## Recommendations

If a "fetch meeting from a URL" or avatar-proxy feature is ever added, it needs: scheme
allowlist (`http`/`https` only), DNS resolution before the request with the resolved IP
checked against `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
`169.254.0.0/16` and `::1`, re-validation after every redirect, and a hard timeout.
