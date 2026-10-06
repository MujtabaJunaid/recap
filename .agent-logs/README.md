# Agent logs

Prompts and responses from the agent session that built this repository, captured as the
work happened and committed incrementally rather than in one lump at the end.

Each file is one segment of the session, numbered in order:

- `00-brief.md` — the task as given, and the constraints that shaped the build
- `01-orientation.md` — environment check and the stack/deployment decision
- `02-product-scope.md` — what was built first, what was cut, and why
- `03-implementation.md` — the build itself, file by file
- `04-review-pass.md` — the review pass over the finished code and what was fixed

The harness used for this session writes its own transcript; these files are the
decision record that goes with it.
