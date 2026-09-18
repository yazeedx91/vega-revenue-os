import type { EventId, CorrelationId, TenantId, AccountId, EvidenceId, OpportunityId, FacilityId, ContactId, ClaimId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import { MonetaryAmount } from './value-objects/monetary-amount';
import { Probability } from './value-objects/probability';
import type { OpportunityStatus } from './opportunity-status';
import { canTransitionOpportunity, isTerminalOpportunityStatus, requiresGuardedTransition, requiresJustificationForBackwardTransition } from './opportunity-status';
import * as Events from './events/opportunity-events';

export interface OpportunityProps {
  id?: OpportunityId;
  tenantId: TenantId;
  workspaceId: string;
  accountId: AccountId;
  facilityIds?: FacilityId[];
  contactIds?: ContactId[];
  evidenceIds?: EvidenceId[];
  claimIds?: ClaimId[];
  problemHypothesis?: string;
  vegaSolutionFit?: string;
  estimatedACV?: MonetaryAmount;
  expectedARR?: MonetaryAmount;
  winProbability?: Probability;
  expansionPotential?: MonetaryAmount;
  technicalReadiness?: number;
  commercialReadiness?: number;
  stakeholders?: string[];
  stage?: OpportunityStatus;
  nextAction?: string;
  risks?: string[];
  previousOpportunityId?: OpportunityId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class OpportunityInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpportunityInvariantError';
  }
}

export class Opportunity extends AggregateRoot<OpportunityId> {
  public readonly workspaceId: string;
  public readonly accountId: AccountId;
  public readonly facilityIds: FacilityId[];
  public readonly contactIds: ContactId[];
  public readonly evidenceIds: EvidenceId[];
  public readonly claimIds: ClaimId[];
  public problemHypothesis: string | undefined;
  public vegaSolutionFit: string | undefined;
  public estimatedACV: MonetaryAmount | undefined;
  public expectedARR: MonetaryAmount | undefined;
  public winProbability: Probability | undefined;
  public expansionPotential: MonetaryAmount | undefined;
  public technicalReadiness: number | undefined;
  public commercialReadiness: number | undefined;
  public readonly stakeholders: string[];
  private _stage: OpportunityStatus;
  public nextAction: string | undefined;
  public readonly risks: string[];
  public readonly previousOpportunityId: OpportunityId | null;
  public readonly createdAt: Date;
  public updatedAt: Date;

  get stage(): OpportunityStatus {
    return this._stage;
  }

  private constructor(props: OpportunityProps) {
    super(props.tenantId, props.id!);
    this.workspaceId = props.workspaceId;
    this.accountId = props.accountId;
    this.facilityIds = props.facilityIds ?? [];
    this.contactIds = props.contactIds ?? [];
    this.evidenceIds = props.evidenceIds ?? [];
    this.claimIds = props.claimIds ?? [];
    this.problemHypothesis = props.problemHypothesis;
    this.vegaSolutionFit = props.vegaSolutionFit;
    this.estimatedACV = props.estimatedACV;
    this.expectedARR = props.expectedARR;
    this.winProbability = props.winProbability;
    this.expansionPotential = props.expansionPotential;
    this.technicalReadiness = props.technicalReadiness;
    this.commercialReadiness = props.commercialReadiness;
    this.stakeholders = props.stakeholders ?? [];
    this._stage = props.stage ?? 'DISCOVERED';
    this.nextAction = props.nextAction;
    this.risks = props.risks ?? [];
    this.previousOpportunityId = props.previousOpportunityId ?? null;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: OpportunityProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Opportunity {
    if (!props.workspaceId || props.workspaceId.trim().length === 0) {
      throw new OpportunityInvariantError('Workspace ID is required');
    }
    if (props.technicalReadiness !== undefined && (props.technicalReadiness < 0 || props.technicalReadiness > 1)) {
      throw new OpportunityInvariantError('Technical readiness must be between 0 and 1');
    }
    if (props.commercialReadiness !== undefined && (props.commercialReadiness < 0 || props.commercialReadiness > 1)) {
      throw new OpportunityInvariantError('Commercial readiness must be between 0 and 1');
    }

    const opportunity = new Opportunity({ ...props, stage: props.stage ?? 'DISCOVERED' });
    opportunity.applyEvent(
      new Events.OpportunityDiscovered(eventId, props.tenantId, correlationId, {
        opportunityId: opportunity.id,
        accountId: opportunity.accountId,
        stage: opportunity._stage,
      }),
    );
    return opportunity;
  }

  static reconstitute(props: OpportunityProps, version: number): Opportunity {
    const opportunity = new Opportunity(props);
    opportunity.setVersion(version);
    opportunity.clearDomainEvents();
    return opportunity;
  }

  transitionTo(
    to: OpportunityStatus,
    correlationId: CorrelationId,
    eventId: EventId,
    justification?: string,
  ): void {
    if (isTerminalOpportunityStatus(this._stage)) {
      throw new OpportunityInvariantError(`Cannot transition from terminal state ${this._stage}`);
    }

    if (!canTransitionOpportunity(this._stage, to)) {
      throw new OpportunityInvariantError(`Cannot transition opportunity from ${this._stage} to ${to}`);
    }

    if (requiresGuardedTransition(this._stage, to)) {
      if (!justification || justification.trim().length === 0) {
        throw new OpportunityInvariantError('Guarded transition requires justification');
      }
    }

    if (requiresJustificationForBackwardTransition(this._stage, to)) {
      if (!justification || justification.trim().length === 0) {
        throw new OpportunityInvariantError('Backward transition requires justification');
      }
    }

    const from = this._stage;
    this._stage = to;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.OpportunityProgressed(eventId, this.tenantId, correlationId, {
        opportunityId: this.id,
        accountId: this.accountId,
        from,
        to,
        justification,
      }),
    );
  }

  qualify(correlationId: CorrelationId, eventId: EventId): void {
    this.transitionTo('QUALIFYING', correlationId, eventId);
  }

  advanceToQualified(correlationId: CorrelationId, eventId: EventId): void {
    this.transitionTo('QUALIFIED', correlationId, eventId);
  }

  disqualify(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    this.transitionTo('DISQUALIFIED', correlationId, eventId, reason);
  }

  reconsider(justification: string, correlationId: CorrelationId, eventId: EventId): void {
    this.transitionTo('QUALIFYING', correlationId, eventId, justification);
  }

  win(correlationId: CorrelationId, eventId: EventId): void {
    this.transitionTo('WON', correlationId, eventId);
  }

  lose(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    this.transitionTo('LOST', correlationId, eventId, reason);
  }

  updateProblemHypothesis(hypothesis: string, correlationId: CorrelationId, eventId: EventId): void {
    this.problemHypothesis = hypothesis;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.OpportunityProgressed(eventId, this.tenantId, correlationId, {
        opportunityId: this.id,
        accountId: this.accountId,
        from: this._stage,
        to: this._stage,
      }),
    );
  }

  updateSolutionFit(solutionFit: string, correlationId: CorrelationId, eventId: EventId): void {
    this.vegaSolutionFit = solutionFit;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.OpportunityProgressed(eventId, this.tenantId, correlationId, {
        opportunityId: this.id,
        accountId: this.accountId,
        from: this._stage,
        to: this._stage,
      }),
    );
  }

  updateWinProbability(probability: Probability, correlationId: CorrelationId, eventId: EventId): void {
    this.winProbability = probability;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.OpportunityProgressed(eventId, this.tenantId, correlationId, {
        opportunityId: this.id,
        accountId: this.accountId,
        from: this._stage,
        to: this._stage,
      }),
    );
  }

  setNextAction(action: string, correlationId: CorrelationId, eventId: EventId): void {
    this.nextAction = action;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.OpportunityProgressed(eventId, this.tenantId, correlationId, {
        opportunityId: this.id,
        accountId: this.accountId,
        from: this._stage,
        to: this._stage,
      }),
    );
  }

  addFacility(facilityId: FacilityId, correlationId: CorrelationId, eventId: EventId): void {
    if (!this.facilityIds.includes(facilityId)) {
      this.facilityIds.push(facilityId);
      this.updatedAt = new Date();
      this.applyEvent(
        new Events.OpportunityProgressed(eventId, this.tenantId, correlationId, {
          opportunityId: this.id,
          accountId: this.accountId,
          from: this._stage,
          to: this._stage,
        }),
      );
    }
  }

  addContact(contactId: ContactId, correlationId: CorrelationId, eventId: EventId): void {
    if (!this.contactIds.includes(contactId)) {
      this.contactIds.push(contactId);
      this.updatedAt = new Date();
      this.applyEvent(
        new Events.OpportunityProgressed(eventId, this.tenantId, correlationId, {
          opportunityId: this.id,
          accountId: this.accountId,
          from: this._stage,
          to: this._stage,
        }),
      );
    }
  }

  addEvidence(evidenceId: EvidenceId, correlationId: CorrelationId, eventId: EventId): void {
    if (!this.evidenceIds.includes(evidenceId)) {
      this.evidenceIds.push(evidenceId);
      this.updatedAt = new Date();
      this.applyEvent(
        new Events.OpportunityProgressed(eventId, this.tenantId, correlationId, {
          opportunityId: this.id,
          accountId: this.accountId,
          from: this._stage,
          to: this._stage,
        }),
      );
    }
  }

  addClaim(claimId: ClaimId, correlationId: CorrelationId, eventId: EventId): void {
    if (!this.claimIds.includes(claimId)) {
      this.claimIds.push(claimId);
      this.updatedAt = new Date();
      this.applyEvent(
        new Events.OpportunityProgressed(eventId, this.tenantId, correlationId, {
          opportunityId: this.id,
          accountId: this.accountId,
          from: this._stage,
          to: this._stage,
        }),
      );
    }
  }

  isTerminal(): boolean {
    return isTerminalOpportunityStatus(this._stage);
  }

  isWon(): boolean {
    return this._stage === 'WON';
  }

  isLost(): boolean {
    return this._stage === 'LOST';
  }

  isDisqualified(): boolean {
    return this._stage === 'DISQUALIFIED';
  }

  isActive(): boolean {
    return !this.isTerminal() && !this.isDisqualified();
  }

  hasPreviousOpportunity(): boolean {
    return this.previousOpportunityId !== null;
  }
}