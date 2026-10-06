# Dependencies Fix Plan

## Changes

- `.github/dependabot.yml` — weekly updates for npm in the repository root and
  `/server`, plus GitHub Actions.
- `.github/workflows/deploy.yml` — consider `npm ci --ignore-scripts`; deferred because
  the current toolchain has not been verified to work without install scripts, and
  breaking the deploy to harden it would be a poor trade without testing first.

## New files

- `.github/dependabot.yml`

## Verification goals

- [x] Every production dependency verified as legitimate and canonically named
- [x] No package with low downloads or a recent first-publish date
- [x] Lock file committed; CI installs with `npm ci`
- [x] `npm audit --omit=dev` reports zero vulnerabilities
- [x] Proxy has zero runtime dependencies
- [ ] Automated update alerts enabled
- [ ] `--ignore-scripts` evaluated against the real toolchain

## Manual verification (for the human)

- Confirm Dependabot alerts are on in repository settings; the config file schedules
  update PRs but alerting is a separate toggle.
