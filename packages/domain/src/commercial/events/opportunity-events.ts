import type { EventId, CorrelationId, TenantId, OpportunityId, AccountId } from '@projectx/shared';
import { DomainEvent } from '../../events/domain-event';

export class OpportunityDiscovered extends DomainEvent<{
  readonly opportunityId: OpportunityId;
  readonly accountId: AccountId;
  readonly stage: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly opportunityId: OpportunityId;
      readonly accountId: AccountId;
      readonly stage: string;
    },
  ) {
    super(
      eventId,
      'OpportunityDiscovered',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class OpportunityProgressed extends DomainEvent<{
  readonly opportunityId: OpportunityId;
  readonly accountId: AccountId;
  readonly from: string;
  readonly to: string;
  readonly justification?: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly opportunityId: OpportunityId;
      readonly accountId: AccountId;
      readonly from: string;
      readonly to: string;
      readonly justification?: string;
    },
  ) {
    super(
      eventId,
      'OpportunityProgressed',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class OpportunityWon extends DomainEvent<{
  readonly opportunityId: OpportunityId;
  readonly accountId: AccountId;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly opportunityId: OpportunityId;
      readonly accountId: AccountId;
    },
  ) {
    super(
      eventId,
      'OpportunityWon',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class OpportunityLost extends DomainEvent<{
  readonly opportunityId: OpportunityId;
  readonly accountId: AccountId;
  readonly reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly opportunityId: OpportunityId;
      readonly accountId: AccountId;
      readonly reason: string;
    },
  ) {
    super(
      eventId,
      'OpportunityLost',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class OpportunityDisqualified extends DomainEvent<{
  readonly opportunityId: OpportunityId;
  readonly accountId: AccountId;
  readonly reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly opportunityId: OpportunityId;
      readonly accountId: AccountId;
      readonly reason: string;
    },
  ) {
    super(
      eventId,
      'OpportunityDisqualified',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}