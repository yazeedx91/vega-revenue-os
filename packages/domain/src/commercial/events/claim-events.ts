import type { EventId, CorrelationId, TenantId, ClaimId } from '@projectx/shared';
import { DomainEvent } from '../../events/domain-event';

export class ClaimCreated extends DomainEvent<{
  readonly claimId: ClaimId;
  readonly subjectType: string;
  readonly classification: string;
  readonly statement: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly claimId: ClaimId;
      readonly subjectType: string;
      readonly classification: string;
      readonly statement: string;
    },
  ) {
    super(
      eventId,
      'ClaimCreated',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class ClaimClassified extends DomainEvent<{
  readonly claimId: ClaimId;
  readonly classification?: string;
  readonly statement?: string;
  readonly confidence?: number;
  readonly evidenceAdded?: number;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly claimId: ClaimId;
      readonly classification?: string;
      readonly statement?: string;
      readonly confidence?: number;
      readonly evidenceAdded?: number;
    },
  ) {
    super(
      eventId,
      'ClaimClassified',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class ClaimRetracted extends DomainEvent<{
  readonly claimId: ClaimId;
  readonly subjectType: string;
  readonly statement: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly claimId: ClaimId;
      readonly subjectType: string;
      readonly statement: string;
    },
  ) {
    super(
      eventId,
      'ClaimRetracted',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}