# Frontend Secrets Security Report

## Status: PASS

## Findings

**Env vars reaching the client.** Exactly one: `VITE_API_BASE_URL`, set in
`.github/workflows/deploy.yml` to the proxy's public URL. A URL is not a secret. No other
`VITE_`-prefixed variable exists.

**Sensitive calls.** The only call that needs a credential is action-plan generation, and
it does not happen in the browser. The browser calls the proxy; the proxy holds
`GROQ_API_KEY` in its own environment and calls the provider. The browser never sees the
key and cannot reach the provider directly — CSP `connect-src` lists `'self'` and the
proxy origin only.

**Source maps.** `build.sourcemap` is not enabled in `vite.config.ts`. Verified live:
`/recap/assets/index-*.js.map` returns 404.

**Bundle inspection.** `scripts/check-secrets.mjs` scans the built output for Groq,
OpenAI, Anthropic, Google, GitHub, Slack and AWS key patterns plus PEM private-key
blocks. Clean on every build; the scan runs inside `npm run build` so CI enforces it.

**Network calls from the browser.** `fetch` appears in exactly two application places:
`src/state/session.tsx` (login) and `src/lib/planClient.ts` (plan). Both target the proxy
origin. The built bundle also contains one `fetch` from Vite's `modulepreload` polyfill,
which loads the app's own same-origin JS chunks — asset loading, not an API call.

## What's at risk

Nothing identified.

## What's already secure

- The architecture makes the mistake structurally hard rather than relying on discipline:
  there is no code path in which the browser could hold a provider key, because the
  browser never talks to a provider.
- `.env.example` explains that `VITE_`-prefixed variables are inlined into the public
  bundle, which is the specific misunderstanding that causes this class of leak.
- The guard checks the artefact, not the source, so a leak introduced by a build-time
  substitution would still be caught.

## Recommendations

1. Keep `VITE_` reserved for public configuration. The build guard enforces it, but the
   convention is what stops someone trying.
2. If source maps are ever wanted for debugging, upload them to an error tracker rather
   than serving them publicly.
