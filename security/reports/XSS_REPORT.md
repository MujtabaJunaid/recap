# XSS Security Report

## Status: PASS

## Findings

**No raw HTML sink exists anywhere.** Searched `src/` and `server/` for
`dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
`document.write`, `eval(`, and `new Function`. Zero matches.

All rendering goes through React's JSX, which escapes interpolated values by default.
Transcript text, summaries, action items, generated plans and the share-page content are
all rendered as text nodes.

**The one place markup-ish rendering happens** is search highlighting in
`src/lib/search.ts`. It does not build HTML — it splits the string into
`{text, hit}` segments and React renders each as a `<mark>` or `<span>` element with the
text as a child. The dangerous version of this feature (string-replacing into
`<mark>` tags and setting `innerHTML`) was never written.

**CSP as a second layer:** `script-src 'self'` with no `'unsafe-inline'`, no
`'unsafe-eval'`, no `data:` and no wildcard. Even if a sink were introduced, injected
inline script would not execute.

**Proxy responses** are `application/json; charset=utf-8` with
`X-Content-Type-Options: nosniff`, so a response body cannot be coerced into being
interpreted as HTML.

**URL-derived values** reaching the DOM: `?t=` is parsed with `Number()` and checked
with `Number.isFinite` before use; `:id` and `:clipId` are used only as map lookups and
render as text when not found.

## What's at risk

Nothing identified.

## What's already secure

- The architecture has no HTML-rendering path at all, which is stronger than sanitising
  one.
- CSP would contain an injected sink even if one appeared.
- JSON responses are typed and nosniffed.

## Recommendations

1. If rich text is ever needed — formatted summaries, say — render Markdown to a
   React element tree rather than to an HTML string. Reach for DOMPurify only if raw
   HTML genuinely cannot be avoided.
2. Keep `script-src` free of `'unsafe-inline'`. A CSP nonce is the right answer if an
   inline script is ever required.
