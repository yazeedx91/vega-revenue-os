# Phase 08: Command Model

## Overview

Commands are the sole entry point for mutating domain state. Each command carries a tenant-scoped `CommandContext`, is executed by a handler, and is wrapped by `CommandExecutor` for cross-cutting concerns.

## Command context

```ts
interface CommandContext {
  readonly tenantId: TenantId;
  readonly actor: Actor;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly idempotencyKey?: IdempotencyKey;
}
```

## Handler contract

```ts
interface ICommandHandler<TCommand, TResult> {
  execute(ctx: CommandContext, command: TCommand): Promise<Result<CommandOutcome<TResult>, DomainError>>;
}
```

`CommandOutcome<TResult>` contains the returned aggregate/value, emitted domain events, resource type, and resource id for audit/event publishing.

## Implemented commands

| Command | Handler | Policy check | Notes |
|---------|---------|--------------|-------|
| `CreateMissionCommand` | `CreateMissionHandler` | no | Validates domain invariants and persists. |
| `ApproveMissionCommand` | `ApproveMissionHandler` | yes | Requires policy decision `ALLOW`. |
| `StartMissionCommand` | `StartMissionHandler` | yes | Moves mission from `APPROVED` to `PLANNING`. |
| `CreateAgentCommand` | `CreateAgentHandler` | no | Validates at least one capability and autonomy level. |
| `ActivateAgentCommand` | `ActivateAgentHandler` | yes | Moves agent to `ACTIVE`. |
| `PublishAgentVersionCommand` | `PublishAgentVersionHandler` | yes | Snapshots configuration immutably. |

## Command executor responsibilities

- Wraps execution in a telemetry span.
- Checks idempotency store when enabled and a key is supplied; returns cached result if present.
- Invokes handler.
- Publishes returned domain events via `IEventPublisher`.
- Stores idempotency result on success.
- Emits an audit record regardless of success/failure.

## Error handling

All domain and application errors are typed as `DomainError` and returned through `Result<T, DomainError>`. The executor does not throw for domain failures; it records them.
