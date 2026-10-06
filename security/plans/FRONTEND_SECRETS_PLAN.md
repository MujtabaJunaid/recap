# Frontend Secrets Fix Plan

## Changes

None required. Controls verified rather than added.

## New files

None.

## Verification goals

- [x] No secret key in any frontend file
- [x] All credentialed calls proxy through the backend
- [x] Only a public URL is held in a `VITE_`-prefixed variable
- [x] Production build serves no `.js.map` (404 confirmed live)
- [x] Artefact scan clean on every build, enforced in CI

## Manual verification (for the human)

- Open devtools on the live site, Network tab, and confirm every request goes to
  `mujtabajunaid.github.io` or the proxy origin, and none to a model provider.
