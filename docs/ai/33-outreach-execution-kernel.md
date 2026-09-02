# Phase 12 — Outreach Execution Kernel

This document describes the Phase 12 runtime: a controlled, evidence-backed outreach execution layer that consumes qualified leads from Phase 11 and executes outreach sequences through provider ports, with no live external communication in Phase 12.

## Purpose

Transform a qualified lead into a scheduled, approved, personalized outreach sequence while preserving:

- Evidence-backed claims
- Tenant isolation
- Approval gates
- Idempotency and duplicate-send protection
- Auditability and observability
- Deterministic failure/retry behavior

## Pipeline

```
Qualified Lead (Phase 11)
    ↓
Outreach Planning
    ↓
Message Personalization + Evidence Verification
    ↓
Policy / Approval Gate
    ↓
Sequence Scheduling (Temporal)
    ↓
Provider Port (stub)
    ↓
Execution State + Audit/Telemetry
    ↓
Response Signals / Sequence Advancement
```

## Domain Model

See `packages/domain/src/outreach`:

- `OutreachCampaign` — aggregate root; campaign-level policy, budget, channel strategy, lifecycle.
- `OutreachSequence` — aggregate root per recipient; step progression, scheduling state, pause/resume/cancel.
- `OutreachMessageExecution` — aggregate root per send; provider interaction, idempotency, retry classification, final delivery state.
- `Recipient`, `MessageDraft`, `SequenceStep`, `OutreachPlan` — value objects.

## Package Structure

| Package | Responsibility |
| --- | --- |
| `packages/domain` | Outreach aggregates, events, value objects |
| `packages/outreach` | Planning, personalization, execution, provider ports, stub adapters, agent registry/executor |
| `packages/ai-runtime` | Reasoning, output validation, policy client (reused) |
| `packages/intelligence` | Lead and evidence read-only inputs (reused) |
| `packages/mission-orchestrator` | Executes outreach tasks as mission steps (reused) |
| `packages/infrastructure` | Audit, telemetry, cache, rate limiter ports (reused) |
| `apps/temporal-worker` | Sequence workflow and activity wrappers |

## Planning

`OutreachPlanningService` produces an `OutreachPlan` from a `Lead`, `ICPProfile`, `ResearchEvidence[]`, and mission context. It considers:

- Lead qualification score and decision reason
- ICP fit and channel preference
- Evidence freshness and confidence
- Buying signals
- Mission constraints (`workingHours`, `noContactDomains`, etc.)
- Tenant policy (`allowedChannels`, `maxOutreachCount`, `autonomyLevel`)
- Required approvals per channel/risk

## Personalization

`OutreachPersonalizationService` uses the existing AI runtime:

1. Build a constrained prompt context from verified evidence.
2. Invoke the `outreach-writer` agent through `LLMReasoningEngine`/`IAgentExecutor`.
3. Extract all claims from the draft.
4. Verify each claim against `ResearchEvidence` provenance.
5. Run `IOutputValidator` for PII, brand, compliance, and policy checks.
6. Return a `MessageDraft` with a claim-to-evidence map.

Unsupported claims are removed; drafts with policy/PII violations are rejected.

## Approval

Phase 12 reuses the Phase 10 `Approval` aggregate and `ApprovalApplicationService`.

Action types:

- `outreach-campaign-approve`
- `outreach-sequence-approve`
- `outreach-message-send`

No provider call occurs unless:

- Policy explicitly `ALLOW`s the send, **or**
- An `APPROVED` approval record exists for the execution.

## Provider Ports

Defined in `packages/outreach/src/ports`:

- `IOutreachProvider` (base)
- `IEmailProvider`
- `ILinkedInProvider`
- `ICalendarProvider`
- `IOutreachProviderRegistry`

Stub adapters:

- `StubEmailProvider`
- `StubLinkedInProvider`
- `StubCalendarProvider`

Provider results include retry classification (`RETRYABLE`, `NON_RETRYABLE`, `RATE_LIMITED`), rate-limit reset timing, provider message ID, and cost.

## Sequencing and Scheduling

- `OutreachSequence` aggregate owns step progression and `nextDueAt`.
- `ISequenceSchedulePolicy` computes scheduled times with business-hour support.
- Temporal workflow `outreach-sequence-workflow.ts` manages timers and signals.
- Activities call `OutreachExecutionService` to mutate aggregates.
- Pause/resume and cancellation update aggregate state; timers are recalculated.

## Idempotency

Two layers:

1. **Command idempotency** via existing `IIdempotencyStore`.
2. **Provider send idempotency** via deterministic keys stored in `OutreachMessageExecution`.

A logical send key:

```
outreach:{tenantId}:{campaignId}:{sequenceId}:{stepIndex}:{recipientHash}:{channel}:{providerId}
```

If a provider times out after accepting a request, retries return the stored `SUBMITTED`/`ACCEPTED` state without resending.

## Failure and Retry

| Scenario | Classification | Behavior |
| --- | --- | --- |
| Network timeout before acceptance | `RETRYABLE` | Exponential backoff up to `maxRetries`. |
| Rate limit | `RATE_LIMITED` | Sleep until `retryAfter`; schedule resume. |
| Invalid recipient | `NON_RETRYABLE` | Step `FAILED`. |
| Malformed response | `NON_RETRYABLE` | Execution `FAILED`. |
| Timeout after acceptance | — | Stay `SUBMITTED`; reconcile later. |
| Approval rejection | `NON_RETRYABLE` | Execution `FAILED`. |
| Policy denial | `NON_RETRYABLE` | Execution `FAILED`. |
| Tenant mismatch | `NON_RETRYABLE` | `TenantIsolationError`; security audit. |

Compensation does **not** recall an already-sent message. It may update CRM status or notify operators through the existing `ICompensationPort`.

## Tenant Isolation

- All repositories use tenant-scoped keys.
- `OutreachExecutionService` enforces `ensureSameTenant`.
- Provider registry selects per-tenant configuration.
- Audit and telemetry tags include `tenantId`.
- Drafts never mix evidence across tenants.

## Policy and Safety

Reuses existing policy infrastructure:

- `IPolicyService` for command-level decisions.
- `IPolicyClient` for AI execution-level decisions.
- `IOutputValidator` for PII, brand, compliance.

Outreach action types and default decisions:

| Action Type | Risk | Default |
| --- | --- | --- |
| `outreach-plan` | LOW | ALLOW |
| `outreach-draft-message` | MEDIUM | ALLOW with validation |
| `outreach-send-email` | HIGH | REQUIRE_APPROVAL |
| `outreach-send-linkedin` | HIGH | REQUIRE_APPROVAL |
| `outreach-send-calendar` | HIGH | REQUIRE_APPROVAL |

Safety controls include `allowedChannels`, `maxOutreachCount`, `noContactDomains`, `prohibitedContent`, `piiHandling`, and `personalizationConstraints`.

## Audit and Observability

Every transition records an audit action:

- `outreach.plan`
- `outreach.draft`
- `outreach.approval.request`
- `outreach.send.submit`
- `outreach.send.accept`
- `outreach.send.fail`
- `outreach.sequence.pause`
- `outreach.sequence.cancel`

Telemetry counters and histograms track planning, drafting, validation, provider latency, and send outcomes.

## Mission Orchestrator Integration

New mission task types:

- `execute-outreach-pipeline`
- `plan-outreach`
- `draft-message`
- `request-send-approval`
- `send-message`
- `advance-sequence`
- `await-response`
- `cancel-outreach`

`OutreachAgentExecutor` implements `IAgentExecutor` and routes task types to the outreach engine. `OutreachAgentRegistry` exposes agent contracts. The orchestrator handles `AWAITING_APPROVAL`, pause/resume, and failures without owning outreach business rules.

## Temporal Boundaries

- Workflow: `apps/temporal-worker/src/workflows/outreach-sequence-workflow.ts`
- Activities: `apps/temporal-worker/src/activities/outreach-activities.ts`
- Workflow owns timers and signals; aggregates own business state.
- No provider calls inside workflow code.

## Testing

- Domain aggregate tests for campaigns, sequences, and executions.
- Service tests for planning, personalization, execution, and idempotency.
- Provider stub tests for success/failure/rate-limit behavior.
- Mission orchestrator integration test: Phase 11 qualified lead → Phase 12 outreach pipeline.
- Failure-injection tests for approval rejection, expiration, duplicate execution, tenant mismatch, policy denial, and provider timeout-after-acceptance.

No real external provider calls are made.

## ADRs

- `ADR-104` — Outreach package boundary
- `ADR-105` — Outreach aggregate decomposition
- `ADR-106` — Reuse Phase 10 approval boundary
- `ADR-107` — Outreach idempotency and exactly-once send protection
- `ADR-108` — Outreach provider port abstraction
- `ADR-109` — Scheduling and sequencing boundary with Temporal
- `ADR-110` — Evidence-backed personalization and output validation

## Out of Scope

- Live email/LinkedIn/SMS/calendar integrations
- Real inbox monitoring or reply detection
- Real CRM write-back beyond stub/compensation port
- Meeting booking UI or calendar negotiation
- A/B testing of message variants
- Multi-language generation
- Deliverability/reputation modeling
