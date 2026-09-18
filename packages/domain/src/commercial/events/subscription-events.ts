import type { EventId, CorrelationId, TenantId, SubscriptionId, ContractId } from '@projectx/shared';
import { DomainEvent } from '../../events/domain-event';

export class SubscriptionStarted extends DomainEvent<{
  readonly subscriptionId: SubscriptionId;
  readonly contractId: ContractId;
  readonly status?: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly subscriptionId: SubscriptionId;
      readonly contractId: ContractId;
      readonly status?: string;
    },
  ) {
    super(
      eventId,
      'SubscriptionStarted',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class SubscriptionExpanded extends DomainEvent<{
  readonly subscriptionId: SubscriptionId;
  readonly contractId: ContractId;
  readonly reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly subscriptionId: SubscriptionId;
      readonly contractId: ContractId;
      readonly reason: string;
    },
  ) {
    super(
      eventId,
      'SubscriptionExpanded',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class SubscriptionChurned extends DomainEvent<{
  readonly subscriptionId: SubscriptionId;
  readonly contractId: ContractId;
  readonly reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly subscriptionId: SubscriptionId;
      readonly contractId: ContractId;
      readonly reason: string;
    },
  ) {
    super(
      eventId,
      'SubscriptionChurned',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}