# XSS Fix Plan

## Changes

None required.

## New files

None.

## Verification goals

- [x] No `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `eval` or
      `new Function` anywhere
- [x] Search highlighting builds elements, not HTML strings
- [x] CSP `script-src 'self'` with no `unsafe-inline` or `unsafe-eval`
- [x] JSON responses are nosniffed and explicitly charset-tagged
- [x] URL parameters are validated before use

## Manual verification (for the human)

- Search for `<img src=x onerror=alert(1)>` and confirm it renders as visible text in
  the results rather than executing.
