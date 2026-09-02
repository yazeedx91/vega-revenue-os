# Phase 14 — Production Email Integration Architecture Review

**Status:** Draft — pending Architecture Review Board approval.
**Scope:** Transform ProjectX from a deterministic simulator into a real (allowlist-restricted) autonomous revenue communication system by integrating Microsoft Graph / Exchange Online for outbound email and inbound reply ingestion.

---

## 1. Current System Map

| Bounded Context | Package | Responsibility | State in Phases 09–13 |
|---|---|---|---|
| AI Execution Kernel | `packages/ai-runtime` | `AgentExecutor`, planner, reasoning, policy, tool execution, output validation, checkpointing. | `AgentExecutor` is real (`packages/ai-runtime/src/agent-executor/agent-executor.ts:45-238`); worker uses stubs for reasoning/validation. |
| Mission Orchestration | `packages/mission-orchestrator` | Mission lifecycle, task graph, approvals, retry/compensation, Temporal workflow host. | `MissionExecutionEngine` selects and executes tasks (`packages/mission-orchestrator/src/workflow/mission-execution-engine.ts:39-65`); `MissionWorkflow` is a skeleton that only runs one placeholder step (`apps/temporal-worker/src/workflows/mission-workflow.ts:41-116`). |
| Revenue Intelligence | `packages/intelligence` | ICP → account → contact → lead research, scoring, evidence, Dynamics stub. | Research pipeline is real and deterministic (`packages/intelligence/src/services/research-engine.ts:69-112`); provider and Dynamics adapters are stubs. |
| Outreach Execution | `packages/outreach` | Campaign, sequence, message execution, personalization, provider ports/registry, stubs. | Service logic is real (`packages/outreach/src/application/outreach-execution.service.ts:112-235`); email/LinkedIn/calendar providers are stubs. |
| Conversation Handling | `packages/conversation` | Reply ingestion, intent classification, next-best-action, lead re-qualification. | Deterministic rule-based pipeline (`packages/conversation/src/infrastructure/deterministic-intent-classifier.ts:1-32`). |
| Domain Model | `packages/domain` | Aggregates: Mission, Approval, Lead, Account, Contact, Campaign, Sequence, MessageExecution, Conversation. | Complete in-memory state machines. |
| Shared Contracts | `packages/shared` | `AIExecutionRequest/Result`, `MissionContract`, `ToolCallRequest`, `EventEnvelope`, branded IDs. | Stable. |
| Infrastructure Ports | `packages/infrastructure` | `IEventBus`, `IWorkflowClient`, `ITelemetry`, `ICache`, `IRateLimiter`, `ISecretsProvider`, `IIdentityProvider`. | Interfaces only; no production adapters. |
| Temporal Worker Host | `apps/temporal-worker` | Boots workers, wires in-memory doubles, sets module-level service state. | Real workflow registration; activities use mutable module state (`apps/temporal-worker/src/main.ts:31-95`). |
| Background Worker Host | `apps/background-worker` | Shell for non-AI background consumers. | Empty NestJS module. |
| API Host | `apps/api` | Shell for HTTP/gRPC controllers. | Empty NestJS module. |

### Control/Data Flow Today

1. A mission is created through `packages/application` command handlers (`packages/application/src/handlers/mission.ts:48-83`).
2. `MissionOrchestratorService.startMission` transitions the aggregate and starts a Temporal workflow (`packages/mission-orchestrator/src/application/mission-orchestrator.service.ts:28-65`).
3. The `MissionWorkflow` calls `MissionExecutionEngine` activities.
4. The engine runs tasks via `IAgentExecutor` adapters (`IntelligenceAgentExecutor`, `OutreachAgentExecutor`).
5. Outbound sends are gated by `ApprovalApplicationService` (`packages/mission-orchestrator/src/application/approval-application.service.ts:39-68`) and then delegated to `OutreachExecutionService`.
6. `OutreachSequenceWorkflow` loops through sequence steps, waits for approval/reply signals, and calls `interpretReply` (`apps/temporal-worker/src/workflows/outreach-sequence-workflow.ts:37-125`).
7. All repositories, event bus, telemetry, cache, and secrets are in-memory or no-op doubles.

---

## 2. End-to-End Capability Assessment

Trace the requested loop:

| Step | Component | Status | Notes |
|---|---|---|---|
| ICP definition | `ICPProfile` aggregate | **Real** | Hard/soft filters, scoring weights, thresholds. |
| Account discovery | `ResearchEngine` + `IResearchProvider` | **Deterministic / stubbed provider** | Logic is real; data comes from `StubResearchProvider`. |
| Intelligence enrichment | `ResearchEngine.getCompanyIntelligence` | **Deterministic / stubbed** | Evidence provenance model is real. |
| Lead qualification | `LeadScorer` + `Lead.evaluate` | **Real / deterministic** | Produces `QUALIFIED/NEEDS_REVIEW/NOT_QUALIFIED`. |
| Outreach planning | `OutreachPlanningService` | **Real but naive** | Picks channel, builds recipient from lead, creates simple sequence steps. |
| Message personalization | `OutreachPersonalizationService` | **Real port wiring but stub LLM** | Uses `IReasoningEngine`/`IOutputValidator` ports; worker uses stubs. |
| Approval gate | `ApprovalApplicationService` + `Approval` aggregate | **Real** | Can request/approve/reject/timeout. |
| Outbound send | `OutreachExecutionService` + `IOutreachProvider` | **Real logic / stub provider** | `StubEmailProvider` simulates success/failure (`packages/outreach/src/infrastructure/stub-email-provider.ts:1-63`). |
| Provider message lifecycle | `OutreachMessageExecution` aggregate | **Real** | PENDING → DRAFTING → PENDING_APPROVAL → APPROVED → QUEUED → SUBMITTED → ACCEPTED/DELIVERED/OPENED/REPLIED/BOUNCED/FAILED. |
| Prospect response ingestion | `IReplyIngress` + `StubReplyIngress` | **Port only** | No real email monitoring. |
| Conversation interpretation | `ConversationHandlingService` | **Real / deterministic** | Keyword classifier and rule-based next-best-action. |
| Lead re-qualification | `Lead.recordConversationOutcome` | **Real** | Updates lead status via conversation service. |
| Mission continuation | `MissionExecutionEngine` / `MissionWorkflow` | **Incomplete** | Workflow skeleton does not dynamically resume mission after outreach reply. |

**Bottom line:** The *domain logic* for the full loop exists and is unit-tested, but the system has never spoken to a real email provider or persisted state across restarts.

---

## 3. Autonomy Gap Analysis

| Gap | Business Impact | Technical Dependency | Implementation Complexity | Risk |
|---|---|---|---|---|
| No durable persistence | **Critical** — state lost on restart | All other features | Medium | Very High |
| No real email provider | **Critical** — cannot contact prospects | Persistence, secrets | High | High |
| No real reply ingestion | **Critical** — cannot close the loop | Email provider, webhooks | High | High |
| No secret management | Blocks any real external call | Email provider | Medium | High |
| No production event bus | Events lost, side effects unreliable | Persistence | Medium | High |
| `MissionWorkflow` skeleton | Cannot actually resume missions after approval/reply | Persistence + workflow rewrite | Medium | Medium |
| No observability implementation | Cannot operate safely | Telemetry adapter | Medium | Medium |
| No identity/authentication | Cannot expose API or multi-tenant UI | Entra/IdP | High | Medium |
| No CRM write-back | Manual reconciliation, incomplete revenue picture | Later phase | Medium | Low |
| No real LLM/validation | Drafts are stubs | Budget/cost controls | High | Medium |
| No PII scrubber | Compliance risk | Real content | Medium | High |
| No rate-limit/budget enforcement at runtime | Cost/spam/over-send risk | Cache/persistence | Medium | High |
| No suppression list | Legal/compliance risk | Persistence | Low | Very High |

**Highest-leverage next step:** close the top four gaps by implementing a real email integration with the supporting persistence, secrets, and approval infrastructure.

---

## 4. Phase 14 Options

### Option A — Production Email Integration (RECOMMENDED)
- **Objective:** Send and receive real email through Microsoft Graph/Exchange Online, restricted to an allowlist.
- **Architecture:** Persistence foundation (PostgreSQL + Redis + event table) + Graph email adapter + inbound webhook/polling + suppression + approval gates.
- **Packages affected:** `packages/infrastructure`, `packages/outreach`, `packages/conversation`, `packages/mission-orchestrator`, `apps/temporal-worker`, `apps/api`, `apps/background-worker`.
- **Benefits:** Makes the system genuinely usable; forces resolution of persistence, secrets, audit, and idempotency.
- **Risks:** Requires credential setup, webhook security, compliance, and allowlist discipline.
- **Dependencies:** None beyond ARB decisions.
- **Unlocks:** End-to-end autonomous outreach with real prospects (allowlisted).
- **Does NOT solve:** CRM write-back, calendar/meeting booking, LLM quality, public UI.

### Option B — Persistence & Infrastructure Hardening First
- **Objective:** Introduce PostgreSQL, event persistence, Redis, real secrets, and telemetry before any external integration.
- **Benefits:** Foundation for everything else; reduces operational risk.
- **Risks:** Does not materially change what the system *does*; harder to validate without a real channel.
- **Unlocks:** All later phases.
- **Does NOT solve:** Actually contacting prospects.

### Option C — Dynamics 365 CRM Integration
- **Objective:** Read/write Dynamics entities, write email activities back to CRM.
- **Benefits:** System of record alignment, richer lead data.
- **Risks:** ARB explicitly deferred write-back; no email channel means no activities to write.
- **Unlocks:** CRM hygiene.
- **Does NOT solve:** Core communication gap.

### Option D — Autonomous Decision/Control Loop
- **Objective:** Add ML-based intent classification, adaptive follow-up timing, and self-tuning thresholds.
- **Risks:** Premature; no real data stream yet; violates Phase 13 principle of deterministic feedback first.
- **Does NOT solve:** Persistence or real integration.

### Option E — Observability/Control Plane
- **Objective:** Build dashboards, alerting, and a mission control UI.
- **Risks:** Useful but secondary; no persistent data to observe yet.
- **Does NOT solve:** Core capability gap.

**Selected:** **Option A — Production Email Integration** because it is the smallest architecture that materially changes real-world capability while forcing the foundational gaps to be fixed.

---

## 5. Recommended Phase 14 Architecture

### Package Boundaries

| Package | New/Changed Responsibility |
|---|---|
| `packages/infrastructure` | Add production adapters: `PostgresPersistenceProvider`, `RedisCache`, `RedisRateLimiter`, `AzureKeyVaultSecretsProvider` (or env fallback), `ConsoleTelemetry` → OpenTelemetry exporter, `PostgresEventBus` or `RedisStreamsEventBus`. |
| `packages/outreach` | Add `GraphEmailProvider` implementing `IEmailProvider`; add `TenantEmailConfiguration` repository; add `SuppressionList` repository/port; add `EmailWebhookIngress` normalizer. |
| `packages/conversation` | Add `GraphReplyIngressAdapter`; add real `PIIScrubber` port/adapter; keep deterministic classifier. |
| `packages/mission-orchestrator` | Replace `NoOpWorkflowClient` with Temporal client; complete `MissionWorkflow` dynamic task loop; add reply-resumption task handling. |
| `apps/temporal-worker` | Wire production adapters via a tenant-scoped factory (replace module-level mutable state); register both workflows. |
| `apps/api` | Add NestJS controllers for mission create/approve/start, approval decisions, webhook ingress, allowlist management. |
| `apps/background-worker` | Add event consumers for audit ingestion, analytics projections, and suppression sync. |

### Domain Aggregates

No new aggregate roots are required, but existing ones gain persistence and operational enforcement:

- `OutreachMessageExecution` — already models the full send lifecycle.
- `OutreachCampaign` / `OutreachSequence` — already model budget and scheduling.
- `Conversation` — already models reply interpretation.
- `Lead` — already models re-qualification.
- **New value objects / read models (not aggregates):**
  - `TenantEmailConfiguration` — per-tenant sending domain, from-address, provider credentials reference.
  - `SuppressionEntry` — opt-out/unsubscribe record per tenant + email address.
  - `AllowedRecipient` — allowlist entry for Phase 14 rollout.

### Application Services

- `OutreachExecutionService` — unchanged contract; now backed by `GraphEmailProvider` and durable repositories.
- `ConversationHandlingService` — unchanged contract; now receives normalized Graph reply events.
- `TenantEmailConfigurationService` — new; manage per-tenant email config and allowlist.
- `SuppressionService` — new; enforce opt-outs and global suppression.
- `WebhookIngressService` — new; verify, normalize, deduplicate inbound Graph notifications.

### Ports / Adapters

- `IEmailProvider` → `GraphEmailProvider` (new production adapter) + `StubEmailProvider` (retained for tests).
- `IOutreachProviderRegistry` → per-tenant provider selection backed by `TenantEmailConfigurationRepository`.
- `IReplyIngress` → `GraphWebhookIngressAdapter` / `GraphPollingIngressAdapter`.
- `IPIIScrubber` → `RegexPIIScrubber` or tokenization adapter.
- `ISecretsProvider` → `AzureKeyVaultSecretsProvider` or environment-backed development adapter.
- `IPersistenceProvider` → `PostgresPersistenceProvider`.
- `ICache` / `IRateLimiter` → `RedisCache` / `RedisRateLimiter`.
- `IEventBus` → `PostgresEventBus` (append-only table) or `RedisStreamsEventBus`.
- `ITelemetry` → OpenTelemetry exporter with tenant/correlation tags.

### Temporal Workflows / Activities

- `MissionWorkflow` — rewrite the placeholder loop to:
  1. Call `planMissionActivity` once.
  2. Repeatedly call `selectNextTaskActivity` + `executeTaskActivity` + `handleTaskResultActivity`.
  3. Wait for `approvalDecision` signals when a task returns `AWAITING_APPROVAL`.
  4. Wait for `replyReceived` signals to resume outreach reply tasks.
  5. Handle pause/resume/cancel control signals.
  6. Terminate when the mission aggregate reaches a terminal state.
- `OutreachSequenceWorkflow` — keep current structure but:
  - Use durable repository-backed activities instead of module-level state.
  - Add explicit `tenantId` context propagation.
  - Add budget/rate-limit pre-check before each send.
  - Add suppression check before drafting.
- New activities:
  - `checkSuppressionActivity`
  - `recordSendAuditActivity`
  - `normalizeReplyActivity`

### Events

Reuse existing domain events; add integration events for email-specific observability:

- `EmailSendSubmitted`
- `EmailSendAccepted`
- `EmailSendDelivered`
- `EmailSendFailed`
- `EmailReplied`
- `EmailBounced`
- `OptOutRecorded`
- `SuppressionListUpdated`

### Commands

- `CreateTenantEmailConfigurationCommand`
- `UpdateTenantEmailConfigurationCommand`
- `AddAllowedRecipientCommand`
- `RemoveAllowedRecipientCommand`
- `RecordOptOutCommand`
- `ProcessInboundEmailNotificationCommand`

### Repositories

- `ITenantEmailConfigurationRepository`
- `ISuppressionListRepository`
- `IAllowedRecipientRepository`
- Durable implementations of existing `ICampaignRepository`, `ISequenceRepository`, `IMessageExecutionRepository`, `IConversationRepository`, `ILeadRepository` (conversation view), `IMissionRepository`, `IApprovalRepository`.

### State Machines

- `OutreachMessageExecution` — unchanged.
- `OutreachSequence` — add `WAITING` state already exists; ensure resume after reply signal.
- `Mission` — add explicit handling for resumption after reply/approval.

### Idempotency

- Command idempotency via existing `IIdempotencyStore` → Redis/Postgres.
- Provider send idempotency key remains:
  `outreach:{tenantId}:{campaignId}:{sequenceId}:{stepNumber}:{recipientHash}:{channel}:{providerId}`.
- Inbound reply deduplication by `providerMessageId` + `Message-Id` header stored in idempotency store.

### Tenant Isolation

- PostgreSQL: `tenant_id` column on every tenant-scoped table + RLS policies.
- Redis: key prefix `tenant:{id}:`.
- Secrets: per-tenant credential reference stored in secrets provider under `projectx/{tenantId}/email/graph`.
- Tenant context propagated through Temporal headers/interceptors and verified in every activity.

### Approval Boundaries

- **Mandatory human approval for the first outbound email to a new prospect/sequence.**
- Subsequent steps may be autonomous when:
  - Tenant policy `ALLOW`s autonomous email sends.
  - Sequence/campaign policy `ALLOW`s.
  - Recipient is not suppressed.
  - Autonomy level ≥ threshold.
  - Risk category not elevated.
  - Budget and rate limits satisfied.
  - Content passes validation.
- `ApprovalApplicationService` remains the single approval authority; no second email-specific approval system.

### Failure Handling

| Scenario | Classification | Behavior |
|---|---|---|
| Network timeout before acceptance | `RETRYABLE` | Exponential backoff, bounded by `maxRetries`. |
| Graph rate limit | `RATE_LIMITED` | Use `retryAfterMs`; sleep workflow; record audit. |
| Invalid recipient / bounce | `NON_RETRYABLE` | Mark execution `BOUNCED`; suppress address; notify. |
| Entra token expired | `RETRYABLE` | Background token refresh; retry with new token. |
| Webhook signature invalid | `SECURITY` | Reject event; alert; audit. |
| Duplicate inbound reply | `IDEMPOTENT` | Acknowledge and discard. |
| Budget exceeded | `NON_RETRYABLE` | Cancel campaign; alert. |

### Observability

- OpenTelemetry traces across API → Temporal → activity → provider.
- Metrics:
  - `email.sent`, `email.delivered`, `email.replied`, `email.bounced`, `email.opt_out`
  - `email.provider_latency`, `email.rate_limited`
  - `mission.active`, `mission.approval_wait_seconds`
  - `llm.tokens_used`, `llm.cost_usd` (when LLM is real)
- Structured logs with `tenantId`, `correlationId`, `missionId`, `executionId`.
- Audit log: append-only table for every send, approval, reply, opt-out, suppression change.

### Security Boundaries

- Secrets stored in Azure Key Vault / equivalent; never in code or env.
- Entra ID application registration with least privilege (`Mail.Send`, `Mail.ReadBasic`, `MailboxSettings.Read` scoped to application context or delegated admin as required).
- Webhook signature verification using Microsoft Graph certificate chain.
- Tenant-scoped credential lookup; reject cross-tenant activity calls.
- PII scrubbing before logging, analytics, or LLM prompts.
- Input sanitization on inbound email bodies to mitigate prompt injection.
- Content/output validation before any external send.
- Approval bypass prevention: `executeApprovedSend` checks for valid `approvalId` and `OutreachMessageExecution.status === 'APPROVED'`.
- Duplicate-send prevention via deterministic idempotency keys.

---

## 6. Real-World Operational Readiness

| System | Phase 14 Classification | Rationale |
|---|---|---|
| Microsoft Dynamics 365 | **Stub / read-only deferred** | ARB decision: no write-back in Phase 14. Read-only duplicate lookup can remain. |
| Microsoft Entra ID | **Production-ready (required)** | Needed for Graph OAuth2 / token refresh. |
| Email provider (Microsoft Graph / Exchange Online) | **Production-ready with allowlist** | Real sends to allowed recipients only; full security controls. |
| LinkedIn | **Stub only** | No official messaging API; deferred. |
| Calendar (Outlook/Google) | **Stub only** | Meeting booking deferred; `StubCalendarProvider` remains. |
| Temporal | **Production-ready** | Worker is real but needs persistent Temporal Server and dynamic `MissionWorkflow` completion. |
| Database (PostgreSQL) | **Production-ready** | Required for durable state. |
| Vector database | **Not introduced** | No RAG need yet; keep deferred. |
| Web/research providers | **Stub only** | Intelligence providers remain stubs; no live research calls. |
| Notification channels | **Stub / console** | `INotificationPort` can start as email/console; full notification service deferred. |

---

## 7. Data / Persistence Strategy

**Yes, Phase 14 must replace in-memory repositories.**

### Database: PostgreSQL

- Operational store for all aggregate snapshots.
- Row-level security on `tenant_id`.
- Schema ownership per bounded context:
  - `outreach` schema: campaigns, sequences, executions, tenant email config, suppression, allowlist.
  - `conversation` schema: conversations, reply messages.
  - `mission` schema: missions, tasks, approvals.
  - `intelligence` schema: accounts, contacts, leads, evidence, ICP profiles.
  - `audit` schema: audit log table.
  - `idempotency` schema: idempotency keys.

### Migrations

- Use a TypeScript migration tool (e.g., `node-pg-migrate` or `drizzle-kit`) committed under `infra/database/migrations`.
- Each bounded context owns its schema migrations.
- Migration execution is an infrastructure concern, not application startup.

### Repository Implementation

- Implement one durable repository per existing port using PostgreSQL.
- Keep in-memory doubles for deterministic tests.
- Repositories map aggregate events to tables; load by replaying recent snapshot + events or by full snapshot persistence.

### Event Persistence

- Append-only `domain_events` and `integration_events` tables.
- `event_id`, `tenant_id`, `correlation_id`, `causation_id`, `event_type`, `payload` (JSONB), `occurred_at`.
- Consumer idempotency keys stored in `idempotency` table.

### Audit Persistence

- `audit_log` table: `action`, `resource_type`, `resource_id`, `tenant_id`, `actor`, `result`, `reason`, `metadata`.
- Immutable; no updates/deletes.

### Tenant Isolation

- `tenant_id` column on every table.
- RLS policies enforcing `tenant_id = current_setting('app.current_tenant')`.
- Repository code sets tenant per connection/transaction.
- Redis key prefix `tenant:{id}`.
- Secrets namespaced by tenant.

### Encryption / Secrets

- Tenant email credentials (client secret, certificate) stored in Azure Key Vault or equivalent.
- At-rest encryption for email bodies and reply content via PostgreSQL TDE or application-level encryption for sensitive columns.
- TLS for all external connections.

---

## 8. Learning / Evaluation

Phase 14 **does not introduce online self-learning**. It builds the deterministic evaluation corpus required for future ML.

### Evaluation Architecture

- `EvaluationRecord` (read model / event-sourced):
  - `replyId`, `conversationId`, `intent`, `confidence`, `actionTaken`, `leadStatusChange`, `humanOverride`, `finalOutcome`.
- Events feed an analytics projection in `apps/background-worker`.
- Dashboard metrics:
  - Conversion funnel: qualified → sent → replied → meeting requested → qualified/disqualified.
  - Classifier precision/recall against human-labeled samples.
  - Personalization rejection rate.
  - Approval-to-send latency.
- A/B testing framework is **deferred**; record message variants for future analysis.

### Safe Learning Rules

- All decisions remain deterministic and rule-based.
- Human overrides are stored as training labels.
- Model version changes require explicit `Agent.publishVersion` and approval.
- No feedback loop directly modifies policy thresholds without human review.

---

## 9. Autonomy Model

| Level | Definition | Current Subsystem Status |
|---|---|---|
| **Level 0 — deterministic/test** | Every action is a stub or rule; no real external effects. | Intelligence scoring, deterministic classifier, stub providers, in-memory state. |
| **Level 1 — human approved** | External side effects require explicit human approval per instance. | `OutreachSequenceWorkflow` first-send approval; `MissionExecutionEngine` task approval. |
| **Level 2 — policy-controlled autonomous execution** | Autonomous within policy/risk/cost/budget constraints; human approval only on exceptions. | **Target for Phase 14:** subsequent sequence steps after first approval. |
| **Level 3 — adaptive optimization** | System adjusts timing, content, and thresholds based on validated outcome data. | **Deferred** — requires evaluation corpus. |
| **Level 4 — continuously improving autonomous system** | Self-monitoring, self-correcting, model retraining under governance. | **Deferred** — requires MLOps pipeline and governance. |

Phase 14 moves the email channel from **Level 0** to **Level 2** (with mandatory Level 1 for first sends).

---

## 10. Security Review

| Concern | Current State | Phase 14 Mitigation |
|---|---|---|
| Tenant isolation | In-memory keying | PostgreSQL RLS + Redis prefixes + secrets namespace + Temporal interceptors. |
| Secrets | No management | `ISecretsProvider` → Azure Key Vault; no hardcoded credentials. |
| Authentication | None | Entra ID app registration; token refresh service. |
| Authorization | Policy ports only | Enforce in activity layer + API guards. |
| PII | `NoOpPIIScrubber` | Real scrubber/tokenizer; redact before logs/analytics/LLM prompts. |
| Prompt injection | Not addressed | Sanitize inbound email; no user-controlled system prompts; output validation. |
| Tool abuse | `AgentExecutor` checks tools allowlist | Keep policy gate before tool calls; audit every tool call. |
| External side effects | Stubs only | Approval gate + allowlist + rate limits + audit. |
| Audit trails | No-op event bus | Append-only audit + domain event persistence. |
| Data leakage | Not enforced | Tenant-scoped repositories; no cross-tenant queries. |
| Replay attacks | Not addressed | Idempotency keys; webhook signature verification; nonce checks. |
| Duplicate sends | Key exists but in-memory only | Durable idempotency store + provider message ID tracking. |
| Approval bypass | Real aggregate check | `OutreachMessageExecution.approve` requires `PENDING_APPROVAL`; `executeApprovedSend` validates. |
| Malicious research content | Stub provider | Input validation and sandboxing remain for future research adapters. |

---

## 11. Testing Strategy

### Unit / Aggregate Tests (deterministic, no external infra)
- `OutreachMessageExecution` state transitions.
- `Conversation` opt-out and classification flows.
- `SuppressionService` and `TenantEmailConfigurationService` logic.
- `GraphEmailProvider` request/response mapping with mocked Graph client.

### Integration Tests (requires PostgreSQL + Redis)
- Durable repository round-trips with tenant isolation.
- Idempotency store deduplication across restarts.
- Event bus append/read.
- Rate limiter bucket behavior.

### Workflow Tests (requires Temporal test server)
- `MissionWorkflow` dynamic task loop with approval/reply signals.
- `OutreachSequenceWorkflow` end-to-end: draft → approval → send → reply → classify → requalify.
- Failure injection: provider timeout, rate limit, bounce, invalid webhook signature.

### Contract Tests
- `IEmailProvider` contract tested against `StubEmailProvider` and `GraphEmailProvider`.
- `IReplyIngress` contract tested against stub and Graph webhook normalizer.

### Security Tests
- Cross-tenant repository access denied.
- Webhook signature verification rejects tampered payloads.
- Approval bypass attempts fail.

### AI Evaluation Tests
- Deterministic classifier baseline preserved.
- Record evaluation corpus; assert fields populated.
- Human override capture.

### End-to-End Mission Tests
- ICP → research (stub) → qualified lead → outreach plan → first-send approval → real send (allowlist) → simulated/staged reply → conversation interpretation → lead requalification → mission continuation.

---

## 12. Architectural Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `MissionWorkflow` rewrite introduces regressions | High | Keep existing engine logic; only complete the workflow loop; extensive Temporal replay tests. |
| Replacing in-memory repositories with PostgreSQL changes load/save semantics | High | Snapshot + event persistence; keep in-memory doubles for unit tests. |
| Module-level mutable state in `apps/temporal-worker` causes multi-worker bugs | High | Replace with tenant-scoped factory injected into activity context. |
| Graph token refresh failure blocks all sends | Medium | Background refresh service; fallback to retryable error classification. |
| Webhook endpoint exposure without auth | High | Signature verification, IP allowlist, mTLS, API key. |
| Allowlist management bypass | High | Audit every allowlist change; require admin role. |
| PII leakage in logs/analytics | High | Scrubber/tokenizer; audit log excludes raw email bodies. |
| Conversation `Lead` repo duplicate concept | Medium | Keep conversation lead view read-only or event-driven; do not let conversation own Lead writes beyond what is already implemented. |

---

## 13. Required ADRs

| ADR | Title | Decision | Rationale |
|---|---|---|---|
| ADR-117 | Phase 14 Objective and Scope | Implement production email integration with Microsoft Graph/Exchange Online as the highest-leverage next step. | Closes the core communication gap and forces persistence/secrets/audit foundations. |
| ADR-118 | Microsoft Graph as Primary Email Provider | Use Graph/Exchange Online; defer SendGrid/AWS SES and LinkedIn. | Aligns with Microsoft ecosystem; official APIs; supports send, delivery status, and webhook subscriptions. |
| ADR-119 | Allowlist-Only Rollout Model | All real sends in Phase 14 target explicit allowlist entries; expansion requires ARB review. | Limits blast radius while validating real external behavior. |
| ADR-120 | Persistence Strategy for Phase 14 | PostgreSQL operational store + Redis cache/rate limiter + append-only event/audit tables. | Replaces in-memory doubles; supports tenant isolation and durability. |
| ADR-121 | Inbound Email Ingestion | Primary: Graph webhook notification; fallback: Graph delta/polling. | Webhooks are real-time; polling covers tenants without webhook support. |
| ADR-122 | Suppression and Opt-Out Model | Per-tenant suppression list + unsubscribe link + reply-based opt-out; no send to suppressed addresses. | Legal/compliance requirement; reusable across channels. |
| ADR-123 | Approval Boundary for First Send | First outbound email per sequence/recipient requires human approval; subsequent steps autonomous within policy. | Balances autonomy with safety per ARB decision. |
| ADR-124 | Dynamics 365 Read-Only in Phase 14 | No CRM write-back; future sync consumes ProjectX events. | Avoids coupling email execution to CRM; defers complex bidirectional sync. |

---

## 14. Implementation Plan

See `plans/phase14-implementation-plan.md` for the detailed milestone breakdown.

---

## 15. Completion Criteria

1. `GraphEmailProvider` passes contract tests and sends real email to allowlisted recipients via Microsoft Graph.
2. Inbound Graph webhook/polling adapter normalizes replies and records them durably.
3. PostgreSQL repositories replace in-memory doubles for outreach, conversation, mission, and approval aggregates.
4. Event bus and audit log persist to PostgreSQL.
5. `MissionWorkflow` dynamically executes task graph, waits for approvals, and resumes after replies.
6. First-send approval gate enforced; subsequent steps autonomous within policy.
7. Suppression list blocks sends and reply-based opt-outs add entries.
8. Rate limits and campaign budgets enforced at runtime.
9. Secrets provider manages Graph credentials per tenant; no credentials in code.
10. Webhook signature verification and tenant isolation tests pass.
11. All existing Phase 09–13 deterministic tests still pass.
12. 28+ test suites pass, including new durable-repository, workflow, and Graph adapter tests.
13. TypeScript composite build passes for all affected packages.
14. ADRs ADR-117 through ADR-124 are approved and merged.

---

## 16. ARB Questions

The following decisions were required before planning and have now been answered by the ARB:

1. **Email provider:** Microsoft Graph / Exchange Online only; future providers remain behind the existing port abstraction.
2. **CRM write-back:** Deferred; Dynamics 365 remains read-only in Phase 14.
3. **Approval boundary:** Mandatory human approval for every first outbound email; subsequent sequence steps autonomous when policy permits.
4. **Safety:** Real email is authorized but allowlist-restricted; no unrestricted mass sending.

**Remaining operational questions (not blockers for architecture approval):**

- Which Azure subscription / Key Vault instance will host tenant credentials?
- Will the initial Temporal Server be self-hosted, Temporal Cloud, or a local docker-compose for validation?
- What is the exact data-retention period for email bodies, reply content, and audit events per tenant/jurisdiction?
- Which team role owns the allowlist approval workflow (sales ops, security, tenant admin)?
