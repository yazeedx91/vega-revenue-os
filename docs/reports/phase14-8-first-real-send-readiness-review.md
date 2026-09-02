# Phase 14.8 — First Controlled Real Email / Reply Readiness Review

**Date:** 2026-08-18
**Scope:** GO/NO-GO review for the first controlled Microsoft Graph outbound email and its inbound reply lifecycle, after Phase 14.8a production wiring & hardening sprint.

## Executive Recommendation

**NO-GO for the live send** until the remaining operational prerequisites are satisfied, but **GO for the code wiring and dependency posture** achieved in the 14.8a sprint.

The production composition roots are now wired to real implementations (`GraphEmailProvider`, `PostgresApprovalRepository`, `FetchGraphInboundMessageFetcher`, `RegexPIIScrubber`), outbound Message-ID capture and reply correlation have been implemented, and the dependency audit is clean. The remaining blockers are environment-specific: a dedicated Entra test tenant, production infrastructure verification, and a Snyk scan.


---

## 1. Outbound Safety

Final path as implemented:

```
tenant context (Postgres RLS)
  → allowlist check (PostgresRecipientAllowlistRepository)
  → suppression check (PostgresSuppressionRepository)
  → approval re-verification (ApprovalVerificationAdapter → IApprovalRepository)
  → rate-limit check (RedisRateLimiter)
  → budget check (campaign aggregate)
  → content validation (draft body present)
  → atomic idempotency claim (PostgresIdempotencyStore, scope outreach:send)
  → live-email kill switch (OUTREACH_LIVE_EMAIL_ENABLED === 'true')
  → Microsoft Graph sendMail (GraphEmailProvider)
```

| Control | Status | Notes |
|---------|--------|-------|
| Tenant validation | OK | `current_setting('app.current_tenant')` RLS policies enforced on every tenant-scoped table. |
| Allowlist | OK | `SendSafetyGate` denies with `NOT_ALLOWLISTED` before any send; Postgres-backed in 7c. |
| Suppression | OK | Checked before approval verification; opt-out blocks all sends. |
| Approval re-verification | OK | `ApprovalVerificationAdapter` checks tenant, executionId, sequenceId, actionType, status, expiry. |
| Rate limit | OK | Per-channel per-second/minute/hour/day windows via Redis. |
| Budget | OK | `campaign.budget.maxSendCount` / `maxCostUsd` enforced. |
| Content validation | OK | Draft body required before `ALLOW`. |
| Atomic idempotency | OK | `PostgresIdempotencyStore.claim()` is test-and-reserve; `FAILED` keys are reclaimable for retry, `COMPLETED` keys are not. |
| Live-email kill switch | OK | `GraphEmailProvider.send()` checks `OUTREACH_LIVE_EMAIL_ENABLED === 'true'` immediately before HTTP call; non-`'true'` values disable. |
| Microsoft Graph adapter | OK | `GraphEmailProvider` is wired into the worker when `DATABASE_URL` is present; unit-tested; returns `ACCEPTED` for 2xx responses. |

**Bypass-path review:** No other code path calls `provider.send()` except `OutreachExecutionService.executeApprovedSend`, and that path always calls `SendSafetyGate.evaluate`. There is no direct public send API, no worker signal that skips the gate, and no provider-level override that bypasses policy.

**14.8a update:** `apps/temporal-worker/src/main.ts` now registers `GraphEmailProvider` with `MsalTokenProvider` + `FetchGraphHttpClient` when `DATABASE_URL` is present; the stub remains only for in-memory/dev mode.


---

## 2. Idempotency

- `PostgresIdempotencyStore.claim()` is atomic (`INSERT … ON CONFLICT … WHERE … RETURNING`).
- `OutreachExecutionService` now updates the idempotency record to `COMPLETED` on success or `FAILED` on retryable/non-retryable failure, so retries can reclaim `FAILED` keys but cannot duplicate a `COMPLETED` send.
- The `accept-then-timeout` failure-injection test passes: the provider returns `RETRYABLE`, the execution moves to `QUEUED`, the idempotency key is released, and the retry succeeds with the same provider message ID.

**Conclusion:** Idempotency is safe for the accepted-then-timeout scenario.

---

## 3. Approval

`ApprovalVerificationAdapter` re-reads the authoritative `Approval` aggregate from the repository on every send attempt. It validates:

- approval exists
- tenant matches
- `executionId` / `sequenceId` match the request
- `actionType` matches
- status is `APPROVED`
- approval has not expired (`createdAt + timeoutSeconds > now`)

Workflow replay, retries, direct service calls, signals, and API calls all pass through this single verification. A workflow-level approval flag alone is never trusted.

**14.8a update:** `apps/temporal-worker/src/main.ts` now uses `PostgresApprovalRepository` when `DATABASE_URL` is present, so approval state is durable across worker restarts.

---

## 4. Graph Authentication

Current implementation:

- `MsalTokenProvider` uses `@azure/msal-node` `ConfidentialClientApplication` with client-credentials flow.
- Secrets are sourced through `ISecretsProvider`: `EnvironmentSecretsProvider` (dev) or `AzureKeyVaultSecretsProvider` (production).
- Required secrets: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER_ADDRESS` (with optional `GRAPH_CLIENT_SECRET_REFERENCE` for Key Vault).
- `GraphEmailProvider` acquires a token before every send but does not log it.
- `ConsoleTelemetry` redacts keys matching `secret`, `token`, `password`, `credential`, `key`, `auth`, `apiKey`.
- No token, secret, or credential is persisted in domain/application state, workflow state, or audit metadata.
- ADR-131 records the decision to use a single dedicated Entra test tenant for the first real send.

**14.8a update:**
- `GraphEmailProvider` and `FetchGraphInboundMessageFetcher` construct an `MsalTokenProvider` from the same `GRAPH_*` environment variables when durable adapters are active.
- The `infra/integration/.env.example` now documents `GRAPH_CLIENT_SECRET_REFERENCE` and `GRAPH_SENDER_ADDRESS`.

**Remaining operational blockers:**
- Entra application registration, consent, and `Mail.Send` permission have not been created/verified.
- Production Key Vault and secret rotation procedure are not defined in this repository.
- Per-tenant credential resolution from `outreach.tenant_email_config` is out of scope for the first send; a follow-up milestone can retarget the existing abstractions without code changes.

---

## 5. Allowlist

- `PostgresRecipientAllowlistRepository` queries `outreach.allowed_recipients` scoped by `tenant_id`.
- `SendSafetyGate` checks allowlist before approval/idempotency/provider; retry/replay cannot bypass because the check runs on every `executeApprovedSend`.
- Allowlist entries require `approved_by` and `approved_at`.

**Operational readiness:** A manual pre-send checklist must include exactly one allowed recipient and verification that no other addresses are in the table.

---

## 6. Inbound

Implemented pipeline:

```
Graph webhook POST /webhooks/graph/email
  → validationToken echo (handshake)
  → GraphEmailWebhookController
  → GraphInboundOrchestratorService.processNotification
    → GraphInboundIngressService.ingest
      → validate shape + size
      → tenant resolution via mailbox
      → validate clientState secret
      → atomic dedup claim (outreach:inbound-email)
      → fetch raw message from Graph
      → normalize to ReplyIngressEvent + sanitize HTML
      → correlate to outbound execution (References → In-Reply-To → providerMessageId → sender/recipient fallback)
    → ConversationHandlingService.handleReply
      → PII scrub content/subject
      → record reply
    → classify intent + decide next best action
    → if opted-out, persist suppression
    → Temporal signal dispatch (replyReceived) to the sequence workflow
```

| Step | Status | Notes |
|------|--------|-------|
| Webhook validation | OK | Shape, size, `clientState` secret check. |
| Tenant resolution | OK | Mailbox extracted from `Users/{mailbox}/Messages/{id}`; no default/fallback tenant. |
| Sanitization | OK | `GraphMessageNormalizer` uses `sanitizeInboundHtml` with strict allowlist; `RegexPIIScrubber` exists for production use. |
| PII processing | OK | `RegexPIIScrubber` is wired in both `apps/api` and `apps/temporal-worker` when durable adapters are active. |
| Deduplication | OK | Atomic `IIdempotencyStore.claim()` per subscription+messageId. |
| Normalization | OK | Canonical event with headers for correlation. |
| Conversation correlation | OK | Creates conversation if absent; links to campaign/sequence/execution. |
| Intent | OK | `DeterministicIntentClassifier` recognizes opt-out, meeting request, positive, negative, question, uncertain. |
| Temporal signal | OK | `TemporalSignalDispatcher` dispatches `replyReceived` to deterministic workflowId. |

**14.8a update:**
- `apps/api/src/graph-inbound/graph-inbound.module.ts` now wires `FetchGraphInboundMessageFetcher` with an `MsalTokenProvider` and `RegexPIIScrubber` when `DATABASE_URL` is present.
- `GraphEmailProvider` now calls `saveToSentItems: true` and performs a post-send Sent Items lookup to capture the real `internetMessageId`; if lookup fails it falls back to the deterministic idempotency-derived ID. Unit and correlator tests cover both the real ID path and the fallback.
- Full end-to-end reply correlation against a live mailbox remains operationally unproven until the Entra test tenant is available.

---

## 7. Temporal

| Requirement | Status | Notes |
|-------------|--------|-------|
| Stable workflowId | OK | `WorkflowIdFactory.forOutreachSequence(tenantId, sequenceId)` produces deterministic ID. |
| Correct workflow running | OK | Worker listens on `outreach-execution` with `OutreachSequenceWorkflow`. |
| replyReceived signal target | OK | `GraphInboundOrchestratorService` dispatches to the deterministic workflowId. |
| Approval resume | OK | Workflow waits on `outreachApprovalGranted` signal before send. |
| Workflow recovery | OK | Temporal history replay; retry policy on activities; idempotency at send boundary. |
| Workflow start dedup | OK | `TemporalWorkflowClient` uses `workflowIdReusePolicy: 'REJECT_DUPLICATE'`. |

---

## 8. Persistence

- PostgreSQL is the operational source of truth for campaigns, sequences, message executions, approvals, leads, conversations, audit log, idempotency, and Graph subscriptions.
- Redis backs rate limiting and caching.
- Migrations `001_phase14_initial.sql`, `002_phase14_milestone7_workflow_identity.sql`, and `003_phase14_milestone7b_controlled_communication.sql` are applied by the E2E suite.
- RLS is enabled and forced on all tenant-scoped tables; policies use `current_setting('app.current_tenant', TRUE)`.
- Audit log is append-only in `audit.audit_log`.

**Blocking conditions:**
- Production Postgres/Redis/Temporal clusters and connection strings are not configured.
- Backup, point-in-time recovery, and encrypted-at-rest status have not been verified.
- Migration rollback procedure is not documented.

---

## 9. Telemetry

- `ConsoleTelemetry` emits structured stdout with secret-key redaction; default in integration.
- `OpenTelemetryAdapter` is available but relies on the host registering a MeterProvider/TracerProvider.
- Telemetry is passed into orchestration boundaries but not yet emitted from every `SendSafetyGate` branch.

The first real lifecycle will produce audit evidence for: mission, sequence, execution, workflow, approval, send safety decision, provider result, Graph subscription, webhook ingress, conversation, reply, intent classification, and Temporal signal dispatch — provided Postgres audit is enabled in the target environment.

**Recommendation before go-live:** enable `TELEMETRY_MODE=opentelemetry` and confirm collector ingestion.

---

## 10. Security Findings (`pnpm audit`)

`pnpm audit` now reports **0** vulnerabilities (updated 2026-08-18 after applying overrides). Runtime-affecting advisories for `@nestjs/core`, `body-parser`, `multer`, `qs`, and `sanitize-html` were patched via `pnpm-workspace.yaml` overrides and verified by re-running the full unit/integration suites.

**Snyk:** No Snyk scan was executed in this environment because a Snyk API token is not configured. A Snyk code + dependency scan of the first-party Phase 14 changes must be completed and signed off before the live send.

---

## 11. Operational Rollback

| Action | Mechanism | Status |
|--------|-----------|--------|
| Disable live email | Set `OUTREACH_LIVE_EMAIL_ENABLED=false` (any value other than exact `'true'`) | OK; `GraphEmailProvider` returns `LIVE_EMAIL_DISABLED`. |
| Stop Graph sends at provider | Unregister / do not construct `GraphEmailProvider` | OK; revert `DATABASE_URL` or set `OUTREACH_LIVE_EMAIL_ENABLED=false`. |
| Empty/disable allowlist | Remove rows from `outreach.allowed_recipients` | OK; all sends denied. |
| Remove Graph subscription | `DELETE /admin/graph/subscriptions/:id` with admin key | OK; `GraphSubscriptionAdminService.delete` calls Graph and deletes local record. |
| Pause/cancel workflow | Temporal UI/CLI or `TemporalWorkflowClient.cancel` | OK; `WorkflowIdFactory` gives deterministic handle. |
| Audit retention | Postgres `audit.audit_log` append-only | OK; verify backup/retention in target env. |

---

## 12. First Real Test Procedure (Runbook)

Do **not** execute this runbook until the blocking conditions are resolved and ARB explicitly authorizes the send.

### PRE-FLIGHT

1. Target environment deployed with production Postgres, Redis, Temporal.
2. Migrations applied; `projectx_app` role is the only DB user for services.
3. Entra app registered; `Mail.Send` permission granted and consented.
4. Secrets populated: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` (or Key Vault references), `GRAPH_SENDER_ADDRESS`.
5. Environment variables:
   - `OUTREACH_LIVE_EMAIL_ENABLED=true`
   - `OUTREACH_MODE=ALLOWLIST_ONLY`
   - `GRAPH_WEBHOOK_CALLBACK_URL=https://<host>/webhooks/graph/email`
   - `ADMIN_API_KEY` or `ADMIN_API_KEY_SECRET_REFERENCE`
6. Graph webhook subscription created via `POST /admin/graph/subscriptions` for `Users/{sender}/Messages`.
7. Exactly one recipient added to `outreach.allowed_recipients` with `approved_by` and reason.
8. Recipient is NOT in `outreach.suppression`.
9. Campaign budget and rate limits configured.
10. A human approver is standing by to approve the first send.

### ENABLE

1. Start `apps/temporal-worker` with durable adapters.
2. Confirm worker logs: live-email mode `ALLOWLIST_ONLY`, Postgres + Redis connected.
3. Start `apps/api` with admin + Graph inbound modules.
4. Verify health endpoints.

### SEND

1. Create campaign/sequence via admin/API path for the allowed recipient.
2. Workflow prepares draft and waits on `outreachApprovalGranted`.
3. Human approves (creates `mission.approvals` record with status `APPROVED`).
4. Workflow calls `executeApprovedSend`.
5. Expected: `SendSafetyGate` passes all checks; `GraphEmailProvider` acquires token and calls `POST /users/{sender}/sendMail`; returns `ACCEPTED`.
6. Record expected `providerMessageId` and audit log entries.

### RECEIVE

1. Send a reply from the allowed recipient to the sender mailbox.
2. Graph fires change notification to `POST /webhooks/graph/email`.
3. Webhook validates `clientState`, resolves tenant, dedups, fetches message, sanitizes HTML, scrubs PII.
4. `GraphReplyCorrelator` matches reply to outbound execution.
5. `TemporalSignalDispatcher` sends `replyReceived` to `WorkflowIdFactory.forOutreachSequence(tenantId, sequenceId)`.
6. Workflow records response and continues/terminates sequence.

### VERIFY

1. Audit log contains: safety decision `ALLOW`, Graph send outcome, webhook ingress, signal dispatch, conversation create/update, workflow completion.
2. `message_executions` row shows status `ACCEPTED`/`DELIVERED`/`REPLIED` with providerMessageId.
3. `conversations` row contains the reply and latest intent.
4. No second email was sent (idempotency key in `idempotency.keys` is `COMPLETED`).
5. Rate-limit counters in Redis incremented.
6. Campaign spend/sent count updated.

A detailed, executable version of this runbook with checkboxes and ARB sign-off package is in `docs/runbooks/phase14-8-first-real-send-runbook.md`.

### DISABLE

1. Set `OUTREACH_LIVE_EMAIL_ENABLED=false` and restart workers.
2. Delete Graph subscription via admin API.
3. Optionally remove allowlist entry.
4. Export/retain audit logs.
5. Verify a new send request is denied with `LIVE_EMAIL_DISABLED`.

---

## 13. GO / NO-GO

**Recommendation: NO-GO for the live send**

### Code-level blockers resolved in Phase 14.8a

1. **Worker email provider real:** `apps/temporal-worker/src/main.ts` now wires `GraphEmailProvider` with `MsalTokenProvider` + `FetchGraphHttpClient` when `DATABASE_URL` is present.
2. **Worker approval repository durable:** `ApprovalVerificationAdapter` now uses `PostgresApprovalRepository` when `DATABASE_URL` is present.
3. **Inbound message fetcher real:** `apps/api/src/graph-inbound/graph-inbound.module.ts` wires `FetchGraphInboundMessageFetcher` with an `MsalTokenProvider` when `DATABASE_URL` is present.
4. **PII scrubber enabled:** `RegexPIIScrubber` is wired in both inbound and worker composition roots when durable adapters are active.
5. **Message-ID capture implemented:** `GraphEmailProvider` saves to Sent Items and looks up the real `internetMessageId`; deterministic fallback on lookup failure; tests added.
6. **Dependency audit clean:** `pnpm audit` reports 0 findings; full test suites pass.

### Remaining blockers before the live send

7. **Entra / Graph environment not configured:** app registration, `Mail.Send` permission, admin consent, sender mailbox, and Key Vault secret placement are not present or verified.
8. **Production infrastructure not verified:** target Postgres, Redis, Temporal clusters, backups, encryption-at-rest, and migration rollback are not confirmed.
9. **Admin API key lifecycle:** key is read once at bootstrap; rotation and hot-reload are not implemented.
10. **Snyk scan not performed** due to missing token/tooling; required before production authorization.
11. **Real end-to-end smoke test not performed:** a live `GraphEmailProvider` boundary test and an actual reply correlation against the test tenant mailbox have not been executed.

### What Would Change the Recommendation to GO

Satisfy the PRE-FLIGHT checklist (Entra tenant, production environment, Snyk scan, smoke test) and obtain explicit ARB sign-off.

---

## 15. Phase 14.8a Implementation Evidence

| Deliverable | Status | Evidence |
|-------------|--------|----------|
| Composition root wiring | Done | `apps/temporal-worker/src/main.ts` wires `GraphEmailProvider`, `PostgresApprovalRepository`, `MsalTokenProvider`, `FetchGraphHttpClient`, `RegexPIIScrubber`; `apps/api/src/graph-inbound/graph-inbound.module.ts` wires `FetchGraphInboundMessageFetcher` and `RegexPIIScrubber`. |
| Message-ID capture | Done | `GraphEmailProvider` uses `saveToSentItems: true` + `getSentMessage` Sent Items lookup; unit/correlator tests pass. |
| Snyk integration | Setup | `snyk` devDependency + `scripts/security/snyk-scan.js` + `security:snyk-code` / `security:snyk-deps` scripts; scan blocked only by missing `SNYK_TOKEN`. |
| Local smoke tests | Done | `packages/outreach/src/__tests__/phase14-8-live-boundary-smoke.spec.ts` covers empty-allowlist denial, allowlisted `ACCEPTED`, and live-mode kill-switch. |
| Dependency audit | Clean | `pnpm audit` reports 0 findings. |
| Test suite | Green | `pnpm -r test`: all packages pass. |
| Runbook | Done | `docs/runbooks/phase14-8-first-real-send-runbook.md` with PRE-FLIGHT/SEND/RECEIVE/VERIFY/DISABLE/ARB package. |
| Operator checklist | Done | `docs/runbooks/phase14-8-first-real-send-checklist.md` with PRE-FLIGHT/CONFIGURE/VERIFY/APPROVE/SEND/RECEIVE/VERIFY END-TO-END/DISABLE/POST-TEST REVIEW. |
| Entra setup guide | Done | `docs/implementation/phase14-8-entra-test-tenant-setup.md` + `scripts/validation/graph-token-test.js`. |

---

## 14. Next Steps

1. Provision the dedicated Entra test tenant and application registration per ADR-131; grant and consent `Mail.Send`.
2. Place `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, and `GRAPH_SENDER_ADDRESS` in the target Key Vault / environment.
3. Verify production Postgres, Redis, Temporal clusters: backups, encryption-at-rest, RLS, migrations, and rollback procedure.
4. Run a Snyk code + dependency scan on the first-party Phase 14 changes; remediate or document exceptions.
5. Execute the PRE-FLIGHT / SEND / RECEIVE / VERIFY / DISABLE runbook against the test tenant with exactly one allowlisted recipient.
6. Confirm the outbound email reaches Graph `sendMail` and returns `ACCEPTED`, and that a reply is correlated to the outbound execution via the captured `internetMessageId`.
7. Return to ARB with this updated review and the Snyk/environment evidence for authorization to broaden the allowlist.
