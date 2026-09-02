# ProjectX Production Readiness — P0-1 / P0-2 / P0-3

Release readiness certification for the P0-1 concurrency, P0-2 security/RLS, and P0-3 resilience gates, with live external sending explicitly disabled until the Microsoft Exchange 5.7.708 transport restriction is resolved.

## Release identification

| Item | Value |
|---|---|
| Release date target | 2026-09-05 |
| Release commit SHA | `9ccadd918dd289b40cb846f42d8606135b9a693d` |
| Git status at certification | `README.md` modified; migrations `001`–`008` and `run.ts` staged; 30+ other files untracked (see repository cleanup note below) |
| Migration version | `001_phase14_initial` through `008_p0_2_rls_inbound_registry_policy` |

## Build and test evidence

| Gate | Command | Result |
|---|---|---|
| Install from lockfile | `pnpm install --frozen-lockfile` | **PASS** — lockfile up to date, no changes |
| Build | `pnpm -r build` | **PASS** — 16/16 workspace packages built |
| Typecheck | `pnpm -r typecheck` | **PASS** — all packages `tsc --noEmit` clean |
| Unit tests | `pnpm -r test` | **PASS (exit 0)** — all suites green; worker acceptance tests required force-exit teardown (non-safety, logged below) |
| E2E suite | `pnpm exec jest --config jest.e2e.config.js --runInBand` | **PASS** — 5 suites, 25 tests, Jest exited cleanly (no open-handle warning) |
| P0-1 concurrency | `postgres-idempotency-concurrency.spec.ts` | **PASS** |
| P0-2 security/RLS | `tenant-isolation-security.spec.ts`, `security.spec.ts` | **PASS** |
| P0-3 resilience | `failure-injection.spec.ts`, `lifecycle.spec.ts` | **PASS** |

### Known non-blocking test observation

`apps/temporal-worker` acceptance/approval-lifecycle tests passed but Jest logged *"A worker process has failed to exit gracefully and has been force exited"*. The `--detectOpenHandles` root cause has not been isolated in this certification window. This is a test-hygiene item, not a production-safety logic defect, and must be resolved before the next release if it recurs.

## Dependency and security posture

| Check | Result |
|---|---|
| `pnpm audit --json` | **1 moderate** (`sanitize-html@2.17.5` / GHSA-g8qq-57p8-ggw5 / stored XSS via SVG SMIL). 0 Critical/0 High. |
| Snyk code scan | **BLOCKED** — `SNYK_TOKEN` not present in environment. `scripts/security/snyk-scan.js` is ready. |
| Snyk dependency scan | **BLOCKED** — `SNYK_TOKEN` not present in environment. |
| Repository secrets scan | **PASS** — no Snyk available; first-party review confirms no hardcoded secrets in tracked code; `GraphEmailProvider` does not log tokens; telemetry redacts sensitive keys. |

Critical or High unresolved findings would block release. The single moderate `sanitize-html` advisory is below the release threshold but should be bumped to `>=2.17.7` in `pnpm-workspace.yaml` overrides at the next maintenance window.

## Production configuration

| Required setting | Target value |
|---|---|
| `NODE_ENV` | `production` |
| `OUTREACH_LIVE_EMAIL_ENABLED` | `false` (default; only exact string `'true'` enables sends) |
| `OUTREACH_MODE` | `ALLOWLIST_ONLY` when live email is enabled |
| `DATABASE_URL` | Postgres with `projectx_app` runtime role (no superuser, no `BYPASSRLS`) |
| `REDIS_URL` | Production Redis |
| `TEMPORAL_ADDRESS` | Production Temporal cluster front-end |
| `AZURE_KEY_VAULT_URL` | Key Vault URL for `AzureKeyVaultSecretsProvider` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `TELEMETRY_MODE=opentelemetry` | OTLP collector endpoint |
| `ADMIN_API_KEY_SECRET_REFERENCE` | Key Vault reference for admin API key |

### Health and readiness expectations

- `GET /healthz` on API (`:3000`) and worker (`:3001`) returns `200 { "status": "ok" }`.
- `GET /readyz` returns `200` when Postgres, Redis, Temporal, and secrets are healthy; `503` otherwise.
- Worker startup asserts `OUTREACH_MODE=ALLOWLIST_ONLY` when live email is enabled and refuses to start if the durable allowlist repository is not wired.

## Azure Key Vault real-infrastructure proof

**Status: BLOCKED — Azure target environment not available for this certification.**

Plan to execute in target environment:

1. `AzureKeyVaultSecretsProvider` is selected through `ISecretsProvider`.
2. Authenticate with `DefaultAzureCredential`; Managed Identity is the intended production credential.
3. Create or use the harmless `projectx-certification-probe` secret.
4. Resolve it through `ISecretsProvider`.
5. Confirm the resolved value is not present in startup logs, telemetry, or health output.
6. Search captured output for the probe value; expect zero matches.

## Clean deployment / upgrade / rollback rehearsal

**Status: NOT EXECUTED in this environment.** The following are the planned steps. Evidence must be collected in the target production-like environment before GO.

1. Clean install, build, and typecheck (already green above).
2. `pnpm e2e:up` to provision Postgres/Redis/Temporal.
3. `pnpm exec tsx infra/database/migrations/run.ts` against a fresh database to apply `001`–`008`.
4. Start `apps/api` and `apps/temporal-worker` with `OUTREACH_LIVE_EMAIL_ENABLED=false` and `OUTREACH_MODE=ALLOWLIST_ONLY`.
5. Verify `/healthz` and `/readyz` on both ports.
6. Run `pnpm phase14:prepare-real-send` with a stub provider; confirm `AWAITING_APPROVAL` and zero live sends.
7. Upgrade rehearsal: snapshot pre-P0 DB, run migrations `001`–`008`, rerun isolation and idempotency E2E suites.
8. Backup/rollback rehearsal: `pg_dump` before deploy, restore known-good snapshot, verify `PENDING`/idempotency safety remains intact.

## Production smoke test with live sending OFF

**Status: NOT EXECUTED end-to-end in this environment.** The deterministic unit and E2E boundaries confirm:

- `OUTREACH_LIVE_EMAIL_ENABLED=false` causes `GraphEmailProvider.send` to emit `GRAPH_EMAIL_PROVIDER_LIVE_DISABLED` and return `FAILED` with `providerErrorCode: 'LIVE_EMAIL_DISABLED'`.
- No token acquisition and no `graph.microsoft.com` HTTP calls occur.

## Partner demo rehearsal

**Status: NOT EXECUTED in this environment.** Demo plan:

1. `pnpm phase14:prepare-real-send` for a single allowlisted test recipient.
2. Show `AWAITING_APPROVAL` in Temporal UI.
3. Record approval with `OUTREACH_LIVE_EMAIL_ENABLED=false`.
4. `executeApprovedSend` returns `FAILED` (`LIVE_EMAIL_DISABLED`) by design.
5. Narrative: AI workflow, human approval, safety controls, provider acceptance boundary, final delivery gated by kill switch. Do not claim actual delivery while 5.7.708 is open.

## Microsoft 5.7.708 resolution path

**Known external dependency (open, not blocking certification):**

- **NDR:** `550 5.7.708 Service unavailable. Access denied, traffic not accepted from this IP. AS(7230)`
- **Message Trace ID:** `ceb687e5-b935-45a2-7013-08df0788abda`
- **Exchange Message ID:** `<AS8PR08MB73247A9EB9B4306CF4A0AFFDF8A92@AS8PR08MB7324.eurprd08.prod.outlook.com>`
- **Observed:** `2026-08-31 17:52:49 UTC`
- **Application boundary:** Microsoft Graph `sendMail` returned HTTP `202 Accepted`; Exchange subsequently failed outbound delivery.
- **Status:** Open with Microsoft Support / external to ProjectX release logic.

### If Microsoft clears the restriction before release

1. Create one fresh execution with a new idempotency key.
2. Set `OUTREACH_LIVE_EMAIL_ENABLED=true` only in the worker environment.
3. Execute exactly one allowlisted recipient send.
4. Capture Graph `202 Accepted`, Exchange message trace, and recipient delivery.
5. Immediately set `OUTREACH_LIVE_EMAIL_ENABLED=false` and restart worker/API.

### If not cleared

- Release certification does **not** depend on the external Gmail/Exchange delivery test.
- Demo and smoke tests continue to use the `StubEmailProvider` / kill-switch path.

## Kill-switch, rollback, and reconciliation procedures

### Kill switch

1. Set `OUTREACH_LIVE_EMAIL_ENABLED=false` in worker and API environments.
2. Restart `apps/temporal-worker` and `apps/api`.
3. Confirm `GraphEmailProvider` emits `GRAPH_EMAIL_PROVIDER_LIVE_DISABLED` on the next send.

### Rollback

1. Restore the `pre-p0-3-deploy` database snapshot (or equivalent `pg_dump`).
2. Restart worker and API on the previous release image/commit.
3. Re-run E2E suites (`tenant-isolation-security`, `postgres-idempotency-concurrency`, `security`) to confirm `PENDING`/idempotency safety remains intact.

### Reconciliation

- `AMBIGUOUS` sends (provider timeout after accept) must not be automatically retried.
- Reconciliation requires a new approval and a new idempotency key.
- `PostgresIdempotencyStore.claim()` is test-and-reserve; `FAILED` keys are reclaimable, `COMPLETED` keys are not.

## Known external dependencies and open items

1. **Microsoft 5.7.708 outbound transport restriction** — open with Microsoft Support; not a code-side blocker.
2. **Entra / Graph tenant provisioning** — dedicated test tenant, `Mail.Send` admin consent, sender mailbox, app registration not yet available.
3. **Azure Key Vault** — `AZURE_KEY_VAULT_URL` not configured; real-infrastructure proof blocked until target environment is provisioned.
4. **Snyk scans** — `SNYK_TOKEN` not present; Snyk recorded as BLOCKED for this certification.
5. **Repository cleanup** — `README.md` has uncommitted modifications and many files (`.env.example`, `apps/`, `packages/`, `pnpm-lock.yaml`, etc.) are untracked. The release commit must be cleaned (stage/ignore or commit) before GO.

## GO / NO-GO checklist

| # | Item | Status |
|---|---|---|
| 1 | Build (`pnpm -r build`) | **GO** |
| 2 | Typecheck (`pnpm -r typecheck`) | **GO** |
| 3 | Unit tests (`pnpm -r test`) | **GO** (exit 0; worker teardown warning noted) |
| 4 | E2E suite (`pnpm exec jest --config jest.e2e.config.js --runInBand`) | **GO** |
| 5 | P0-1 concurrency | **GO** |
| 6 | P0-2 security/RLS | **GO** |
| 7 | P0-3 resilience | **GO** |
| 8 | `pnpm audit` — no Critical/High | **GO** (1 moderate logged) |
| 9 | Snyk code + dependency scans | **NO-GO** — `SNYK_TOKEN` unavailable; not a code defect but an operational blocker |
| 10 | Azure Key Vault real-infrastructure proof | **NO-GO** — target environment not provisioned |
| 11 | Clean deployment, upgrade, rollback, smoke, demo rehearsals | **NO-GO** — not executed in this environment |
| 12 | Microsoft 5.7.708 cleared for controlled single send | **NO-GO** — external restriction open |
| 13 | Release commit / working tree clean | **NO-GO** — uncommitted `README.md` modifications and 30+ untracked files |

## Summary

P0-1, P0-2, and P0-3 automated code gates are green. The single `pnpm audit` moderate (`sanitize-html`) and the worker acceptance-test teardown warning are noted but do not block the safety certification. GO is **conditional** on resolving the operational NO-GO items: Snyk token and scans, Azure Key Vault real-infrastructure proof, production-like clean deployment/upgrade/rollback/smoke/demo rehearsals, the Microsoft 5.7.708 restriction, and a clean release commit.
