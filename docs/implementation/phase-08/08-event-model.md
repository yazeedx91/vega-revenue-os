# Phase 08: Event Model

## Domain events

Domain events are produced by aggregates in response to state changes. They are immutable and carry standard metadata.

```ts
abstract class DomainEvent<TPayload> {
  readonly eventId: EventId;
  readonly eventType: string;
  readonly eventVersion: string;
  readonly occurredAt: Date;
  readonly tenantId: TenantId;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly producer: string;
  readonly payload: TPayload;
}
```

## Mission events

- `MissionCreated`
- `MissionApproved`
- `MissionStarted`
- `MissionPaused`
- `MissionResumed`
- `MissionCancelled`
- `MissionCompleted`
- `MissionFailed`
- `MissionArchived`
- `MissionTaskAdded`
- `MissionTaskStatusChanged`

## Agent events

- `AgentCreated`
- `CapabilityRegistered`
- `AgentVersionPublished`
- `AgentActivated`
- `AgentDeactivated`

## Publishing

- `IEventPublisher` publishes aggregate domain events.
- `EventEnvelopePublisher` maps domain events to `EventEnvelope` and delegates to infrastructure `IEventBus`.
- Aggregates track uncommitted events via `domainEvents`; the application layer dispatches them after a successful command.

## Idempotency

Tasks include an `idempotencyKey`; missions reject duplicate task keys within the same mission. The command executor additionally supports command-level idempotency for operations such as creation and approval.
