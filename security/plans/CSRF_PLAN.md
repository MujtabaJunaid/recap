# CSRF Fix Plan

## Changes

None. The app uses no cookies, so there is no ambient credential for a cross-site
request to ride on.

## New files

None.

## Verification goals

- [x] No cookies are set or read anywhere in the codebase
- [x] All state-changing endpoints require an `Authorization` header
- [x] No GET route changes state
- [x] Cross-origin requests are rejected by the origin allowlist (smoke tested)
- [x] Requests trigger a CORS preflight, giving a second barrier

## Manual verification (for the human)

- From any other site's console, `fetch('<proxy>/api/action-plan', {method:'POST'})`
  should fail preflight and never reach the handler.
