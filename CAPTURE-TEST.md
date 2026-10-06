# Capture test

## Tool and model

- **Tool:** Claude Code (CLI)
- **Model:** `claude-opus-5` (1M context). One model both plans and executes — there is
  no separate planner.
- **Automatic capture mechanism:** yes. Claude Code supports hooks in
  `.claude/settings.json` that run a command on lifecycle events. The two relevant ones
  are `UserPromptSubmit` (fires on every prompt, receives the prompt text on stdin) and
  `Stop` (fires at the end of every turn, receives `transcript_path` on stdin).

## Mechanism and config

- **Config changed:** `.claude/settings.json`
- **Script:** `.claude/hooks/capture.mjs`

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node .claude/hooks/capture.mjs prompt" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node .claude/hooks/capture.mjs response" }] }
    ]
  }
}
```

Both events deliver JSON on stdin. `UserPromptSubmit` carries the prompt verbatim.
`Stop` carries only `transcript_path`, so the script reads the session's JSONL
transcript backwards and takes the **last assistant message containing text** — which is
the final response. Thinking blocks and `tool_use` blocks are filtered out, so the log
contains the prompt and the final answer and nothing in between.

One file per session, `YYYY-MM-DD_HH-MM-SS_<session-id>.md`, written to `.agent-logs/`.
A capture failure is written to `.agent-logs/capture-errors.log` and never blocks the
session.

## Where the canaries landed

`.agent-logs/2026-10-06_20-02-00_canary-t.md`

## Canary entries, raw

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

Verified alongside the canary that the filtering works: the test transcript contained a
`thinking` block and a `tool_use` block, and neither appears in the log.

```
thinking leaked? 0 (want 0)
tool calls leaked? 0 (want 0)
```

## What did not work first

**The `Stop` hook silently wrote nothing.** The first canary run captured the prompt but
produced no response entry, with nothing in the error log.

Cause: the test harness wrote the fake transcript to `/tmp/transcript.jsonl` from Git
Bash, which maps `/tmp` to `C:\Users\hp\AppData\Local\Temp`. Node on Windows resolves the
same string to `C:\tmp\transcript.jsonl`, which does not exist, so
`finalAssistantMessage` returned `null` and the script exited cleanly. Re-running with a
Windows-resolvable absolute path captured the response correctly.

Worth recording because the failure was in the test fixture, not the hook — and because
the hook's "exit quietly when there is no transcript" behaviour, which is correct in
production, is what made it hard to see.

## Honest limitation

**The hook was installed partway through the build, not before it.**

The work on this repository began before this capture requirement was in play. The
earlier `.agent-logs/00-brief.md` through `05-hardening-pass.md` files are a **hand-written
decision record** — the brief, the stack choice, the scope reasoning, the review passes,
the bugs found and the ones I got wrong — committed incrementally alongside the code they
describe. They are genuinely contemporaneous and they are not raw transcripts, and those
are different things.

From the hook's installation onward, capture is automatic and unedited. The gap is real
and is stated here rather than disguised by backfilling entries, which would be worse
than the gap.
