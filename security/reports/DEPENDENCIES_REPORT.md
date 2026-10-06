# Dependencies Security Report

## Status: PASS

## Findings

**Production dependencies, frontend — three, all first-party-maintained:**

| Package | Role | Registry standing |
| --- | --- | --- |
| `react` | UI runtime | Meta, tens of millions of weekly downloads |
| `react-dom` | DOM renderer | Same project |
| `react-router-dom` | Routing | Remix/Shopify, long-established |

**Production dependencies, proxy: zero.** `server/package.json` declares no
`dependencies` and no `devDependencies`. The proxy is written against `node:http`,
`node:crypto` and global `fetch` only. No Express, no body parser, no JWT library, no
CORS middleware.

That was a deliberate choice and it is the single biggest supply-chain reduction in this
project. The usual proxy of this shape pulls in 60-100 transitive packages, each of which
can parse attacker-controlled input. Here nothing between the socket and the handler is
third-party.

**Dev dependencies: 15**, all mainstream — vite, typescript, vitest, testing-library,
tailwind, oxlint, playwright, `@types/*`. None reaches production: they are absent from
the deployed bundle and absent from the proxy entirely.

**Audit:** `npm audit --omit=dev` reports **0 vulnerabilities**.

**Lock file:** `package-lock.json` is committed and tracked. CI uses `npm ci`, so the
build installs the locked tree rather than resolving fresh.

**Typosquat check:** every production package name was read character by character
against the canonical spelling. No lookalikes (`reactt`, `react-dom-router`,
`react-router-domm`). No package is scoped to an unfamiliar publisher. No dependency was
first published recently.

**Version pinning:** ranges use `^`, which is the npm default. The lock file pins exact
resolved versions, so builds are reproducible; the range only matters when someone runs
`npm update`.

## What's at risk

Low. The dependency surface is small, well-known and locked. The realistic risk is a
compromised release of a major package, which the lock file delays but does not prevent.

## What's already secure

- A zero-dependency server is immune to this class of problem by construction.
- Lock file committed, `npm ci` in CI.
- `npm audit` clean for production.
- The build also runs `check-secrets` over the artefact, so a malicious postinstall that
  injected a credential into the bundle would be caught before deploy.

## Recommendations

1. Enable Dependabot or Renovate. Nothing currently tells anyone when a CVE lands.
2. Consider `npm ci --ignore-scripts` in CI. Install scripts are the usual vector for a
   compromised package, and nothing in this tree needs them.
3. Keep the proxy dependency-free. Each package added there reverses a deliberate and
   valuable decision.
