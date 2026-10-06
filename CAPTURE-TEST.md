# Capture test

## 1. Tool and model

- **Tool:** Claude Code (CLI)
- **Model:** `claude-opus-5` (1M context). One model plans and executes; there is no
  separate planner.
- **Automatic mechanism:** yes. Claude Code runs hooks declared in `.claude/settings.json`
  on lifecycle events. The two that matter here are `UserPromptSubmit` (fires on every
  prompt, receives the prompt text on stdin) and `Stop` (fires at the end of every turn,
  receives `transcript_path` on stdin).

## 2. Mechanism and config

- **Config changed:** `C:\Users\hp\.claude\settings.json` — the **session root**, not the
  repo. Why that matters is the first failure below.
- **Script:** `.claude/hooks/capture.mjs` in this repo.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \"C:/Users/hp/projects/recap/.claude/hooks/capture.mjs\" prompt" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"C:/Users/hp/projects/recap/.claude/hooks/capture.mjs\" response" }] }
    ]
  }
}
```

The existing keys in that file (`theme`, `effortLevel`, and so on) were merged, not
replaced.

`UserPromptSubmit` carries the prompt verbatim. `Stop` carries only `transcript_path`, so
the script reads the session's JSONL transcript backwards and takes the **last assistant
message containing text** — the final response. `thinking` and `tool_use` blocks are
filtered out, so the log holds the prompt and the final answer and nothing in between.

One file per session, `YYYY-MM-DD_HH-MM-SS_<session-id>.md`, in `.agent-logs/`. A capture
failure is written to `.agent-logs/capture-errors.log` and never blocks the session.

## 3. Where the canaries landed

- `.agent-logs/2026-10-06_20-02-00_canary-t.md` — first canary
- `.agent-logs/2026-10-06_22-32-01_28eb925b.md` — the live session, captured by the hook
  firing on its own

## 4. Canary entries, raw

```
---
session_id: canary-test-0001-aaaa
date: 2026-10-06
author: MujtabaJunaid
model: claude-opus-5
tool: claude-code
project: recap
first_prompt_time: 2026-10-06T20:02:00.096Z
---

# Session Log - 2026-10-06

Session: `canary-t` | Project: `recap` | Author: `MujtabaJunaid`

---

[LOG_ENTRY type=PROMPT num=1 session=canary-t]
timestamp: 2026-10-06T20:02:00.096Z
model: claude-opus-5

CAPTURE TEST — 8x assignment, Mujtaba Junaid


[LOG_ENTRY type=RESPONSE num=1 session=canary-t]
timestamp: 2026-10-06T20:02:29.198Z
model: claude-opus-5

Capture hook is live. This response was appended to .agent-logs by the Stop hook automatically, not by hand.
```

Filtering was verified alongside it: the test transcript contained a `thinking` block and
a `tool_use` block, and neither reached the log.

```
thinking leaked? 0 (want 0)
tool calls leaked? 0 (want 0)
```

## 5. What did not work — two real failures, both silent

### The hook was installed where the session never looks

The first install put `.claude/settings.json` in the **repo** — `projects/recap/`. This
Claude Code session's project root is `C:\Users\hp`, and settings load from there, not
from whatever subdirectory happens to be in use. So the hook was never registered and
captured **nothing** for several hours of work.

The canary "passed" during that period only because the script was invoked by hand, which
proves the script works and proves nothing at all about the hook being installed. That is
exactly the failure mode the assignment warns about, and it was self-inflicted by testing
the wrong thing.

Fixed by merging the hooks into the session-root settings with an absolute path to the
script.

### The script wrote outside the repo

`LOG_DIR` was `join(process.cwd(), '.agent-logs')`. Once the hook ran for real it ran
from the session root, so it would have written to `C:\Users\hp\.agent-logs` — outside
the project, never committed, invisible.

Fixed by resolving the path from the script's own location:

```js
const LOG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.agent-logs')
```

Verified by running the hook from `C:\Users\hp` and confirming the entry landed in the
repo and that no `.agent-logs` directory appeared at the session root.

### An earlier `Stop` failure that masked itself

Before either of the above, the `Stop` branch referenced a stale variable (`serverLog`)
left behind by a refactor, in the one path that only runs when the transcript cannot be
read. The first real failure therefore printed a `ReferenceError` instead of its cause.

## The honest limitation

**Capture was not running for the first several hours of this build.**

The work started before the capture requirement was introduced, and the hook was then
installed incorrectly as described above. The files `00-brief.md` through
`05-hardening-pass.md` in `.agent-logs/` are a **hand-written decision record** — the
brief, the stack choice, the scope reasoning, the review passes, the bugs found and the
ones I got wrong — committed incrementally alongside the code they describe. They are
genuinely contemporaneous. They are not raw transcripts, and those are different things.

From the fix onward, capture is automatic and unedited. Nothing has been backfilled, and
no entry has been tidied, because a reconstructed log would be worse than an honest gap.
