import type { EventId, CorrelationId, TenantId, EvidenceId, ClaimId } from '@projectx/shared';
import type { AccountId, FacilityId, OpportunityId } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import { Probability } from './value-objects/probability';
import * as Events from './events/claim-events';

export type ClaimClassification = 'FACT' | 'INFERENCE' | 'ASSUMPTION';

export type ClaimSubjectType = 'ACCOUNT' | 'FACILITY' | 'OPPORTUNITY' | 'GENERAL';

export interface ClaimProps {
  id?: ClaimId;
  tenantId: TenantId;
  workspaceId: string;
  subjectType: ClaimSubjectType;
  subjectId?: AccountId | FacilityId | OpportunityId | null;
  reference?: string | null;
  classification: ClaimClassification;
  statement: string;
  value?: unknown;
  evidenceIds: EvidenceId[];
  confidence: number;
  observedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export class CommercialClaimInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommercialClaimInvariantError';
  }
}

export class CommercialClaim extends AggregateRoot<ClaimId> {
  public readonly workspaceId: string;
  public readonly subjectType: ClaimSubjectType;
  public readonly subjectId: AccountId | FacilityId | OpportunityId | null;
  public readonly reference: string | null;
  public classification: ClaimClassification;
  public statement: string;
  public readonly value: unknown;
  public readonly evidenceIds: EvidenceId[];
  public confidence: number;
  public readonly observedAt: Date;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: ClaimProps) {
    super(props.tenantId, props.id!);
    this.workspaceId = props.workspaceId;
    this.subjectType = props.subjectType;
    this.subjectId = props.subjectId ?? null;
    this.reference = props.reference ?? null;
    this.classification = props.classification;
    this.statement = props.statement;
    this.value = props.value;
    this.evidenceIds = props.evidenceIds;
    this.confidence = props.confidence;
    this.observedAt = props.observedAt;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: ClaimProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): CommercialClaim {
    if (!props.workspaceId || props.workspaceId.trim().length === 0) {
      throw new CommercialClaimInvariantError('Workspace ID is required');
    }
    if (!props.statement || props.statement.trim().length === 0) {
      throw new CommercialClaimInvariantError('Statement is required');
    }
    if (props.confidence < 0 || props.confidence > 1) {
      throw new CommercialClaimInvariantError('Confidence must be between 0 and 1');
    }
    if (!(props.observedAt instanceof Date) || isNaN(props.observedAt.getTime())) {
      throw new CommercialClaimInvariantError('ObservedAt must be a valid date');
    }
    if (props.evidenceIds.length === 0 && props.classification === 'FACT') {
      throw new CommercialClaimInvariantError('FACT claims require at least one evidence reference');
    }

    const claim = new CommercialClaim(props);
    claim.applyEvent(
      new Events.ClaimCreated(eventId, props.tenantId, correlationId, {
        claimId: claim.id,
        subjectType: claim.subjectType,
        classification: claim.classification,
        statement: claim.statement,
      }),
    );
    return claim;
  }

  static reconstitute(props: ClaimProps, version: number): CommercialClaim {
    const claim = new CommercialClaim(props);
    claim.setVersion(version);
    claim.clearDomainEvents();
    return claim;
  }

  updateClassification(classification: ClaimClassification, correlationId: CorrelationId, eventId: EventId): void {
    this.classification = classification;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ClaimClassified(eventId, this.tenantId, correlationId, {
        claimId: this.id,
        classification: this.classification,
      }),
    );
  }

  updateStatement(statement: string, correlationId: CorrelationId, eventId: EventId): void {
    if (!statement || statement.trim().length === 0) {
      throw new CommercialClaimInvariantError('Statement is required');
    }
    this.statement = statement;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ClaimClassified(eventId, this.tenantId, correlationId, {
        claimId: this.id,
        statement: this.statement,
      }),
    );
  }

  updateConfidence(confidence: number, correlationId: CorrelationId, eventId: EventId): void {
    if (confidence < 0 || confidence > 1) {
      throw new CommercialClaimInvariantError('Confidence must be between 0 and 1');
    }
    this.confidence = confidence;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ClaimClassified(eventId, this.tenantId, correlationId, {
        claimId: this.id,
        confidence: this.confidence,
      }),
    );
  }

  addEvidenceIds(evidenceIds: EvidenceId[], correlationId: CorrelationId, eventId: EventId): void {
    this.evidenceIds.push(...evidenceIds);
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ClaimClassified(eventId, this.tenantId, correlationId, {
        claimId: this.id,
        evidenceAdded: evidenceIds.length,
      }),
    );
  }

  retract(correlationId: CorrelationId, eventId: EventId): void {
    this.applyEvent(
      new Events.ClaimRetracted(eventId, this.tenantId, correlationId, {
        claimId: this.id,
        subjectType: this.subjectType,
        statement: this.statement,
      }),
    );
  }

  isFact(): boolean {
    return this.classification === 'FACT';
  }

  isInference(): boolean {
    return this.classification === 'INFERENCE';
  }

  isAssumption(): boolean {
    return this.classification === 'ASSUMPTION';
  }

  hasEvidence(): boolean {
    return this.evidenceIds.length > 0;
  }

  isHighConfidence(): boolean {
    return this.confidence >= 0.7;
  }
}