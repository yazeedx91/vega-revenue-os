import type { EventId, CorrelationId, TenantId, FacilityId, AccountId } from '@projectx/shared';
import { DomainEvent } from '../../events/domain-event';

export class FacilityCreated extends DomainEvent<{
  readonly facilityId: FacilityId;
  readonly accountId: AccountId;
  readonly name: string;
  readonly facilityType: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly facilityId: FacilityId;
      readonly accountId: AccountId;
      readonly name: string;
      readonly facilityType: string;
    },
  ) {
    super(
      eventId,
      'FacilityCreated',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class FacilityUpdated extends DomainEvent<{
  readonly facilityId: FacilityId;
  readonly accountId: AccountId;
  readonly name?: string;
  readonly location?: string;
  readonly evidenceAdded?: number;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly facilityId: FacilityId;
      readonly accountId: AccountId;
      readonly name?: string;
      readonly location?: string;
      readonly evidenceAdded?: number;
    },
  ) {
    super(
      eventId,
      'FacilityUpdated',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}

export class FacilityStatusChanged extends DomainEvent<{
  readonly facilityId: FacilityId;
  readonly accountId: AccountId;
  readonly status: string;
}> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: {
      readonly facilityId: FacilityId;
      readonly accountId: AccountId;
      readonly status: string;
    },
  ) {
    super(
      eventId,
      'FacilityStatusChanged',
      '1.0',
      new Date(),
      tenantId,
      correlationId,
      'commercial',
      payload,
    );
  }
}