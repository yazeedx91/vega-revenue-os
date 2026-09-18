import type { EventId, CorrelationId, TenantId, PilotId, OpportunityId } from '@projectx/shared';
import { DomainEvent } from '../../events/domain-event';

export class PilotStarted extends DomainEvent<{
  readonly pilotId: PilotId;
  readonly opportunityId: OpportunityId;
  readonly status?: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly pilotId: PilotId;
      readonly opportunityId: OpportunityId;
      readonly status?: string;
    },
  ) {
    super(
      eventId,
      'PilotStarted',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class PilotCompleted extends DomainEvent<{
  readonly pilotId: PilotId;
  readonly opportunityId: OpportunityId;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly pilotId: PilotId;
      readonly opportunityId: OpportunityId;
    },
  ) {
    super(
      eventId,
      'PilotCompleted',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class PilotFailed extends DomainEvent<{
  readonly pilotId: PilotId;
  readonly opportunityId: OpportunityId;
  readonly reason: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly pilotId: PilotId;
      readonly opportunityId: OpportunityId;
      readonly reason: string;
    },
  ) {
    super(
      eventId,
      'PilotFailed',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}