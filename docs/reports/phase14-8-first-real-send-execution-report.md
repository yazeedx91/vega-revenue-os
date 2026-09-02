# Phase 14.8 — First Controlled Real Email / Reply Execution Report

**Date:** 2026-08-18
**Scope:** Final external readiness gate for the first Microsoft Graph outbound email and inbound reply lifecycle.
**Status:** **NO-GO for live send** — all external provisioning and execution steps are blocked by missing tenant access / credentials / Snyk token. Code-side readiness is GREEN.

---

## 1. Executive Summary

This report documents the Phase 14.8 external readiness gate. The codebase has been hardened and wired for the first real send:

- Production composition roots use real implementations (`GraphEmailProvider`, `PostgresApprovalRepository`, `FetchGraphInboundMessageFetcher`, `RegexPIIScrubber`).
- Outbound Message-ID capture via Sent Items lookup and deterministic fallback is implemented and tested.
- Local live-boundary smoke tests confirm the allowlist, kill-switch, and Graph provider boundary behave correctly.
- `pnpm audit` reports zero vulnerabilities.
- Full monorepo test suite passes.

No real Microsoft Graph send, no Graph subscription, and no live reply has been attempted because the environment does not have an Entra test tenant, Graph credentials, or a Snyk authentication token. Therefore the controlled real-send gate is **NO-GO** and must remain disabled until the external blockers are resolved.

---

## 2. Environment

| Item | Target / Required | Actual | Status |
|------|-------------------|--------|--------|
| Entra test tenant | `projectx-phase14-test` (per ADR-131) | Not provisioned | **BLOCKED — EXTERNAL CREDENTIALS / TENANT ACCESS REQUIRED** |
| Application / client ID | `GRAPH_CLIENT_ID` | Not configured | **BLOCKED** |
| Tenant ID | `GRAPH_TENANT_ID` | Not configured | **BLOCKED** |
| Client secret source | Key Vault reference or `GRAPH_CLIENT_SECRET` | Not configured | **BLOCKED** |
| Sender mailbox | `GRAPH_SENDER_ADDRESS` | Not configured | **BLOCKED** |
| Graph permission | `Mail.Send` (Application), admin-consented | Not granted | **BLOCKED** |
| `OUTREACH_LIVE_EMAIL_ENABLED` | `false` until pre-flight complete; exact `'true'` only during send | `false` (default/safe) | LOCAL / DETERMINISTIC — safe |
| `OUTREACH_MODE` | `ALLOWLIST_ONLY` | Code enforces allowlist-only | LOCAL / DETERMINISTIC — safe |
| Target Temporal endpoint | `TEMPORAL_ADDRESS` | Not validated externally | **BLOCKED** |
| Target PostgreSQL | `DATABASE_URL` with RLS + migrations | Not validated externally | **BLOCKED** |
| Target Redis | `REDIS_URL` | Not validated externally | **BLOCKED** |

**Local evidence:**
- Worker wires durable adapters only when `DATABASE_URL` is present: `apps/temporal-worker/src/main.ts`.
- Inbound module wires durable adapters only when `DATABASE_URL` is present: `apps/api/src/graph-inbound/graph-inbound.module.ts`.
- Kill switch is enforced inside `GraphEmailProvider.send()`: `packages/outreach/src/infrastructure/graph/graph-email-provider.ts`.

---

## 3. Security Preconditions

| Control | Requirement | Status |
|---------|-------------|--------|
| Entra app registered with no redirect URIs, no public flows | Phase 14.8 hardening | **BLOCKED — EXTERNAL CREDENTIALS / TENANT ACCESS REQUIRED** |
| Only `Mail.Send` application permission, admin-consented | Phase 14.8 hardening | **BLOCKED** |
| Client secret / certificate in approved secret store | `GRAPH_CLIENT_SECRET_REFERENCE` or `GRAPH_CLIENT_SECRET` | **BLOCKED** |
| Sender mailbox licensed and reachable | `GRAPH_SENDER_ADDRESS` | **BLOCKED** |
| Allowlist contains exactly one test recipient | `outreach.allowed_recipients` | **BLOCKED** — no tenant DB to populate |
| Suppression list empty for that recipient | `outreach.suppression` | **BLOCKED** |
| First-send approval record exists and is `APPROVED` | `ApprovalVerificationAdapter` re-verifies tenant, campaign, sequence, execution, actionType, expiry | LOCAL / DETERMINISTIC — logic covered by `packages/outreach/src/__tests__/send-safety-gate.spec.ts` |
| Rate/budget checks pass | `SendSafetyGate` + Redis rate limiter + campaign budget | LOCAL / DETERMINISTIC — covered by `send-safety-gate.spec.ts` and `outreach-kernel.spec.ts` |
| Atomic idempotency ready | `PostgresIdempotencyStore.claim()` / `InMemoryIdempotencyStore` | LOCAL / DETERMINISTIC — race test in `send-safety-gate.spec.ts` |
| Live-email kill switch | `OUTREACH_LIVE_EMAIL_ENABLED === 'true'` | LOCAL / DETERMINISTIC — smoke test confirms any non-`'true'` value disables send |

**Required evidence to collect once tenant is available:**
- App registration overview screenshot / CLI output.
- API permissions screenshot showing only `Mail.Send` with admin consent.
- Secret store rotation record.
- `SELECT * FROM outreach.allowed_recipients;` result showing exactly 1 row.
- `SELECT * FROM outreach.suppression WHERE email = '...';` result showing 0 rows.
- Approval record matching `tenantId`, `campaignId`, `sequenceId`, `executionId`, `actionType='OUTREACH_EMAIL_SEND'`, `status='APPROVED'`, `expiry > now`.

---

## 4. Snyk

| Item | Status | Evidence |
|------|--------|----------|
| Code scan | **BLOCKED** | `SNYK_TOKEN`/external authentication unavailable. `scripts/security/snyk-scan.js` and `pnpm security:snyk-code` are ready. |
| Dependency scan | **BLOCKED** | `SNYK_TOKEN`/external authentication unavailable. `pnpm security:snyk-deps` is ready. |

**Local alternative evidence:**
- `pnpm audit --json` reports 0 vulnerabilities (all severities).
- Vulnerable runtime packages (`@nestjs/core`, `body-parser`, `multer`, `qs`, `sanitize-html`) patched via `pnpm-workspace.yaml` overrides.

**Action required:** Set `SNYK_TOKEN` in the target CI environment and run `pnpm security:snyk-code` and `pnpm security:snyk-deps`. Attach `snyk-code-report.json` and `snyk-deps-report.json` to this report before requesting GO.

---

## 5. Graph Authentication

| Item | Status | Evidence |
|------|--------|----------|
| Token acquisition against `https://login.microsoftonline.com/{tenant}` | **BLOCKED — EXTERNAL CREDENTIALS / TENANT ACCESS REQUIRED** | `scripts/validation/graph-token-test.js` is ready but cannot run without `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`. |
| JWT `roles` claim contains `Mail.Send` | **BLOCKED** | Requires real token. |
| Token not logged or persisted | LOCAL / DETERMINISTIC | `MsalTokenProvider` returns only the access-token string to the caller; no logging in `packages/infrastructure/src/identity/msal-token-provider.ts`. |
| Telemetry redaction for `token`, `secret`, `key`, etc. | LOCAL / DETERMINISTIC | `ConsoleTelemetry` redacts those key patterns. |

**Required evidence to collect:**
- Output of `node scripts/validation/graph-token-test.js` from the target environment:
  - `Token acquired successfully`
  - `App display name: ...`
  - `App ID: ...`
  - `Mail.Send permission present: true`

---

## 6. Controlled Outbound Send

Operator launcher for the first real send:

- PREPARE: `PHASE14_TENANT_ID=<tenant> PHASE14_RECIPIENT_EMAIL=<test> pnpm phase14:prepare-real-send`
- EXECUTE: `OUTREACH_LIVE_EMAIL_ENABLED=true PHASE14_TENANT_ID=<tenant> PHASE14_OPERATOR_ID=<operator> pnpm phase14:execute-real-send [sequenceId]`
- Launcher source: `scripts/phase14-8-real-send/operator.ts`
- Launcher safety tests: `packages/outreach/src/__tests__/phase14-8-real-send-operator.spec.ts`

| Item | Status | Evidence |
|------|--------|----------|
| Actual Graph `sendMail` call | **BLOCKED — EXTERNAL CREDENTIALS / TENANT ACCESS REQUIRED** | No real tenant configured. |
| Production-safe launcher/operator command | LOCAL / DETERMINISTIC | `scripts/phase14-8-real-send/operator.ts` wires `OutreachSequenceLifecycleService`, `ApprovalApplicationService`, deterministic `WorkflowIdFactory`, `PostgresCampaignRepository`, `PostgresSequenceRepository`, `PostgresMessageExecutionRepository`, `PostgresRecipientAllowlistRepository`, `PostgresSuppressionRepository`, and `PostgresApprovalRepository`. |
| Launcher safety behavior | LOCAL / DETERMINISTIC | `packages/outreach/src/__tests__/phase14-8-real-send-operator.spec.ts` asserts that PREPARE refuses wrong mode, live email enabled, missing allowlist, and suppressed recipients; EXECUTE refuses live email disabled and requests/approves/signals the workflow. |
| `saveToSentItems: true` payload | LOCAL / DETERMINISTIC | `FetchGraphHttpClient.sendMail` sets `saveToSentItems: true`: `packages/outreach/src/infrastructure/graph/fetch-graph-http-client.ts`. |
| Post-send Sent Items lookup | LOCAL / DETERMINISTIC | `FetchGraphHttpClient.getSentMessage` + `GraphEmailProvider` lookup: `packages/outreach/src/infrastructure/graph/graph-email-provider.ts`. |
| Deterministic fallback Message-ID | LOCAL / DETERMINISTIC | Unit tests in `packages/outreach/src/__tests__/graph-email-provider.spec.ts`. |
| Provider returns `ACCEPTED` for 2xx | LOCAL / DETERMINISTIC | Unit tests in `packages/outreach/src/__tests__/graph-email-provider.spec.ts`. |
| Allowlist blocks before provider | LOCAL / DETERMINISTIC | `packages/outreach/src/__tests__/phase14-8-live-boundary-smoke.spec.ts`: live mode + empty allowlist → `not on the tenant allowlist`, 0 token calls, 0 HTTP calls. |
| Kill switch blocks before provider | LOCAL / DETERMINISTIC | `packages/outreach/src/__tests__/phase14-8-live-boundary-smoke.spec.ts`: live mode disabled → 0 HTTP calls. |

**Required evidence to collect for the real send:**
- Exact UTC timestamp of send.
- Graph HTTP request trace (sanitized: no access token, no client secret).
- Graph HTTP response status and body.
- Captured `internetMessageId` from Sent Items (e.g. `<...@...>`).
- Synthetic fallback `providerMessageId` if lookup failed.
- `providerResultId` / audit event ID.
- `tenantId`, `campaignId`, `sequenceId`, `executionId`, `workflowId`.
- `message_executions` row showing `status = ACCEPTED` and `provider_message_id`.

---

## 7. Inbound Reply

| Item | Status | Evidence |
|------|--------|----------|
| Graph change notification received | **BLOCKED — EXTERNAL CREDENTIALS / TENANT ACCESS REQUIRED** | No real subscription or send. |
| Webhook validation (`clientState`, size, shape) | LOCAL / DETERMINISTIC | `apps/api/src/graph-inbound/graph-email-webhook.controller.ts` + tests. |
| Tenant resolution from mailbox path | LOCAL / DETERMINISTIC | `GraphTenantResolver` + tests. |
| Message fetch from Graph | LOCAL / DETERMINISTIC | `FetchGraphInboundMessageFetcher` wired; stub fallback available. |
| HTML sanitization | LOCAL / DETERMINISTIC | `graph-html-sanitizer.spec.ts`. |
| PII scrubbing (`RegexPIIScrubber`) | LOCAL / DETERMINISTIC | `regex-pii-scrubber.spec.ts`; wired in production composition root. |
| Atomic deduplication | LOCAL / DETERMINISTIC | `PostgresIdempotencyStore` / `InMemoryIdempotencyStore`. |
| Reply correlation by `References` / `In-Reply-To` / `providerMessageId` | LOCAL / DETERMINISTIC | `graph-reply-correlator.spec.ts` includes real RFC2822 `internetMessageId` correlation test. |
| Conversation creation/update | LOCAL / DETERMINISTIC | `conversation-kernel.spec.ts`, `postgres-conversation-repository.spec.ts`. |
| Intent classification | LOCAL / DETERMINISTIC | `DeterministicIntentClassifier` tests. |
| Temporal `replyReceived` signal dispatch | LOCAL / DETERMINISTIC | `temporal-signal-dispatcher.spec.ts`. |

**Required evidence to collect:**
- Graph change notification JSON (redact access tokens).
- Webhook response status / latency.
- Fetched message `internetMessageId`, `subject`, `inReplyTo`, `references`.
- Correlated `executionId` / `providerMessageId`.
- `conversation` row after reply.
- Intent classification result (opt-out / meeting / positive / negative / question / uncertain).
- Next-best-action decision.
- Temporal signal dispatch log / handle.
- Workflow resume log.

---

## 8. Audit / Telemetry

| Item | Status | Evidence |
|------|--------|----------|
| Safety decision audit events | LOCAL / DETERMINISTIC | `send-safety-gate.spec.ts` asserts every denial and `ALLOW` is recorded with tenant, recipient, campaign, sequence, execution, approval, and correlation IDs. |
| Provider send audit | LOCAL / DETERMINISTIC | `graph-email-provider.spec.ts`, `phase14-8-live-boundary-smoke.spec.ts`. |
| Webhook / conversation audit | LOCAL / DETERMINISTIC | `graph-inbound-ingress.service.spec.ts`, `graph-inbound-orchestrator.service.spec.ts`. |
| Real audit log ingestion | **BLOCKED — EXTERNAL INFRASTRUCTURE REQUIRED** | Requires target Postgres/OTel collector. |

**Required evidence to collect:**
- `audit.audit_log` entries for: safety decision `ALLOW`, Graph send outcome, webhook ingress, conversation update, Temporal signal dispatch.
- OpenTelemetry spans/traces (if `TELEMETRY_MODE=opentelemetry` is enabled).

---

## 9. Kill-Switch Verification

| Test | Status | Evidence |
|------|--------|----------|
| `OUTREACH_LIVE_EMAIL_ENABLED=false` blocks Graph send | LOCAL / DETERMINISTIC | `phase14-8-live-boundary-smoke.spec.ts`: live mode disabled → 0 HTTP calls. |
| Empty allowlist blocks send before token acquisition | LOCAL / DETERMINISTIC | `phase14-8-live-boundary-smoke.spec.ts`: empty allowlist → `not on the tenant allowlist`, 0 token calls. |
| Setting `OUTREACH_LIVE_EMAIL_ENABLED` to any value other than exact `'true'` disables send | LOCAL / DETERMINISTIC | `graph-email-provider.spec.ts`. |
| Kill switch applied in real target environment | **BLOCKED — EXTERNAL CREDENTIALS / TENANT ACCESS REQUIRED** | Must be re-verified after deployment. |

**Required evidence to collect:**
- Screenshot or log showing `OUTREACH_LIVE_EMAIL_ENABLED=false` at worker/API startup.
- Post-test verification that a new send request returns `LIVE_EMAIL_DISABLED`.

---

## 10. Rollback

| Action | Mechanism | Status |
|--------|-----------|--------|
| Disable live email | `OUTREACH_LIVE_EMAIL_ENABLED=false` + restart | LOCAL / DETERMINISTIC — confirmed by smoke tests |
| Stop Graph sends at provider | Remove `DATABASE_URL` or set kill switch false | LOCAL / DETERMINISTIC |
| Delete Graph subscription | `DELETE /admin/graph/subscriptions/:id` | LOCAL / DETERMINISTIC — handler implemented in `apps/api` |
| Empty allowlist | `DELETE FROM outreach.allowed_recipients;` | **BLOCKED — EXTERNAL TENANT REQUIRED** |
| Pause/cancel workflow | Temporal UI/CLI with deterministic `WorkflowIdFactory` ID | LOCAL / DETERMINISTIC |
| Audit retention | Postgres `audit.audit_log` append-only | **BLOCKED — EXTERNAL INFRASTRUCTURE REQUIRED** |

**Required evidence to collect:**
- Worker restart log after setting `OUTREACH_LIVE_EMAIL_ENABLED=false`.
- Graph subscription `DELETE` response.
- Allowlist query showing 0 rows (if chosen).
- Exported audit log archive.

---

## 11. Security Findings

| Source | Result |
|--------|--------|
| `pnpm audit --json` | 0 vulnerabilities (info/low/moderate/high/critical). |
| `snyk code test` | **BLOCKED — SNYK_TOKEN unavailable**. |
| `snyk test --severity-threshold=medium` | **BLOCKED — SNYK_TOKEN unavailable**. |
| Manual first-party review | No secrets hardcoded; `GraphEmailProvider` does not log tokens; telemetry redacts sensitive keys; credentials sourced only from `ISecretsProvider`. |

---

## 12. GO / NO-GO Decision

**Recommendation: NO-GO for the first controlled real email send.**

The codebase is ready. The following external blockers must be resolved before changing the recommendation to GO:

1. Provision the dedicated Entra test tenant and application per `docs/implementation/phase14-8-entra-test-tenant-setup.md`.
2. Grant and admin-consent only `Mail.Send`.
3. Place `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER_ADDRESS` in the approved secret store.
4. Run `scripts/validation/graph-token-test.js` in the target environment and confirm `Mail.Send permission present: true`.
5. Run `pnpm security:snyk-code` and `pnpm security:snyk-deps` with a valid `SNYK_TOKEN`.
6. Populate exactly one allowlisted test recipient and confirm suppression is empty.
7. Execute `docs/runbooks/phase14-8-first-real-send-checklist.md` end-to-end using `pnpm phase14:prepare-real-send` and `OUTREACH_LIVE_EMAIL_ENABLED=true pnpm phase14:execute-real-send`.
8. Capture all required evidence in the placeholders above and attach it to this report.
9. Obtain explicit Architecture Review Board sign-off before broadening the allowlist.

**Next milestone:** Phase 14.8 final execution against the provisioned test tenant. Do not proceed to Phase 15 until ARB approves.
