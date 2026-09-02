# Mission Orchestration & Durable Execution Layer

Phase 10 introduces a durable, long-running runtime for the Mission aggregate. The orchestrator is implemented as a dedicated `packages/mission-orchestrator` package and hosted by the existing `apps/temporal-worker` Temporal worker.

## Responsibilities

- Drive a mission through its full lifecycle: planning, execution, approval gates, completion, failure, cancellation, and recovery.
- Delegate all business-state transitions to the `Mission` and `MissionTask` aggregates in `packages/domain`.
- Introduce a first-class `Approval` aggregate for human-in-the-loop decisions.
- Provide deterministic, tenant-isolated execution with idempotency, checkpoints, compensation, retry, and audit.
- Keep Temporal behind an abstraction port (`IWorkflowClient`/`IWorkflowEngine`) so orchestrator logic can be unit-tested without a Temporal server.

## Out of scope for this phase

- Production persistence (Postgres/Prisma) — repository ports with in-memory doubles.
- Real notification/approval delivery channels — notification port only.
- Live Dynamics 365, email, LinkedIn, Zoom, or Google Meet integrations — stubbed activities/ports.
- Full AI-driven prospect intelligence — represented by deterministic test doubles.

## Package structure

`packages/mission-orchestrator/src/`

- `domain/approval/` — `Approval` aggregate, status machine, and events.
- `ports/` — repository, notification, compensation, and idempotency store interfaces.
- `application/` — `MissionOrchestratorService`, `ApprovalApplicationService`, command/event contracts.
- `workflow/` — `MissionExecutionEngine`, activity functions, workflow interfaces.
- `infrastructure/` — in-memory repository and port doubles.
- `index.ts` — public package surface.

## Key flows

### Start mission

1. `MissionOrchestratorService.startMission` transitions the aggregate from `APPROVED` to `PLANNING`, persists, publishes `MissionStarted`, and starts a Temporal workflow with a tenant-scoped workflow ID.
2. Idempotency is enforced with an idempotency-key cache keyed by the mission ID.

### Plan and execute

1. The Temporal workflow calls `planMissionActivity`, which uses `MissionExecutionEngine` and `MissionPlanner` to expand the mission plan into tasks.
2. The engine loops over runnable tasks, executes each via `AgentExecutor`, and handles results:
   - `COMPLETED` → task completed.
   - `AWAITING_APPROVAL` → create an `Approval`, notify, and pause the mission.
   - `FAILED`/`TIMED_OUT`/`CANCELLED` → fail task, block mission, record compensation.
3. When no runnable tasks remain, the engine evaluates completion criteria and transitions to `COMPLETED` or `FAILED`.

### Human approval

1. `ApprovalApplicationService.requestApproval` creates a `PENDING` approval aggregate and notifies via the notification port.
2. A human decision calls `approve`/`reject`, which transitions the approval, persists `ApprovalStatusChanged`, and signals the mission workflow.
3. The workflow resumes the mission and continues execution.

### Pause / resume / cancel

- `MissionOrchestratorService.pauseMission` transitions the aggregate to `PAUSED` and signals the workflow.
- `resumeMission` transitions back to `EXECUTING`.
- `cancelMission` transitions to `CANCELLED` and cancels the workflow.

## State machines

- Mission state machine: `packages/domain/src/mission/mission-status.ts`.
- Approval state machine: `packages/mission-orchestrator/src/domain/approval/approval-status.ts`.

## Temporal integration

- Workflow: `apps/temporal-worker/src/workflows/mission-workflow.ts`.
- Activity implementations: `packages/mission-orchestrator/src/workflow/activities/activities.ts`.
- Worker wiring: `apps/temporal-worker/src/activities.ts` and `apps/temporal-worker/src/main.ts`.

## Testing strategy

- Deterministic unit tests for `Approval`, `MissionOrchestratorService`, and `MissionExecutionEngine` using in-memory doubles and failure-injecting fakes.
- No Temporal server required for the core test suite; the workflow definition is compile-checked.

## Related documents

- `docs/architecture/07-workflow-architecture.md`
- `docs/ai/23-human-in-the-loop.md`
- `docs/ai/30-recovery.md`
- `docs/adr/decisions/ADR-018.md`
- `docs/adr/decisions/ADR-019.md`
