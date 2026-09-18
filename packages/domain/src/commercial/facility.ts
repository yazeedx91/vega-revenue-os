import type { EventId, CorrelationId, TenantId, AccountId, EvidenceId, FacilityId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import * as Events from './events/facility-events';

export type FacilityStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';

export type FacilityType = 
  | 'MANUFACTURING_PLANT'
  | 'DISTRIBUTION_CENTER'
  | 'WAREHOUSE'
  | 'RESEARCH_FACILITY'
  | 'OFFICE'
  | 'OTHER';

export interface FacilityProps {
  id?: FacilityId;
  tenantId: TenantId;
  workspaceId: string;
  accountId: AccountId;
  name: string;
  facilityType: FacilityType;
  location?: string;
  status?: FacilityStatus;
  evidenceReferences?: EvidenceId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export class FacilityInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacilityInvariantError';
  }
}

export class Facility extends AggregateRoot<FacilityId> {
  public readonly workspaceId: string;
  public readonly accountId: AccountId;
  public name: string;
  public readonly facilityType: FacilityType;
  public location?: string;
  public status: FacilityStatus;
  public readonly evidenceReferences: EvidenceId[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: FacilityProps) {
    super(props.tenantId, props.id!);
    this.workspaceId = props.workspaceId;
    this.accountId = props.accountId;
    this.name = props.name;
    this.facilityType = props.facilityType;
    this.location = props.location;
    this.status = props.status ?? 'UNKNOWN';
    this.evidenceReferences = props.evidenceReferences ?? [];
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: FacilityProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Facility {
    if (!props.name || props.name.trim().length === 0) {
      throw new FacilityInvariantError('Facility name is required');
    }
    if (!props.workspaceId || props.workspaceId.trim().length === 0) {
      throw new FacilityInvariantError('Workspace ID is required');
    }
    const facility = new Facility({ ...props, status: props.status ?? 'UNKNOWN' });
    facility.applyEvent(
      new Events.FacilityCreated(eventId, props.tenantId, correlationId, {
        facilityId: facility.id,
        accountId: facility.accountId,
        name: facility.name,
        facilityType: facility.facilityType,
      }),
    );
    return facility;
  }

  static reconstitute(props: FacilityProps, version: number): Facility {
    const facility = new Facility(props);
    facility.setVersion(version);
    facility.clearDomainEvents();
    return facility;
  }

  updateName(name: string, correlationId: CorrelationId, eventId: EventId): void {
    if (!name || name.trim().length === 0) {
      throw new FacilityInvariantError('Facility name is required');
    }
    this.name = name;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.FacilityUpdated(eventId, this.tenantId, correlationId, {
        facilityId: this.id,
        accountId: this.accountId,
        name: this.name,
      }),
    );
  }

  updateLocation(location: string | undefined, correlationId: CorrelationId, eventId: EventId): void {
    this.location = location;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.FacilityUpdated(eventId, this.tenantId, correlationId, {
        facilityId: this.id,
        accountId: this.accountId,
        location: this.location,
      }),
    );
  }

  setStatus(status: FacilityStatus, correlationId: CorrelationId, eventId: EventId): void {
    this.status = status;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.FacilityStatusChanged(eventId, this.tenantId, correlationId, {
        facilityId: this.id,
        accountId: this.accountId,
        status: this.status,
      }),
    );
  }

  addEvidenceReferences(evidenceIds: EvidenceId[], correlationId: CorrelationId, eventId: EventId): void {
    this.evidenceReferences.push(...evidenceIds);
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.FacilityUpdated(eventId, this.tenantId, correlationId, {
        facilityId: this.id,
        accountId: this.accountId,
        evidenceAdded: evidenceIds.length,
      }),
    );
  }
}