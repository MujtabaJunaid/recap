# 01 — Orientation and stack decision

## Environment check

First action of the session, before any scaffolding, was to find out what the machine
could actually deploy with:

```
node -v        -> v24.13.0
npm -v         -> 11.6.2
git --version  -> 2.53.0.windows.1
gh --version   -> 2.87.3
gh auth status -> logged in as MujtabaJunaid, scopes: gist, read:org, repo, workflow
vercel         -> not found
netlify        -> not found
```

## Decision: Vite + React + TypeScript + Tailwind, deployed to GitHub Pages

The deployment target drove the stack choice, not the other way round.

No Vercel or Netlify CLI, but `gh` is authenticated with `repo` and `workflow` scope.
That makes **GitHub Pages via Actions** the one deployment path that is fully automatable
from this session with zero additional credentials. Everything else would have needed an
interactive login the session could not perform.

GitHub Pages serves static files only, which rules out a server runtime and a database.
That is survivable here because the product is overwhelmingly read-heavy: a meeting
archive is browsed, searched and played back far more than it is written to. Seed data
compiled into the bundle costs nothing at read time and removes an entire class of
deployment risk.

Vite over Next.js specifically because Next's static export has basePath friction on
project Pages sites, and a 2-hour budget has no room to spend twenty minutes debugging
asset URLs. Vite's `base` option plus a 404.html fallback is the boring, known-good
route.

React Router for client-side routing. The public share page needs its own full-page
layout outside the authenticated shell, which is a nested-route problem the router solves
directly.

## Base-path bug found during verification

The first production build was run as:

```
VITE_BASE=/recap/ npx vite build
```

and produced assets at `/Program Files/Git/recap/assets/...`. Git Bash on Windows was
applying MSYS path conversion to the leading slash in the environment variable.

The fix was not to escape the variable but to remove the need for it. `vite.config.ts`
now derives the base from `GITHUB_REPOSITORY`, which Actions sets automatically:

```ts
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
base: repo ? `/${repo}/` : '/'
```

Local builds stay at `/`, CI builds get `/recap/`, and nothing has to pass a path through
a shell. Verified both ways before moving on:

```
local build -> src="/assets/index-DBPp7q8S.js"
CI build    -> src="/recap/assets/index-BbMIURgw.js"
```

Worth recording because the symptom (a warning saying `"base" option should start with a
slash`, about a value that visibly started with a slash) pointed away from the real cause.
