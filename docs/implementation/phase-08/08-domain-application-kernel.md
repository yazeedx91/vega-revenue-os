# Phase 08: Domain & Application Kernel

## Scope

This phase delivers the production-grade executable kernel for ProjectX. It converts the approved domain architecture and Phase 07 foundations into typed, testable DDD primitives, aggregates, and an application pipeline without building full autonomous workflows or external integrations.

## What was implemented

### Foundational DDD primitives

- `AggregateRoot<TId>` – base aggregate with domain events, version tracking, and tenant identity.
- `Entity<TId>` – base entity with typed identity.
- `ValueObject` – structural equality base class.
- `DomainEvent<TPayload>` – immutable event envelope with event id, type, version, timestamp, tenant, correlation, causation, producer, and payload.
- `Actor` – value object modeling `human`, `agent`, `system`, and `external` actors with tenant-scoped identity.
- Domain error taxonomy (`DomainError`, `InvalidStateTransitionError`, `MissionInvariantError`, `AgentInvariantError`, `CapabilityError`, `IdempotencyError`, `TenantIsolationError`, `AuthorizationError`, `ValidationError`).
- `Result<T, DomainError>` functional error handling via `ok` / `fail` helpers.
- Branded domain IDs in `@projectx/shared`: `TenantId`, `MissionId`, `AgentId`, `TaskId`, `CapabilityId`, `PolicyId`, `ExecutionId`, `AuditRecordId`, etc.

### Aggregates & lifecycle

- **Mission aggregate** (`packages/domain/src/mission/mission.ts`)
  - State machine: `DRAFT → APPROVED → SCHEDULED/PLANNING → EXECUTING → PAUSED/AWAITING_APPROVAL/BLOCKED → COMPLETED/FAILED/CANCELLED → ARCHIVED`.
  - Validates objective, ICP, future deadline.
  - Owns `MissionTask` entities; enforces dependency completion before task start.
  - Idempotent task creation via task idempotency keys.
- **Agent aggregate** (`packages/domain/src/agent/agent.ts`)
  - Capability model as value objects.
  - Versioning: immutable published snapshots (`AgentVersion`).
  - Lifecycle: `DRAFT → TESTING → APPROVED → ACTIVE → DEPRECATED → RETIRED`.
  - Validates at least one capability and autonomy level 0-5.

### Tenant context

- `TenantContext` and `requireTenant` / `ensureSameTenant` helpers.
- All repositories and application handlers operate on tenant-scoped IDs and throw `TenantIsolationError` for cross-tenant access.

### Application command/query pipeline

- `CommandContext` – carries `tenantId`, `actor`, `correlationId`, `causationId`, optional `idempotencyKey`.
- `ICommandHandler<TCommand, TResult>` and `CommandExecutor`.
- Cross-cutting concerns in `CommandExecutor`:
  - Telemetry span wrapping.
  - Idempotency check/store.
  - Domain event publishing.
  - Audit record emission.
- `IQueryHandler<TQuery, TResult>` contract for read-only pipelines.

### Ports / test doubles

- `IPolicyService` with `ALLOW | REQUIRE_APPROVAL | DENY` decisions.
- `IIdempotencyStore` and `IAuditLog` ports.
- `IEventPublisher` plus `EventEnvelopePublisher` mapping domain events to `EventEnvelope` on `IEventBus`.
- `InMemoryMissionRepository`, `InMemoryAgentRepository`, `InMemoryAuditLog`, `InMemoryIdempotencyStore`, `CollectingEventPublisher`, `NoOpTelemetry`, `FixedPolicyService`.

## Files added/updated

- `packages/domain/src/{actor,aggregate,context,entity,errors,events,mission,agent,repository,value-object}`
- `packages/shared/src/result/result.ts`, `packages/shared/src/types/domain-ids.ts`
- `packages/application/src/{commands,handlers,ports,persistence,queries,events,test-doubles}`
- `packages/application/package.json`, `packages/application/tsconfig.json`
- `tsconfig.base.json`, `apps/api/tsconfig.json`, `apps/api/package.json`, `jest.config.js`

## Out of scope

- Full lead-generation, outreach, conversation, meeting-booking, Dynamics 365 workflows.
- Autonomous reasoning logic.
- Real external integrations (email, LinkedIn, Zoom, Google Meet, CRM).
- Concrete infrastructure adapters for persistence, event bus, telemetry, audit log.
