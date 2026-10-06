# Access Control Security Report

## Status: PASS, with a stated design limit

## Findings

**Proxy routes taking a resource id: none.** `/api/action-plan` receives the action text
and transcript excerpt in the request body. The caller supplies the content, so there is
no stored object to own and no IDOR surface. The server reads nothing and writes nothing.

**Frontend routes taking an id:** `/m/:id`, `/share/:clipId`, and `?t=` deep links. All
resolve against seed data already compiled into the bundle the visitor downloaded, so
there is no authorisation decision to get wrong.

**Where ownership is enforced.** Action completion is keyed `meetingId:actionId`. This is
an integrity control and it exists because of a real bug: action ids are unique only
*within* a meeting, several meetings ship an `a1`, and the unqualified key meant
completing one meeting's item silently completed another's. Two tests in
`src/state/workspace.test.tsx` pin the isolation in both directions.

**Public surface.** `/share/:clipId` renders without a session. An E2E check asserts it
exposes the clip and its transcript and nothing else: no action-item controls, no summary
panel, no analytics, and no transcript line from outside the clip window.

## What's at risk

The honest limit: the seed data ships inside the JavaScript bundle, so a determined
visitor can read every meeting from the source regardless of what the UI renders. That is
acceptable only because this content is invented fixture data. With real meetings it
would not be.

## What's already secure

- Clip scoping is asserted structurally, not by phrase matching. An earlier version of
  that check searched for the words "action items" and passed on the page's own
  reassurance copy. That false negative was found and replaced with assertions on
  controls and on out-of-window transcript lines.
- Capability checks disable controls rather than hiding them, so a read-only viewer sees
  the same page and cannot act on it.

## Recommendations

1. When meetings become real, `/share/:clipId` must resolve server-side by opaque token,
   returning only that clip. The surrounding meeting should never reach the client.
2. Every meeting read then checks `token.sub` against the participant list, on GET as
   well as on writes.
3. Share ids are currently FNV-1a derivations of `(meetingId, start, end)` — correct for
   de-duplication, wrong as a capability. A real share token must be random, revocable
   and ideally expiring.
