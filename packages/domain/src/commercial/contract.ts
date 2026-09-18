import type { EventId, CorrelationId, TenantId, OpportunityId, ProposalId, ContractId, EvidenceId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import { MonetaryAmount } from './value-objects/monetary-amount';
import * as Events from './events/contract-events';

export type ContractStatus = 'DRAFT' | 'SIGNED' | 'ACTIVE' | 'AMENDED' | 'TERMINATED' | 'EXPIRED';

export interface ContractProps {
  id?: ContractId;
  tenantId: TenantId;
  workspaceId: string;
  opportunityId: OpportunityId;
  proposalId?: ProposalId;
  value?: MonetaryAmount;
  startDate?: Date;
  endDate?: Date;
  status?: ContractStatus;
  evidenceIds?: EvidenceId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export class ContractInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractInvariantError';
  }
}

export class Contract extends AggregateRoot<ContractId> {
  public readonly workspaceId: string;
  public readonly opportunityId: OpportunityId;
  public readonly proposalId: ProposalId | undefined;
  public value: MonetaryAmount | undefined;
  public startDate: Date | undefined;
  public endDate: Date | undefined;
  private _status: ContractStatus;
  public readonly evidenceIds: EvidenceId[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  get status(): ContractStatus {
    return this._status;
  }

  private constructor(props: ContractProps) {
    super(props.tenantId, props.id!);
    this.workspaceId = props.workspaceId;
    this.opportunityId = props.opportunityId;
    this.proposalId = props.proposalId;
    this.value = props.value;
    this.startDate = props.startDate;
    this.endDate = props.endDate;
    this._status = props.status ?? 'DRAFT';
    this.evidenceIds = props.evidenceIds ?? [];
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: ContractProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Contract {
    if (!props.workspaceId || props.workspaceId.trim().length === 0) {
      throw new ContractInvariantError('Workspace ID is required');
    }
    const contract = new Contract({ ...props, status: props.status ?? 'DRAFT' });
    contract.applyEvent(
      new Events.ContractSigned(eventId, props.tenantId, correlationId, {
        contractId: contract.id,
        opportunityId: contract.opportunityId,
        status: contract._status,
      }),
    );
    return contract;
  }

  static reconstitute(props: ContractProps, version: number): Contract {
    const contract = new Contract(props);
    contract.setVersion(version);
    contract.clearDomainEvents();
    return contract;
  }

  sign(correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'SIGNED';
    this.startDate = new Date();
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContractSigned(eventId, this.tenantId, correlationId, {
        contractId: this.id,
        opportunityId: this.opportunityId,
      }),
    );
  }

  activate(correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'ACTIVE';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContractSigned(eventId, this.tenantId, correlationId, {
        contractId: this.id,
        opportunityId: this.opportunityId,
      }),
    );
  }

  amend(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'AMENDED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContractAmended(eventId, this.tenantId, correlationId, {
        contractId: this.id,
        opportunityId: this.opportunityId,
        reason,
      }),
    );
  }

  terminate(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'TERMINATED';
    this.endDate = new Date();
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContractTerminated(eventId, this.tenantId, correlationId, {
        contractId: this.id,
        opportunityId: this.opportunityId,
        reason,
      }),
    );
  }

  expire(correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'EXPIRED';
    this.endDate = new Date();
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContractTerminated(eventId, this.tenantId, correlationId, {
        contractId: this.id,
        opportunityId: this.opportunityId,
        reason: 'Expired',
      }),
    );
  }

  updateValue(value: MonetaryAmount, correlationId: CorrelationId, eventId: EventId): void {
    this.value = value;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ContractAmended(eventId, this.tenantId, correlationId, {
        contractId: this.id,
        opportunityId: this.opportunityId,
        reason: 'Value updated',
      }),
    );
  }

  isSigned(): boolean {
    return this._status === 'SIGNED';
  }

  isActive(): boolean {
    return this._status === 'ACTIVE';
  }

  isTerminated(): boolean {
    return this._status === 'TERMINATED';
  }

  isExpired(): boolean {
    return this._status === 'EXPIRED';
  }

  isDraft(): boolean {
    return this._status === 'DRAFT';
  }
}