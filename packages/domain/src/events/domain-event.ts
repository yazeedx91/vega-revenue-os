import type { CausationId, CorrelationId, EventId, TenantId } from '@projectx/shared';

export abstract class DomainEvent<TPayload = unknown> {
  protected constructor(
    public readonly eventId: EventId,
    public readonly eventType: string,
    public readonly eventVersion: string,
    public readonly occurredAt: Date,
    public readonly tenantId: TenantId,
    public readonly correlationId: CorrelationId,
    public readonly producer: string,
    public readonly payload: TPayload,
    public readonly causationId?: CausationId,
  ) {}
}
