# Security Audit Summary

Date: 2026-10-07

Scope: both deployed surfaces, not only the source. The static site at
`https://mujtabajunaid.github.io/recap/` and the proxy at
`https://recap-action-plan-proxy-a93bd7dd6d10.herokuapp.com`. Live response headers,
served paths and endpoint behaviour were checked with `curl` and with an automated
smoke test that boots the real server.

## Results

| # | Category | Status | Report | Plan |
|---|----------|--------|--------|------|
| 1 | SECRETS_EXPOSURE | PASS | [report](reports/SECRETS_EXPOSURE_REPORT.md) | [plan](plans/SECRETS_EXPOSURE_PLAN.md) |
| 2 | DATABASE_ACCESS | N/A | [report](reports/DATABASE_ACCESS_REPORT.md) | [plan](plans/DATABASE_ACCESS_PLAN.md) |
| 3 | AUTH_MIDDLEWARE | PASS (1 fixed) | [report](reports/AUTH_MIDDLEWARE_REPORT.md) | [plan](plans/AUTH_MIDDLEWARE_PLAN.md) |
| 4 | ACCESS_CONTROL | PASS | [report](reports/ACCESS_CONTROL_REPORT.md) | [plan](plans/ACCESS_CONTROL_PLAN.md) |
| 5 | FRONTEND_SECRETS | PASS | [report](reports/FRONTEND_SECRETS_REPORT.md) | [plan](plans/FRONTEND_SECRETS_PLAN.md) |
| 6 | SSRF | PASS (N/A) | [report](reports/SSRF_REPORT.md) | [plan](plans/SSRF_PLAN.md) |
| 7 | CSRF | PASS | [report](reports/CSRF_REPORT.md) | [plan](plans/CSRF_PLAN.md) |
| 8 | SECURITY_HEADERS | MEDIUM | [report](reports/SECURITY_HEADERS_REPORT.md) | [plan](plans/SECURITY_HEADERS_PLAN.md) |
| 9 | CORS | LOW | [report](reports/CORS_REPORT.md) | [plan](plans/CORS_PLAN.md) |
| 10 | RATE_LIMITING | MEDIUM (fixed) | [report](reports/RATE_LIMITING_REPORT.md) | [plan](plans/RATE_LIMITING_PLAN.md) |
| 11 | SQL_INJECTION | PASS (N/A) | [report](reports/SQL_INJECTION_REPORT.md) | [plan](plans/SQL_INJECTION_PLAN.md) |
| 12 | XSS | PASS | [report](reports/XSS_REPORT.md) | [plan](plans/XSS_PLAN.md) |
| 13 | PAYMENT_WEBHOOKS | N/A | [report](reports/PAYMENT_WEBHOOKS_REPORT.md) | [plan](plans/PAYMENT_WEBHOOKS_PLAN.md) |
| 14 | FILE_UPLOADS | N/A | [report](reports/FILE_UPLOADS_REPORT.md) | [plan](plans/FILE_UPLOADS_PLAN.md) |
| 15 | ERROR_HANDLING | PASS | [report](reports/ERROR_HANDLING_REPORT.md) | [plan](plans/ERROR_HANDLING_PLAN.md) |
| 16 | PASSWORD_HASHING | PASS (was CRITICAL) | [report](reports/PASSWORD_HASHING_REPORT.md) | [plan](plans/PASSWORD_HASHING_PLAN.md) |
| 17 | DEPENDENCIES | PASS | [report](reports/DEPENDENCIES_REPORT.md) | [plan](plans/DEPENDENCIES_PLAN.md) |

## Critical issues

**None outstanding.** One was found and fixed during the audit.

**PASSWORD_HASHING — was CRITICAL, now PASS.** The password was stored as a plaintext
Heroku config var. Constant-time comparison of a plaintext secret is still a plaintext
secret: anyone with config access read it directly. Replaced with scrypt
(`N=16384`, 64-byte key, random 16-byte salt per credential), stored as
`salt:derivedKey`. The plaintext is not recoverable from it, exists only as a function
argument during one verification, and `DEMO_PASSWORD` was unset rather than left behind.

## Everything else fixed during this audit

| Finding | Category | Why it mattered |
| --- | --- | --- |
| `GROQ_API_KEY` check gated login | AUTH_MIDDLEWARE | A routine key rotation would have taken authentication down for an unrelated reason. Found by a smoke test booting with no key. |
| Availability check ran before validation | AUTH_MIDDLEWARE | A malformed request was told the service was down instead of what was wrong with it. |
| Proxy had no HSTS, CSP, frame or referrer headers | SECURITY_HEADERS | Confirmed missing against the live deployment. Now one global object applied to every response including errors and preflights. |
| Leftmost `x-forwarded-for` was trusted | RATE_LIMITING | Behind an appending proxy, rotating a spoofed value would have bypassed the limiter entirely. Now counts in from the right, with `TRUSTED_PROXY_HOPS=0` meaning ignore the header outright. |
| No dedicated failed-login limit | RATE_LIMITING | The general 0.5/s bucket allowed ~43k guesses per IP per day. Now 10 failures per 15 minutes. |
| Oversized body returned 503 | FILE_UPLOADS / ERROR_HANDLING | The socket was destroyed, so the router reported an outage for what was a client error. Now drained and answered 413. |

Every fix has at least one assertion in `server/smoke-test.mjs` (24 checks) or the
end-to-end suite (35 checks), so none can silently regress.

## Known limits, accepted deliberately

These are stated rather than hidden. Each is a consequence of what this build is.

1. **One shared password, one workspace.** There is no user store, so credentials cannot
   be per-person or revoked individually. Stated on the sign-in screen and in the
   in-app workspace notice.
2. **Seed data ships in the JS bundle.** A determined visitor can read every meeting from
   the source regardless of the UI. Acceptable only because the content is invented
   fixture data.
3. **GitHub Pages cannot set response headers.** No `X-Frame-Options`, no enforceable
   `frame-ancestors`, and HSTS without `includeSubDomains` — all host-controlled. The CSP
   that *is* delivered via meta tag is strict. Fixing this means changing host, not code.
4. **Rate limiting is per dyno.** In-memory buckets. Scaling past one dyno needs shared
   state.
5. **Prompt injection is mitigated, not solved.** Forced tool calling plus double schema
   validation means manipulated output fails closed to the local planner, but a crafted
   transcript could still steer a plan's wording.

## Remaining manual verification

- **Rotate `GROQ_API_KEY`.** It was transmitted in plaintext over a chat channel during
  development. `heroku config:set GROQ_API_KEY=<new> --app recap-action-plan-proxy`.
- **Set a provider spend cap.** The rate limiter bounds abuse from one client; it does
  not bound cost if the key leaks elsewhere.
- **Decide on `http://localhost:5180` in the production CORS allowlist.** Present for
  local development against the live proxy; removable at the cost of that convenience.
- **Decide whether clickjacking on the static site justifies moving hosts.** Cloudflare
  Pages would take the existing CSP unchanged via a `_headers` file.
- **Confirm Dependabot alerts are enabled** in repository settings. The config file
  schedules update PRs; alerting is a separate toggle.
- **Choose a log destination.** Heroku's buffer is short and an incident will outlive it.
