# 04 — Review pass

One pass, two lenses (deep-systematic and adversarial), run over the finished diff after
the first deploy was already live and verified. Per the time budget, only trivial fixes
were applied; nothing was deferred that was not genuinely cosmetic.

Seven findings, severity-ordered.

---

### 1. Share page replayed from zero instead of the clip start — **fixed**

`usePlayback.toggle()` reset `time` to `0` when the playhead had reached the end. The
share page runs the hook over the window `[start, end]`, so replaying a finished clip
dropped the playhead before the clip's own start. The viewer saw "Press play", an empty
transcript and a stalled progress bar until the clock caught up — up to 28 minutes of
nothing on the longest seeded clip.

This is the main flow for someone who is not signed in, which makes it the worst place in
the app for this bug.

Fix: the hook takes an optional `floorSec`, used as the initial value, the lower clamp in
`seek`, and the restart point in `toggle`. Keeping it in the hook rather than patching the
share page preserves one owner for playhead bounds.

```ts
export function usePlayback(durationSec: number, floorSec = 0) {
  ...
  if (!p && time >= durationSec) setTime(floorSec)
```

The fix also removed two `useEffect`s and a `useMemo` from `SharedClipPage` that existed
only to work around the old behaviour.

### 2. Transcript hid speaker names when a filter was active — **fixed**

The "is this a new speaker" check compared against `meeting.transcript[index - 1]` — the
previous line in the *full* transcript, not the previous *visible* row. With a text
filter applied, two matching lines from the same speaker rendered the second with no
avatar, no name and no timestamp, so a filtered result could appear unattributed.

Fix: compare against the previous row of the already-filtered list.

### 3. Invalid Tailwind class masked by an inline style — **fixed**

`Actions.tsx` had `h-4.5 w-4.5`, which Tailwind does not generate, with
`style={{ height: 18, width: 18 }}` next to it silently doing the real work. Replaced
with `h-4 w-4` and the inline style deleted.

### 4. Duplicated overdue rule, computed impurely during render — **fixed**

`new Date()` was being called inside the render of every action-item row, and the overdue
comparison was written out twice in two files. Both a purity warning and a reuse-first
violation: two copies of the same business rule that can drift.

Fix: one `isOverdue(due, now)` in `lib/format.ts` alongside `dueLabel`, which already owns
due-date presentation. `Actions.tsx` computes a single `now` per mount and passes it down
so every row in a render agrees.

### 5. `findActive` exported from a component file — **fixed**

The helper lived in `Transcript.tsx` and was imported by `MeetingDetail.tsx`, which both
tripped the fast-refresh lint rule and put shared logic in a component module. Moved to
`lib/transcript.ts`; both call sites now import from the one owner.

### 6. Dead `class="dark"` on `<html>` — **fixed**

Left over from scaffolding. No `dark:` variants are used — the palette is a single
committed dark theme — so the class did nothing. Removed.

### 7. Unused `useMemo` import left behind — **fixed**

Fallout from the fix in finding 1. Caught by typecheck before commit.

---

## Deliberately not changed

Three lint warnings remain. Each is a considered decision, recorded so the next person
does not "fix" them:

- **`primitives.tsx` exports `ICONS` alongside components.** A fast-refresh-only rule with
  no runtime effect. The icon paths belong next to the `Icon` component that renders them;
  splitting them into their own module to satisfy a dev-server optimisation would make the
  code worse.
- **`Actions.tsx` calls `new Date()` in a `useMemo`.** Still technically impure in render.
  Removing it properly needs a clock passed through context, which is the right answer in
  a real codebase and over-engineering here. Narrowed from once-per-row to once-per-mount,
  which removes the only consequence that could actually be observed.
- **`Shell.tsx` sets state in an effect.** This syncs the search input from the URL query
  param. The URL *is* an external system and this is exactly what effects are for —
  without it, the back button stops restoring the previous query. The lint rule cannot see
  the distinction.

## Verification performed

- `tsc --noEmit` clean.
- `oxlint src` — 7 warnings before, 3 after, all three triaged above.
- Production build succeeds under both base-path configurations.
- Live site: root returns 200; assets resolve under `/recap/`; a share deep link serves
  the app through the 404.html fallback so React Router can route it.

## Not verified, and worth saying so

No browser was available in this session, so **nothing here was confirmed by looking at a
rendered page**. Typecheck, lint, build and HTTP-level checks all pass, and the findings
above were found by reading the code — but no one has clicked a button in this app. Visual
regressions, layout breakage at specific widths, and interaction bugs that only appear on
a real render would not have been caught by any check that was run.

That is the single biggest gap in this delivery, and it is a consequence of the
environment rather than a choice about where to spend time.
