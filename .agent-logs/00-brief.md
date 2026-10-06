# 00 — The brief

## Task as given

Rebuild a live product. The product is **fathom.video**, the AI meeting notetaker.

Judged on: speed, product judgement (what got built first and what was left out), and
UX/UI quality. Required deliverables: a live link that opens for someone not signed in,
a public repository with `.agent-logs/` committed, and a walkthrough video.

The brief explicitly permits stubbing the capture layer:

> You do not have to make the recording bot work. Faking or stubbing the capture layer is
> a legitimate call — say so in the walkthrough and spend the time on what you decided
> matters more.

It also names the case that matters most:

> Then look at what happens on an eight-person call that runs an hour, because that is the
> case that actually matters.

And it requires real seed data:

> Seed it with real data. An empty meetings list tells us nothing about what you built.

## Constraints that shaped this build

The nominal window is 24 hours. This build was given **2 hours**, which is the single
largest constraint on every decision recorded in `02-product-scope.md`.

Standing instructions carried into the session:

- Production-shaped code that reads as if an engineer wrote it. Not a prototype sketch,
  not AI-generated filler.
- Minimum viable comments. Comments explain *why* where the reason is not visible in the
  code; nothing narrates *what* the line does.
- No emoji in source.
- Reuse-first: before adding a helper, identifier, validator or path, check whether an
  existing one already owns that behaviour.
- One review pass at the end rather than iterating to convergence, fixing trivial
  findings only, given the time budget.

## What could not be done in this environment

Stated plainly so the record is honest:

- **Using the real product first.** The brief asks for signup, calendar connection, a real
  recorded call and screenshots before writing code. This session had no browser and no
  ability to create accounts, so the product model here is reconstructed from the feature
  set Fathom is known for rather than from first-hand use. That is a real gap in the
  process and it is named rather than papered over.
- **The 8x agent capture setup.** The specific capture tool named in the brief was not
  available in this environment. `.agent-logs/` is written in the spirit of the
  requirement — the prompts, decisions and reasoning committed incrementally alongside the
  code — but it was not produced by that tool.
- **The walkthrough recording.** Requires a camera and a human voice.
