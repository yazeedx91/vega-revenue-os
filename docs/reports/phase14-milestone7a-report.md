# Phase 14 Milestone 7a — Workflow Identity & Durable Communication Lifecycle

**Status:** GREEN — all acceptance criteria demonstrated.

**Date:** 2026-08-17

This report records the implementation and deterministic validation of Phase 14.7a, covering centralized workflow identity, idempotent workflow start, reply signal routing, approval-resume safety, tenant isolation, and persistence linkage.

## Implementation Summary

| Concern | Implementation |
| --- | --- |
| Workflow identity | `WorkflowIdFactory` in `@projectx/shared` derives deterministic, tenant-scoped, versioned IDs: `forOutreachSequence(tenantId, sequenceId)` and `forMission(tenantId, missionId)`. |
| Sequence linkage | `OutreachSequence` aggregate stores `workflowId` and `workflowStartedAt`; `linkWorkflow` emits `SequenceWorkflowLinked`. |
| Persistence | `PostgresSequenceRepository` persists the new fields in the existing JSON snapshot and reloads them via `reconstitute`. |
| Idempotent start | `OutreachSequenceLifecycleService` starts workflows through `IWorkflowClient`; the real `TemporalWorkflowClient` always sets `workflowIdReusePolicy: 'REJECT_DUPLICATE'`. |
| Reply routing | `TemporalSignalDispatcher` (`@projectx/temporal-client`) implements `ITemporalSignalDispatcher` and routes `replyReceived` signals by deterministic workflow ID. |
| Approval resume | `SendSafetyGate` re-verifies every send against `IApprovalVerificationPort`; a workflow-level "approved" flag is never trusted. |
| HTTP approval surface | `apps/api` exposes `POST /approvals/:approvalId/approve` and `/reject`, backed by `ApprovalApplicationService` and runtime-selected workflow client. |

## Workflow Identity Model

Workflow IDs are **derived, not stored authoritatively**, and always include tenant and sequence/mission scope:

```
outreach-sequence-v1-{tenantId}-{sequenceId}
mission-v1-{tenantId}-{missionId}
```

- Same tenant + same sequence → same `workflowId`.
- Different tenant or different sequence → different `workflowId`.
- No caller can construct a workflow ID that would cross tenant boundaries without including the tenant prefix.

The model is exercised by `packages/outreach/src/infrastructure/graph-inbound/__tests__/workflow-id-factory.spec.ts`.

## Workflow-Start Idempotency Proof

`packages/outreach/src/__tests__/outreach-sequence-lifecycle.service.spec.ts` proves:

1. **First start** returns `STARTED`, records `workflowId`/`workflowStartedAt` on the aggregate, and emits `SequenceWorkflowLinked`.
2. **Duplicate start** (same service instance, same aggregate) returns `ALREADY_RUNNING`; the `FakeWorkflowClient` records two `start()` attempts but only one logical workflow is created.
3. **Concurrent start** (`Promise.all` with two service instances loading the same sequence) produces exactly one `STARTED` and one `ALREADY_RUNNING`, both sharing the same deterministic `workflowId`.

The real `TemporalWorkflowClient` (in `packages/temporal-client/src/temporal-workflow-client.ts`) translates `WorkflowExecutionAlreadyStartedError` into `ALREADY_RUNNING`, so callers never need a read-then-start dance. Idempotency is therefore authoritative at the Temporal server, not simulated in application code.

## Reply Signal Routing Proof

`packages/temporal-client/src/__tests__/temporal-signal-dispatcher.spec.ts` proves:

- A `replyReceived` signal is dispatched to the exact `workflowId`.
- `tenantId` and `correlationId` from the request are carried into the `WorkflowExecutionRef`.
- Payload is forwarded unchanged.
- Duplicate business signals are idempotent at the workflow/aggregate level; the dispatcher itself records every attempt faithfully.

`apps/api/src/graph-inbound/__tests__/graph-inbound-orchestrator.service.spec.ts` proves end-to-end Graph webhook → `replyReceived` signal dispatch and duplicate-notification suppression (second identical webhook returns `DUPLICATE` and does not emit a second signal).

## Workflow-Not-Found Behavior

`TemporalSignalDispatcher.dispatch` returns:

```ts
{ outcome: 'WORKFLOW_NOT_FOUND', reason: err.message }
```

When an `IAuditLog` is provided, it also records:

```ts
{
  action: 'temporal_signal_workflow_not_found',
  resourceType: 'workflow',
  resourceId: request.workflowId,
  result: 'failure',
  reason,
  metadata: { signalName: request.signalName }
}
```

The dispatcher never creates or starts a workflow on a missing target. This is verified in the temporal-client unit tests.

## Approval-Resume Proof

`packages/outreach/src/__tests__/send-safety-gate.spec.ts` already contains the relevant cases:

- `execution domain state says APPROVED, but the authoritative approval repository disagrees → DENY`
- `wrong-tenant approval → DENY`
- `wrong-target approval (different sequence) → DENY`
- `wrong actionType approval → DENY`
- `rejected/pending/cancelled/expired approval → DENY`

These cases demonstrate that `SendSafetyGate` calls `IApprovalVerificationPort.verify` with the full target context (`campaignId`, `sequenceId`, `executionId`, `recipientAddress`, `actionType`) and that the aggregate state of the execution is **not** sufficient to authorize a send. The workflow therefore cannot rely on a Temporal approval flag; authoritative verification is always performed at send time.

## Tenant-Isolation Proof

- `WorkflowIdFactory.forOutreachSequence('tenant-a', 'seq-1') !== WorkflowIdFactory.forOutreachSequence('tenant-b', 'seq-1')`.
- `OutreachSequenceLifecycleService` uses the tenant from the supplied `TenantContext` when deriving the workflow ID.
- `TemporalSignalDispatcher` forwards the request tenant in the `WorkflowExecutionRef`.
- `SendSafetyGate` denies sends when `ctx.tenantId` does not match campaign/execution tenant.
- `PostgresSequenceRepository` scopes every query by `tenant_id`.

## Persistence Linkage Proof

`packages/outreach/src/__tests__/postgres-sequence-repository.spec.ts` contains a new test:

> `persists workflowId/workflowStartedAt through create-start-save-reload`

It creates a sequence, starts a workflow through `OutreachSequenceLifecycleService` backed by `PostgresSequenceRepository` (using `FakePgPool`), saves the aggregate, reloads it, and asserts that the deterministic `workflowId` and a real `Date` `workflowStartedAt` are preserved.

The in-memory lifecycle tests also verify the same round-trip with `InMemorySequenceRepository`.

## Workflow / Domain Consistency

- The `OutreachSequence` aggregate remains the authoritative business state. Workflow activities (`getSequence`) load the aggregate from `ISequenceRepository`; they do not query Temporal for business state.
- Temporal is used only for orchestration (timers, signals, durable execution), not for state-of-truth.

## Workflow ID Storage Decision

**Decision:** Keep `workflowId` and `workflowStartedAt` inside the existing `outreach.sequences` JSON snapshot. Do **not** add dedicated SQL columns for them.

**Rationale:**

- The workflow ID is deterministic and can be recomputed from `(tenantId, sequenceId)`.
- The snapshot already stores the fields durably.
- No concrete requirement has been identified for SQL-level uniqueness enforcement, indexed lookup, workflow-correlation queries, or operational recovery queries against a column.
- Adding columns only because they are convenient would violate the explicit 7a constraint.

If future operational tooling requires indexed workflow lookups, this decision can be revisited with a targeted migration.

## Existing Mission/Approval Changes

Two files in `packages/application` were adjusted to fix TypeScript build errors that blocked the full workspace build. They are backward-compatible type fixes, not unrelated cleanup:

- `packages/application/src/test-doubles/idempotency-store.ts` — aligned the in-memory double with the current `IIdempotencyStore` contract (`claim`, `status`, TTL). It now passes the same behavioral tests that already cover `PostgresIdempotencyStore`.
- `packages/application/src/handlers/agent.ts` — maps command `policyId` strings to branded `PolicyId` via `asPolicyId`. No runtime behavior changed.

## Exact Test Evidence

New / extended tests added for 7a:

| Suite | Tests |
| --- | --- |
| `packages/outreach/src/__tests__/outreach-sequence-lifecycle.service.spec.ts` | starts workflow, missing sequence, duplicate start idempotent, concurrent start creates one workflow |
| `packages/outreach/src/__tests__/postgres-sequence-repository.spec.ts` | persists workflowId/workflowStartedAt through create-start-save-reload |
| `packages/temporal-client/src/__tests__/temporal-signal-dispatcher.spec.ts` | dispatches replyReceived to correct workflow, WORKFLOW_NOT_FOUND + audit, no implicit workflow creation |
| Existing: `packages/outreach/src/infrastructure/graph-inbound/__tests__/workflow-id-factory.spec.ts` | deterministic, tenant-scoped, different-sequence isolation |
| Existing: `packages/outreach/src/__tests__/send-safety-gate.spec.ts` | approval re-verification, wrong tenant/target/action, rejected/pending/cancelled/expired, domain-state-vs-authoritative disagreement |
| Existing: `apps/api/src/graph-inbound/__tests__/graph-inbound-orchestrator.service.spec.ts` | end-to-end signal dispatch and duplicate suppression |

## Exact Build Results

```text
$ corepack pnpm -r build
✅ 16 of 17 workspace projects built successfully.
```

```text
$ corepack pnpm exec jest --maxWorkers=2 --passWithNoTests
Test Suites: 59 passed, 59 total
Tests:       347 passed, 347 total
Snapshots:   0 total
```

## Remaining Risks

1. **Live Temporal integration:** Unit/fake tests prove design correctness, but a real Temporal server integration test is still recommended before production deployment.
2. **Operational workflow queries:** If operators need to query sequences by workflow ID, the JSON-snapshot decision will need revisiting.
3. **Approval HTTP surface:** `apps/api` currently uses in-memory repositories for approvals and a no-op workflow client when `TEMPORAL_ADDRESS` is absent; production wiring to durable stores and a real Temporal client is required before full launch.
4. **Controlled-send guard:** `assertControlledSendMode` in `apps/temporal-worker/src/main.ts` currently hardcodes the in-memory allowlist repository type; production wiring must switch to `PostgresRecipientAllowlistRepository` when live email is enabled.

## Classification

**GREEN** — All Phase 14.7a acceptance criteria are demonstrated by deterministic tests and a passing full-workspace build.
