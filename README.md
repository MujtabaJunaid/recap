# Recap

An AI meeting notetaker — a rebuild of [fathom.video](https://fathom.video), built in a
two-hour window.

Records, transcribes and summarises meetings, then makes the result navigable: playback
locked to a transcript, summaries you can re-cut by template, action items that link back
to the second they were committed to, clips you can share with someone who was not on the
call, and search across every word anyone has said.

## Running it

```
npm install
npm run dev
```

Build and preview the production bundle:

```
npm run build
npm run preview
```

## What is real and what is stubbed

The capture layer is stubbed. This is deliberate and the brief permits it — a bot joining
a Zoom call is infrastructure, not product judgement, and the budget went to the surface
where the product actually earns its keep.

**Stubbed**

- Recording and media storage. Playback is a wall-clock simulation driven by
  `usePlayback`, over the real transcript timeline. Every consumer is written against
  `currentTime` semantics and would work unchanged against a `<video>` element.
- Summarisation. Summaries are authored seed content rather than live model output.
- Auth and calendar OAuth. Signed-in state is represented, not enforced.

**Real**

- Everything downstream of the transcript. Transcript sync, seeking, chapters, search
  ranking, talk-time analytics, clip boundaries and the public share route are all
  computed from the seed data at runtime, not hardcoded results.

## Architecture

```
src/
  data/           seed meetings, people, shared clips; the type contract in types.ts
  lib/            derived layer — analytics, search, formatting, the playback clock
  components/     Shell, Player, Transcript, Panels, ShareDialog, primitives
  routes/         Meetings, MeetingDetail, Search, Actions, HighlightsFeed, SharedClipPage
```

Nothing derivable is stored. Talk time, speaker timelines, meeting insights and the
search index are all computed from the transcript, so the seed data has exactly one
source of truth per fact and the two cannot drift.

Talk time is estimated from word counts clamped to the gap before the next line. It is a
speaking-share signal, not diarisation output, and the UI says so where it is shown.

## Deployment

Static build to GitHub Pages via Actions. `vite.config.ts` derives its base path from
`GITHUB_REPOSITORY`, so local builds serve from `/` and the deployed site from `/recap/`
with no configuration to keep in sync. The workflow typechecks before it builds and
copies `index.html` to `404.html` so deep links survive a hard refresh.

## Agent logs

`.agent-logs/` holds the decision record for the session that built this: the brief, the
stack decision and the bug found while verifying it, the scope reasoning, the
implementation notes, and the review pass.
