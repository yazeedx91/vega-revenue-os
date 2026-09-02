# Phase 08: Testing Strategy

## Test layers

Phase 08 focuses on unit-level domain and application tests. Integration and contract tests are deferred until infrastructure adapters are added.

## Domain tests

- `actor.spec.ts` – actor construction and tenant attribution.
- `value-object.spec.ts` – capability value equality.
- `mission-aggregate.spec.ts` – creation invariants, state machine transitions, task dependency rules, duplicate idempotency keys.
- `agent-aggregate.spec.ts` – creation invariants, capability registration, immutable version publishing, lifecycle activation.

## Application tests

- `command-executor.spec.ts` – telemetry span wrapping, event publishing, audit emission, idempotency caching.
- `mission-command-pipeline.spec.ts` – create/approve/start mission through handlers, policy denial, tenant isolation in repositories.

## Test doubles

All external concerns are mocked via application test doubles:

- `InMemoryMissionRepository`
- `InMemoryAgentRepository`
- `InMemoryIdempotencyStore`
- `InMemoryAuditLog`
- `CollectingEventPublisher`
- `NoOpTelemetry`
- `FixedPolicyService`

## Running tests

```bash
pnpm test
```

See `08-completion-report.md` for current validation status.
