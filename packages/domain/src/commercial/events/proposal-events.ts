import type { EventId, CorrelationId, TenantId, ProposalId, OpportunityId } from '@projectx/shared';
import { DomainEvent } from '../../events/domain-event';

export class ProposalCreated extends DomainEvent<{
  readonly proposalId: ProposalId;
  readonly opportunityId: OpportunityId;
  readonly status: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly proposalId: ProposalId;
      readonly opportunityId: OpportunityId;
      readonly status: string;
    },
  ) {
    super(
      eventId,
      'ProposalCreated',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class ProposalSent extends DomainEvent<{
  readonly proposalId: ProposalId;
  readonly opportunityId: OpportunityId;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly proposalId: ProposalId;
      readonly opportunityId: OpportunityId;
    },
  ) {
    super(
      eventId,
      'ProposalSent',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class ProposalAccepted extends DomainEvent<{
  readonly proposalId: ProposalId;
  readonly opportunityId: OpportunityId;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly proposalId: ProposalId;
      readonly opportunityId: OpportunityId;
    },
  ) {
    super(
      eventId,
      'ProposalAccepted',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class ProposalRejected extends DomainEvent<{
  readonly proposalId: ProposalId;
  readonly opportunityId: OpportunityId;
  readonly reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly proposalId: ProposalId;
      readonly opportunityId: OpportunityId;
      readonly reason: string;
    },
  ) {
    super(
      eventId,
      'ProposalRejected',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}