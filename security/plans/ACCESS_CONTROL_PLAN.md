# Access Control Fix Plan

## Changes

None required for the current architecture. The items below are acceptance criteria for
the move to real data, recorded now so they are not rediscovered later.

- `server/index.js` — add `GET /api/clips/:token` resolving a random revocable token to
  a single clip.
- `server/index.js` — scope every meeting read to `token.sub` against the participants.

## New files

None at present.

## Verification goals

- [x] No proxy route accepts a resource id, so there is no IDOR surface today
- [x] Share page exposes only the clip, asserted structurally
- [x] No transcript line from outside the clip window reaches the share page
- [x] Cross-meeting action keys isolated in both directions (unit tested)
- [ ] (future) Share tokens random and revocable rather than content-derived
- [ ] (future) Every meeting read checks subject against participants

## Manual verification (for the human)

- Open a share link in a private window: no sign-in demanded, no other meeting content
  reachable from that page.
