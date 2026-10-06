# SSRF Fix Plan

## Changes

None. No user-supplied URL is ever fetched.

## New files

None.

## Verification goals

- [x] Every outbound request has a hardcoded or build-constant destination
- [x] No user input reaches a URL used in `fetch`
- [x] The provider URL is a module constant, not environment-configurable
- [x] CSP `connect-src` restricts the browser to self plus the proxy origin

## Manual verification (for the human)

None applicable.
