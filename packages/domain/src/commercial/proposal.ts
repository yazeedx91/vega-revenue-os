import type { EventId, CorrelationId, TenantId, OpportunityId, ProposalId, EvidenceId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import { MonetaryAmount } from './value-objects/monetary-amount';
import * as Events from './events/proposal-events';

export type ProposalStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';

export interface ProposalProps {
  id?: ProposalId;
  tenantId: TenantId;
  workspaceId: string;
  opportunityId: OpportunityId;
  pricingAmount?: MonetaryAmount;
  currency?: string;
  terms?: string;
  status?: ProposalStatus;
  evidenceIds?: EvidenceId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export class ProposalInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalInvariantError';
  }
}

export class Proposal extends AggregateRoot<ProposalId> {
  public readonly workspaceId: string;
  public readonly opportunityId: OpportunityId;
  public pricingAmount: MonetaryAmount | undefined;
  public currency: string | undefined;
  public terms: string | undefined;
  private _status: ProposalStatus;
  public readonly evidenceIds: EvidenceId[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  get status(): ProposalStatus {
    return this._status;
  }

  private constructor(props: ProposalProps) {
    super(props.tenantId, props.id!);
    this.workspaceId = props.workspaceId;
    this.opportunityId = props.opportunityId;
    this.pricingAmount = props.pricingAmount;
    this.currency = props.currency;
    this.terms = props.terms;
    this._status = props.status ?? 'DRAFT';
    this.evidenceIds = props.evidenceIds ?? [];
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: ProposalProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Proposal {
    if (!props.workspaceId || props.workspaceId.trim().length === 0) {
      throw new ProposalInvariantError('Workspace ID is required');
    }
    const proposal = new Proposal({ ...props, status: props.status ?? 'DRAFT' });
    proposal.applyEvent(
      new Events.ProposalCreated(eventId, props.tenantId, correlationId, {
        proposalId: proposal.id,
        opportunityId: proposal.opportunityId,
        status: proposal._status,
      }),
    );
    return proposal;
  }

  static reconstitute(props: ProposalProps, version: number): Proposal {
    const proposal = new Proposal(props);
    proposal.setVersion(version);
    proposal.clearDomainEvents();
    return proposal;
  }

  send(correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'SENT';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ProposalSent(eventId, this.tenantId, correlationId, {
        proposalId: this.id,
        opportunityId: this.opportunityId,
      }),
    );
  }

  accept(correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'ACCEPTED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ProposalAccepted(eventId, this.tenantId, correlationId, {
        proposalId: this.id,
        opportunityId: this.opportunityId,
      }),
    );
  }

  reject(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'REJECTED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ProposalRejected(eventId, this.tenantId, correlationId, {
        proposalId: this.id,
        opportunityId: this.opportunityId,
        reason,
      }),
    );
  }

  withdraw(correlationId: CorrelationId, eventId: EventId): void {
    this._status = 'WITHDRAWN';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ProposalRejected(eventId, this.tenantId, correlationId, {
        proposalId: this.id,
        opportunityId: this.opportunityId,
        reason: 'Withdrawn',
      }),
    );
  }

  updatePricing(pricingAmount: MonetaryAmount, correlationId: CorrelationId, eventId: EventId): void {
    this.pricingAmount = pricingAmount;
    this.currency = pricingAmount.getCurrency();
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ProposalCreated(eventId, this.tenantId, correlationId, {
        proposalId: this.id,
        opportunityId: this.opportunityId,
        status: this._status,
      }),
    );
  }

  updateTerms(terms: string, correlationId: CorrelationId, eventId: EventId): void {
    this.terms = terms;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ProposalCreated(eventId, this.tenantId, correlationId, {
        proposalId: this.id,
        opportunityId: this.opportunityId,
        status: this._status,
      }),
    );
  }

  isSent(): boolean {
    return this._status === 'SENT';
  }

  isAccepted(): boolean {
    return this._status === 'ACCEPTED';
  }

  isRejected(): boolean {
    return this._status === 'REJECTED';
  }

  isDraft(): boolean {
    return this._status === 'DRAFT';
  }
}