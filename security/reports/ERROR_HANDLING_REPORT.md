# Error Handling Security Report

## Status: PASS

## Findings

**Proxy.** Every handler path is wrapped in try/catch and every response goes through
one `send()` helper. Client-facing bodies are fixed strings with no interpolated
internals:

| Condition | Response to client | Logged server-side |
| --- | --- | --- |
| Upstream failure | `{"error":"could not generate a plan","correlationId":"..."}` | error name, message, duration |
| Bad credentials | `{"error":"email or password is incorrect"}` | subject **digest**, never the email |
| Invalid input | `{"error":"invalid request","details":[...]}` | — |
| Oversized body | `{"error":"payload too large"}` | — |
| Rate limited | `{"error":"rate limited","retryAfterMs":n}` | — |
| Unknown route | `{"error":"not found"}` | — |

The `details` array on a 400 lists field names and constraints the caller already knows
(`style is not a known work style`). It exposes the contract, not internals.

A `correlationId` is returned on 502 and matches a server log line. That is deliberate:
it makes an incident diagnosable without the client ever seeing the cause. It was used
during this build to diagnose `upstream 404` and `upstream 400` from the client side
alone.

A smoke-test assertion checks that no response body matches `at \w+ (`, `.js:\d+`,
`node_modules`, or `/app/` — a stack trace, a file path, or a Heroku slug path.

**Frontend.** `ErrorBoundary` catches render-time throws and shows the error message
plus a reload action. `componentDidCatch` logs the message and component stack only, with
an explicit comment that transcript content must not reach a logger.

**Debug and documentation endpoints.** Checked live against the deployed proxy:

```
/docs 404   /openapi.json 404   /graphql 404
/actuator/env 404   /debug 404   /.env 404   /server-status 404
```

The proxy is a hand-written `node:http` server with an explicit route table. There is no
framework to turn these on, which is why none exist.

**Debug mode.** No `DEBUG` flag, no `NODE_ENV`-conditional verbosity. Log level on the
frontend is `debug` under `import.meta.env.DEV` and `warn` otherwise.

## What's at risk

Nothing identified. The residual exposure is the `correlationId`, which is a random
8-hex-character value with no meaning outside the server's own logs.

## What's already secure

- One `send()` chokepoint, so no route can accidentally return a different shape.
- Login failures log a keyed digest of the email rather than the address, so log access
  does not become a list of users.
- The smoke test asserts the absence of internals rather than trusting review.

## Recommendations

1. Ship logs to a retained store. They are currently Heroku's rolling buffer, so an
   incident older than the buffer is undiagnosable.
2. Add an unhandled-rejection and uncaught-exception handler that logs and exits, so the
   dyno restarts cleanly rather than continuing in an unknown state.
