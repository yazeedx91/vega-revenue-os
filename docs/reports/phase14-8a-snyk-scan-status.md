# Phase 14.8a — Snyk Scan Status

**Date:** 2026-08-18

## Summary

Snyk CLI integration was added to the repository (`snyk` devDependency, `scripts/security/snyk-scan.js`, and root `package.json` scripts). However, an actual scan could not be executed in this environment because no `SNYK_TOKEN` is configured.

## What was implemented

- `pnpm add -D -w snyk` — Snyk CLI is now a workspace devDependency.
- `scripts/security/snyk-scan.js` — cross-platform runner that:
  - validates `SNYK_TOKEN` is present,
  - runs `snyk code test --json` or `snyk test --severity-threshold=medium --json`,
  - writes the report to `snyk-code-report.json` or `snyk-deps-report.json`.
- Root scripts:
  - `pnpm security:snyk-code`
  - `pnpm security:snyk-deps`

## How to run the scan

```powershell
$env:SNYK_TOKEN="<token>"
pnpm security:snyk-code
pnpm security:snyk-deps
```

or in CI:

```yaml
env:
  SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
run: |
  pnpm security:snyk-code
  pnpm security:snyk-deps
```

## Evidence from this session

Running `pnpm security:snyk-code` without a token produces:

```
SNYK_TOKEN is required. Set it in the environment or CI secret store.
```

This confirms the integration is wired correctly and will fail closed if the token is missing.

## Blocker for GO

A clean Snyk code + dependency scan is required before the first live send. This is a remaining operational blocker, not a code blocker.
