# Action-plan proxy

A single small Node process whose only job is to hold a provider API key.

The frontend is a static site. A static site cannot hold a secret — anything the browser
can read, every visitor can read — so the key lives here, injected at runtime, never in
source control. That is the entire reason this exists.

If this service is not deployed, the app still works: the client falls back to its own
deterministic planner and labels the plan accordingly. This is a degradation, not an
outage.

## What it does

`POST /api/action-plan`

```json
{
  "actionText": "Run a two-week bounded spike on the ingestion rewrite",
  "ownerName": "Daniel Okafor",
  "due": "2026-10-13",
  "meetingTitle": "Q3 Roadmap Review",
  "transcriptExcerpt": "kenji: Daniel, you get two weeks...",
  "style": "momentum"
}
```

Returns a validated plan in the tool-schema shape, or `clarifyingQuestion` when the
model judged the commitment too vague to plan without guessing.

`GET /health` reports whether a key is configured, without revealing it.

## Deploying to Heroku

Heroku has **no free tier** — the smallest dyno is billed monthly. A Cloudflare Worker or
Vercel function would do this job on a free plan; Heroku is fine if you already pay for
it.

```bash
heroku login

heroku create recap-proxy

# The key is set here and only here. It never enters git.
heroku config:set GROQ_API_KEY=xxxxx --app recap-proxy
heroku config:set ALLOWED_ORIGINS=https://mujtabajunaid.github.io --app recap-proxy

# This repo has the frontend at the root, so push only the server subtree.
git subtree push --prefix server heroku main

heroku logs --tail --app recap-proxy
curl https://recap-proxy.herokuapp.com/health
```

Then point the frontend at it and rebuild. `VITE_API_BASE_URL` is public configuration,
not a secret — it is only the proxy's URL:

```bash
# In the GitHub Actions workflow, or locally:
VITE_API_BASE_URL=https://recap-proxy.herokuapp.com npm run build
```

The build extends the CSP `connect-src` to exactly that origin. Without the variable,
`connect-src` stays `'self'` and the page cannot reach any network service at all.

## Rotating the key

```bash
heroku config:set GROQ_API_KEY=new-value --app recap-proxy
```

Rotate immediately if a key has ever been pasted into a chat, an issue, a commit or a
screenshot. Deleting the message does not un-send it.

## What is protected, and what is not

**Protected**

- The key never reaches a browser.
- Origin allowlist: requests from an unlisted origin get 403.
- Per-IP token bucket, with `Retry-After` on 429.
- Request body capped at 16KB; every field length-checked before use.
- Upstream call is timeout-bounded and retries only transient failures, honouring the
  provider's own `Retry-After`.
- Logs are JSON with a correlation id and carry **no** action text and **no** transcript
  content — only the work style and timings.
- Nothing is stored. No database, no disk writes.

**Not protected, and worth being clear about**

- There is no user authentication on this endpoint. An origin allowlist is not
  authentication: a non-browser client can send any `Origin` header it likes. Before
  this serves real users, require a signed token from the frontend's own auth and verify
  it here.
- Rate limiting is in-memory, so it is per dyno. Two dynos mean two buckets. A real
  quota needs shared state such as Redis.
- Cost is bounded only by the rate limiter. Set a spend cap at the provider too.
