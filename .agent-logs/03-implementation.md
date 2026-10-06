# 03 — Implementation notes

Build order followed the scope priority in `02`: types and seed data first, then the
derived layer, then UI from the inside out.

## Data model

`src/data/types.ts` is the contract. One `Meeting` carries its transcript, chapters,
action items, highlights and a `Partial<Record<TemplateId, Summary>>` of summaries. The
`Partial` is load-bearing — it is what lets the UI distinguish "this template was
generated" from "this template exists in the product", and the template switcher renders
ungenerated ones as disabled rather than hiding them.

`TranscriptLine` carries a start time and no end time, which mirrors what a real
diarisation pipeline emits. Everything that needs a duration derives it.

## Nothing derivable is stored

The single architectural rule of this build. Talk time, speaker timelines, meeting
insights and the search index are all computed at runtime from the transcript.

The alternative — precomputing talk-time percentages into the seed file — would have been
faster to write and would have let the seed data and the transcript drift apart silently.
Editing a line of dialogue would leave a stale percentage behind with nothing to catch it.
Deriving costs a few milliseconds on data this size and makes that failure impossible.

## Speaking-duration estimate

`lib/analytics.ts` estimates how long a line took to say from its word count at 2.6
words/second, clamped to the gap before the next line:

```ts
const spoken = words / WORDS_PER_SECOND
const gap = (next ? next.t : meetingEnd) - line.t
return Math.max(1, Math.min(spoken, Math.max(gap, 1)))
```

The clamp matters. Without it, a long line followed immediately by another would overlap
its neighbour and the shares would sum past 100%. The estimate is surfaced in the UI with
a note saying it is a speaking-share signal rather than diarisation output, because
presenting an approximation as a measurement is how dashboards start lying.

## The playback stub

`usePlayback` advances a `time` value on `requestAnimationFrame`, scaled by playback rate,
stopping at the duration. It exposes `time`, `playing`, `seek`, `toggle`, `skip`, `play`
and `setRate`.

The point of the shape is that it is the `HTMLMediaElement` surface. Every consumer —
transcript sync, chapter highlighting, the scrubber, the clip editor, the share page —
reads `time` and calls `seek`. Dropping in a real `<video>` means replacing the body of
this one hook; nothing downstream changes. That is what makes the stub a stub rather than
a dead end.

The hook later gained a `floorSec` parameter during the review pass — see `04`.

## Search ranking

Hits are scored by token coverage, with a bonus for a full-phrase match, then multiplied
by a per-kind weight: summary 1.3, action 1.2, highlight 1.15, transcript 1.0.

The weighting is the product decision in that file. Searching "SCIM" should surface the
summary line that says SCIM moved to Q4 above the ninth time someone said the word in
passing. Results group by meeting rather than presenting a flat list, because the unit a
person actually wants is "which meeting was this in".

## Layout and visual decisions

Two-column on the meeting page: media and transcript on the left, a tabbed panel on the
right. The transcript pane is fixed-height and scrolls internally so the player never
leaves the viewport while reading — scrolling a transcript and losing the scrubber is the
most common way this layout gets broken.

The speaker timeline under the scrubber is one row per participant across 180 buckets.
On the eight-person call it makes the shape of the meeting legible at a glance: who holds
the floor in each stretch, and the two dense back-and-forth sections where the actual
argument happens.

Highlights render as amber bands directly on the scrubber, so clipped moments are findable
without opening a panel.

Dark palette throughout, defined as custom theme tokens rather than ad-hoc greys, so the
dozen surface levels stay consistent across fifteen files.

## Accessibility and detail passes

- Every icon-only control has an `aria-label`.
- Timecodes use `tabular-nums` so digits do not jitter as the playhead advances.
- The active transcript line is scrolled with `block: 'center'` rather than into view at
  the edge, and follow-mode can be switched off for reading ahead.
- Deep links carry `?t=` and the meeting page consumes it, then strips it from the URL so
  a later refresh does not re-seek to a stale position.
