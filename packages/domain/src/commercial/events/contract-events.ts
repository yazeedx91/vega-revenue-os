import type { EventId, CorrelationId, TenantId, ContractId, OpportunityId } from '@projectx/shared';
import { DomainEvent } from '../../events/domain-event';

export class ContractSigned extends DomainEvent<{
  readonly contractId: ContractId;
  readonly opportunityId: OpportunityId;
  readonly status?: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly contractId: ContractId;
      readonly opportunityId: OpportunityId;
      readonly status?: string;
    },
  ) {
    super(
      eventId,
      'ContractSigned',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class ContractAmended extends DomainEvent<{
  readonly contractId: ContractId;
  readonly opportunityId: OpportunityId;
  readonly reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly contractId: ContractId;
      readonly opportunityId: OpportunityId;
      readonly reason: string;
    },
  ) {
    super(
      eventId,
      'ContractAmended',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class ContractTerminated extends DomainEvent<{
  readonly contractId: ContractId;
  readonly opportunityId: OpportunityId;
  readonly reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly contractId: ContractId;
      readonly opportunityId: OpportunityId;
      readonly reason: string;
    },
  ) {
    super(
      eventId,
      'ContractTerminated',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}