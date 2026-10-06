# 02 — Product scope: what got built first, and what got cut

With 2 hours, scope is the whole game. This is the reasoning, written before the build.

## The core insight

Fathom's actual value is not the recording. It is that **you never have to watch the
recording again**. Everything that matters happens after the call: the summary you read
instead of attending, the action item you forgot you agreed to, the thirty seconds you
send to someone who was not there.

The capture layer is the part the brief explicitly says can be stubbed. It is also the
part that is pure infrastructure — a bot joining a Zoom call proves nothing about product
judgement. So the entire budget went to the post-call surface.

## Built, in priority order

1. **Meeting archive with real seed content.** An empty list tells you nothing, so this
   was first. Eight meetings across six teams, each with a full transcript, chapters,
   action items, highlights and template-specific summaries.

2. **Playback with a transcript locked to it.** The defining interaction. Click any line
   to jump there, watch the active line track the playhead, toggle follow-mode off when
   you want to read ahead. The playhead is a synthetic clock rather than a media element,
   which is the stub — every consumer is written against `currentTime` semantics and
   would work unchanged against a real `<video>`.

3. **Summaries with switchable templates.** Seven templates. Switching re-renders the
   same transcript under a different lens, and a template that was never generated is
   visibly disabled rather than silently missing.

4. **Action items, both in-meeting and cross-meeting.** The in-meeting tab is the obvious
   one. The `/actions` view — every commitment anyone made across every call, sorted by
   due date, filterable by owner, each linking back to the exact second it was said — is
   the one that would actually get used on a Monday morning.

5. **Clip and share.** Clip the current moment from the player, then share it. The share
   page is a separate unauthenticated route that shows the clip and its transcript and
   nothing else — not the summary, not the other 57 minutes.

6. **Search across everything.** Transcripts, summaries, action items and highlights,
   results grouped by meeting, each hit deep-linking to its timestamp. Weighted so a
   summary or action-item hit outranks a passing transcript mention.

## The one thing added beyond the original: call analytics

On a two-person 1:1, who talked is not interesting. On an eight-person hour-long call it
is the most interesting thing in the room, and it is exactly the case the brief singles
out.

So the hero meeting surfaces talk-time share per person, turn counts, who never spoke at
all, longest uninterrupted monologue, questions asked, and unowned action items. The
meetings list carries the headline version — a "Priya spoke 38%" badge — so the signal is
visible before you even open the call.

Talk time is estimated from transcript word counts clamped to the gap before the next
line. That is an approximation, and the UI says so in the panel rather than presenting it
as diarisation output.

## Deliberately cut

- **Real capture.** Explicitly permitted. Would have consumed the entire budget.
- **A backend and auth.** Static hosting was the only automatable deploy. For a read-heavy
  archive this costs nothing a reviewer can see, and it removed a whole class of risk.
- **Live LLM summarisation.** The summaries are authored seed content. Wiring an API key
  into a public static site is both a bad idea and not the thing being judged.
- **"Ask this meeting" chat.** The highest-cost, lowest-differentiation feature — it would
  have been a text box that could not answer anything without a backend. Cut entirely
  rather than shipped as a fake.
- **Calendar connection flow.** Represented as connected state in the header. The OAuth
  dance is well-understood plumbing and demonstrates nothing.
- **Mobile layout below tablet.** The grid stacks and stays usable, but the two-column
  player/transcript view is designed for a laptop, which is where this product is used.

## Seed data

Eight meetings for one fictional company, Northbeam, with storylines that cross between
them: an ingestion rewrite argued in the roadmap review, raised again in a 1:1, showing up
as a root cause in a support escalation, and constraining a customer renewal. A SCIM
commitment cut in one meeting becomes a blocker in a sales call two days later.

This matters for the demo. Search for "SCIM" and results come back from three different
meetings that genuinely relate to each other, which is what the feature looks like in
real use and not what a lorem-ipsum seed can show.

One meeting is left in `processing` state so the empty/loading path is visible.
