# Phase 14 Milestone 7b — Controlled Communication Enablement Report

## 1. Scope implemented

This milestone wires the real production-grade persistence and telemetry adapters required for controlled outbound email, and exposes a manual admin HTTP boundary for Microsoft Graph webhook subscription lifecycle management. Live external sends remain disabled by default.

- **Durable adapters**: `apps/temporal-worker/src/main.ts` now selects Postgres-backed repositories for campaign, sequence, message execution, suppression, allowlist, idempotency, audit, and conversation/lead storage when `DATABASE_URL` is present. Redis-backed rate limiting is used when `REDIS_URL` is present.
- **Telemetry**: New `ConsoleTelemetry`, `NoOpTelemetry`, and optional `OpenTelemetryAdapter` implementations behind `ITelemetry`. `ConsoleTelemetry` redacts keys matching `secret`, `token`, `password`, `credential`, `key`, `auth`, and `apiKey`.
- **Graph subscription admin API**: `POST /admin/graph/subscriptions`, `GET /admin/graph/subscriptions`, `DELETE /admin/graph/subscriptions/:id` protected by `AdminApiKeyGuard` validating `x-admin-api-key`.
- **Graph subscription client**: Lightweight fetch-based `GraphSubscriptionClient` reusing `ITokenProvider` with normalized error classification.
- **Configuration validation**: `loadControlledCommunicationConfig()` / `validateControlledCommunicationConfig()` enforce that live email requires `ALLOWLIST_ONLY` mode plus Postgres/Redis/Graph credentials.
- **Migration**: `infra/database/migrations/003_phase14_milestone7b_controlled_communication.sql` adds `outreach.graph_subscriptions` with RLS.

## 2. Files created or materially changed

### New files
- `packages/infrastructure/src/telemetry/console-telemetry.ts`
- `packages/infrastructure/src/telemetry/noop-telemetry.ts`
- `packages/infrastructure/src/telemetry/open-telemetry-adapter.ts`
- `packages/infrastructure/src/telemetry/__tests__/telemetry-adapters.spec.ts`
- `packages/infrastructure/src/config/controlled-communication-config.ts`
- `packages/infrastructure/src/testing/fake-pg-pool.ts` (updated to support `outreach.graph_subscriptions`)
- `packages/outreach/src/ports/graph-subscription-client.interface.ts`
- `packages/outreach/src/ports/graph-subscription-repository.interface.ts`
- `packages/outreach/src/infrastructure/graph/graph-subscription-client.ts`
- `packages/outreach/src/infrastructure/graph/__tests__/graph-subscription-client.spec.ts`
- `packages/outreach/src/infrastructure/postgres-graph-subscription-repository.ts`
- `packages/outreach/src/infrastructure/in-memory-graph-subscription-repository.ts`
- `packages/outreach/src/application/graph-subscription-admin.service.ts`
- `packages/outreach/src/application/__tests__/graph-subscription-admin.service.spec.ts`
- `packages/outreach/src/__tests__/postgres-graph-subscription-repository.spec.ts`
- `apps/api/src/admin/admin-api-key.guard.ts`
- `apps/api/src/admin/admin-api-key.guard.spec.ts`
- `apps/api/src/admin/admin-graph-subscription.controller.ts`
- `apps/api/src/admin/admin.module.ts`
- `infra/database/migrations/003_phase14_milestone7b_controlled_communication.sql`
- `docs/reports/phase14-milestone7b-report.md`

### Modified files
- `packages/infrastructure/src/index.ts` (exports telemetry, Redis cache, config)
- `packages/infrastructure/src/telemetry/telemetry.interface.ts` (already existed)
- `packages/infrastructure/package.json` (`@opentelemetry/api`)
- `packages/outreach/src/index.ts`
- `packages/outreach/src/ports/index.ts`
- `packages/outreach/src/infrastructure/index.ts`
- `packages/outreach/src/infrastructure/graph/index.ts`
- `packages/conversation/src/index.ts` (exports Postgres conversation/lead repos)
- `apps/api/src/app.module.ts` (imports `AdminModule`)
- `apps/api/src/graph-inbound/graph-inbound.module.ts` (durable adapter selection, telemetry)
- `apps/api/src/graph-inbound/graph-inbound-orchestrator.service.ts` (optional telemetry field)
- `apps/api/package.json` (`pg`, `@types/pg`)
- `apps/temporal-worker/src/main.ts` (durable adapter wiring, config validation)
- `apps/temporal-worker/package.json` (`pg`, `redis`, `@types/pg`)

## 3. Build evidence

```text
$ corepack pnpm -r build
Scope: 16 of 17 workspace projects
... all builds succeeded ...
```

Full workspace TypeScript build passes with no new errors. Existing deprecation warnings for `moduleResolution=node10` in `apps/api/tsconfig.json` and `apps/temporal-worker/tsconfig.json` remain non-blocking and pre-date this milestone.

## 4. Test evidence

```text
$ corepack pnpm exec jest --config jest.config.js
Test Suites: 64 passed, 64 total
Tests:       368 passed, 368 total
Snapshots:   0 total
Time:        ~10s
```

Baseline was 59 suites / 347 tests. New coverage added:
- Telemetry adapters (`NoOpTelemetry`, `ConsoleTelemetry` redaction, `OpenTelemetryAdapter` no-throw)
- `AdminApiKeyGuard` happy path, missing key, missing expected key, wrong key
- `GraphSubscriptionClient` create/list/delete/token-failure/error-classification with mocked `fetch`
- `GraphSubscriptionAdminService` create/list/delete, notification-URL allowlist, tenant isolation, audit emission
- `PostgresGraphSubscriptionRepository` save/list/delete with `FakePgPool`

No real Graph calls are made in automated tests; the Graph client uses an injected `ITokenProvider` and mocked `fetch`.

## 5. Safety boundaries enforced

| Boundary | Implementation |
|----------|----------------|
| Live email kill-switch | `OUTREACH_LIVE_EMAIL_ENABLED` defaults to `false`; worker uses `StubEmailProvider` regardless of environment. |
| Allowlist-only mode | `validateControlledCommunicationConfig` throws if live email is enabled without `OUTREACH_MODE=ALLOWLIST_ONLY`. |
| First-send approval | `SendSafetyGate` still requires `ApprovalVerificationAdapter` confirmation; no changes weaken this. |
| Suppression | Postgres-backed `PostgresSuppressionRepository` wired when `DATABASE_URL` present. |
| Rate limiting | `RedisRateLimiter` wired when `REDIS_URL` present; in-memory double fallback for local dev/tests. |
| Atomic idempotency | `PostgresIdempotencyStore` wired when `DATABASE_URL` present. |
| No automatic Graph subscriptions | Subscriptions are only created through `POST /admin/graph/subscriptions` with a valid admin key. |
| No secrets in telemetry | `ConsoleTelemetry` redacts sensitive keys; tags are string-only. |
| No real credentials committed | All secrets come from environment variables or Key Vault references; no hardcoded values. |

## 6. Configuration variables

| Variable | Purpose |
|----------|---------|
| `OUTREACH_LIVE_EMAIL_ENABLED` | Default `false`. Must remain `false` in 7b. |
| `OUTREACH_MODE` | Must be `ALLOWLIST_ONLY` if live email is enabled. |
| `DATABASE_URL` | Postgres connection string; triggers durable repository wiring. |
| `REDIS_URL` | Redis connection string; triggers Redis rate limiter. |
| `GRAPH_WEBHOOK_CALLBACK_URL` | Allowed prefix for subscription notification URLs. |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` or `GRAPH_CLIENT_SECRET_REFERENCE` | Graph credential resolution for the admin client. |
| `ADMIN_API_KEY` or `ADMIN_API_KEY_SECRET_REFERENCE` | Admin API authentication. |
| `AZURE_KEY_VAULT_URL` | Optional Key Vault secrets provider. |
| `TELEMETRY_MODE` | `console` (default), `noop`, or `opentelemetry`. |

## 7. Remaining risks and 7c prerequisites

- **GraphEmailProvider is not yet the active outbound provider**: `StubEmailProvider` is still registered in the worker. 7c must swap in `GraphEmailProvider` behind the same `SendSafetyGate` and add end-to-end live send approval workflow tests.
- **Per-tenant Graph credentials**: The admin module currently resolves a single Graph credential set from environment variables. 7c should load tenant-specific credentials from `tenant_email_config` / Key Vault.
- **Admin API key rotation**: The guard reads the key once at module bootstrap. A hot-reload/cached refresh mechanism is recommended before production.
- **Telemetry instrumentation depth**: Optional telemetry is passed into orchestration boundaries but not yet emitted from every `SendSafetyGate` decision point. 7c should add explicit counters/histograms for allowlist/suppression/approval/idempotency outcomes.
- **Redis type compatibility**: A cast is required to align `createClient` generic `RedisClientType` with the `RedisCache`/`RedisRateLimiter` constructor expectations. This should be revisited when upgrading `redis` or TypeScript.
- **Snyk/security scan**: Not executed in this environment due to missing tooling. ARB must confirm a Snyk code scan of the new first-party code and dependency changes before 7c go-live.

## 8. Recommendation

Milestone 7b implementation is complete and all automated checks pass. Per Phase 14 governance, **stop for ARB review and approval before proceeding to Phase 14.7c.**
