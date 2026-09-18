import type { EventId, CorrelationId, TenantId, OpportunityId, PilotId, EvidenceId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import * as Events from './events/pilot-events';

export type PilotStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface PilotProps {
  id?: PilotId;
  tenantId: TenantId;
  workspaceId: string;
  opportunityId: OpportunityId;
  successCriteria?: string;
  startDate?: Date;
  endDate?: Date;
  status?: PilotStatus;
  evidenceIds?: EvidenceId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export class PilotInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PilotInvariantError';
  }
}

export class Pilot extends AggregateRoot<PilotId> {
  public readonly workspaceId: string;
  public readonly opportunityId: OpportunityId;
  public successCriteria: string | undefined;
  public startDate: Date | undefined;
  public endDate: Date | undefined;
  private _status: PilotStatus;
  public readonly evidenceIds: EvidenceId[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  get status(): PilotStatus {
    return this._status;
  }

  private constructor(props: PilotProps) {
    super(props.tenantId, props.id!);
    this.workspaceId = props.workspaceId;
    this.opportunityId = props.opportunityId;
    this.successCriteria = props.successCriteria;
    this.startDate = props.startDate;
    this.endDate = props.endDate;
    this._status = props.status ?? 'PLANNED';
    this.evidenceIds = props.evidenceIds ?? [];
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: PilotProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Pilot {
    if (!props.workspaceId || props.workspaceId.trim().length === 0) {
      throw new PilotInvariantError('Workspace ID is required');
    }
    const pilot = new Pilot({ ...props, status: props.status ?? 'PLANNED' });
    pilot.applyEvent(
      new Events.PilotStarted(eventId, props.tenantId, correlationId, {
        pilotId: pilot.id,
        opportunityId: pilot.opportunityId,
        status: pilot._status,
      }),
    );
    return pilot;
  }

  static reconstitute(props: PilotProps, version: number): Pilot {
    const pilot = new Pilot(props);
    pilot.setVersion(version);
    pilot.clearDomainEvents();
    return pilot;
  }

  start(correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'ACTIVE';
    this.startDate = new Date();
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.PilotStarted(eventId, this.tenantId, correlationId, {
        pilotId: this.id,
        opportunityId: this.opportunityId,
      }),
    );
  }

  complete(correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'COMPLETED';
    this.endDate = new Date();
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.PilotCompleted(eventId, this.tenantId, correlationId, {
        pilotId: this.id,
        opportunityId: this.opportunityId,
      }),
    );
  }

  fail(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'FAILED';
    this.endDate = new Date();
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.PilotFailed(eventId, this.tenantId, correlationId, {
        pilotId: this.id,
        opportunityId: this.opportunityId,
        reason,
      }),
    );
  }

  cancel(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'CANCELLED';
    this.endDate = new Date();
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.PilotFailed(eventId, this.tenantId, correlationId, {
        pilotId: this.id,
        opportunityId: this.opportunityId,
        reason,
      }),
    );
  }

  updateSuccessCriteria(criteria: string, correlationId: CorrelationId, eventId: EventId): void {
    this.successCriteria = criteria;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.PilotStarted(eventId, this.tenantId, correlationId, {
        pilotId: this.id,
        opportunityId: this.opportunityId,
        status: this._status,
      }),
    );
  }

  isActive(): boolean {
    return this._status === 'ACTIVE';
  }

  isCompleted(): boolean {
    return this._status === 'COMPLETED';
  }

  isFailed(): boolean {
    return this._status === 'FAILED';
  }

  isPlanned(): boolean {
    return this._status === 'PLANNED';
  }
}