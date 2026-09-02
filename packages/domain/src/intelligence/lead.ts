import { type EventId, type CorrelationId, type TenantId, type AccountId, type ContactId, type LeadId, type EvidenceId, type ICPProfileId, ok, fail, type Result } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import * as Events from './events';

export interface LeadScores {
  icpMatch: number;
  signalScore: number;
  intentScore: number;
  evidenceConfidence: number;
  overall: number;
}

export interface LeadProps {
  id?: LeadId;
  tenantId: TenantId;
  missionId?: string;
  accountId: AccountId;
  contactId: ContactId;
  icpProfileId: ICPProfileId;
  scores?: LeadScores;
  status?: LeadStatus;
  decisionReason?: string;
  evidenceReferences?: EvidenceId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export type LeadStatus = 'PENDING' | 'EVALUATING' | 'QUALIFIED' | 'NOT_QUALIFIED' | 'NEEDS_REVIEW';

export class LeadInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeadInvariantError';
  }
}

export class Lead extends AggregateRoot<LeadId> {
  public missionId?: string;
  public accountId: AccountId;
  public contactId: ContactId;
  public icpProfileId: ICPProfileId;
  public scores: LeadScores;
  public status: LeadStatus;
  public decisionReason?: string;
  public readonly evidenceReferences: EvidenceId[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: LeadProps) {
    super(props.tenantId, props.id!);
    this.missionId = props.missionId;
    this.accountId = props.accountId;
    this.contactId = props.contactId;
    this.icpProfileId = props.icpProfileId;
    this.scores = props.scores ?? { icpMatch: 0, signalScore: 0, intentScore: 0, evidenceConfidence: 0, overall: 0 };
    this.status = props.status ?? 'PENDING';
    this.decisionReason = props.decisionReason;
    this.evidenceReferences = props.evidenceReferences ?? [];
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: LeadProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Lead {
    const lead = new Lead({ ...props, status: 'PENDING' });
    return lead;
  }

  static reconstitute(snapshot: LeadProps, version: number): Lead {
    const lead = new Lead(snapshot);
    lead.setVersion(version);
    lead.clearDomainEvents();
    return lead;
  }

  evaluate(
    scores: LeadScores,
    qualificationThreshold: number,
    reviewThreshold: number,
    evidenceReferences: EvidenceId[],
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, LeadInvariantError> {
    if (scores.overall < 0 || scores.overall > 1) {
      return fail(new LeadInvariantError('Overall lead score must be between 0 and 1'));
    }

    this.scores = scores;
    this.evidenceReferences.push(...evidenceReferences);
    this.status = 'EVALUATING';

    if (scores.overall >= qualificationThreshold) {
      this.status = 'QUALIFIED';
      this.decisionReason = reason;
      this.applyEvent(
        new Events.LeadQualified(eventId, this.tenantId, correlationId, {
          leadId: this.id,
          accountId: this.accountId,
          contactId: this.contactId,
          score: scores.overall,
        }),
      );
    } else if (scores.overall >= reviewThreshold) {
      this.status = 'NEEDS_REVIEW';
      this.decisionReason = reason;
      this.applyEvent(
        new Events.LeadRequiresReview(eventId, this.tenantId, correlationId, {
          leadId: this.id,
          accountId: this.accountId,
          contactId: this.contactId,
          reason,
        }),
      );
    } else {
      this.status = 'NOT_QUALIFIED';
      this.decisionReason = reason;
      this.applyEvent(
        new Events.LeadDisqualified(eventId, this.tenantId, correlationId, {
          leadId: this.id,
          accountId: this.accountId,
          contactId: this.contactId,
          reason,
        }),
      );
    }

    this.updatedAt = new Date();
    return ok(undefined);
  }

  approve(correlationId: CorrelationId, eventId: EventId): void {
    if (this.status !== 'NEEDS_REVIEW') {
      return;
    }
    this.status = 'QUALIFIED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.LeadQualified(eventId, this.tenantId, correlationId, {
        leadId: this.id,
        accountId: this.accountId,
        contactId: this.contactId,
        score: this.scores.overall,
      }),
    );
  }

  reject(reason: string, correlationId: CorrelationId, eventId: EventId): void {
    if (this.status !== 'NEEDS_REVIEW') {
      return;
    }
    this.status = 'NOT_QUALIFIED';
    this.decisionReason = reason;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.LeadDisqualified(eventId, this.tenantId, correlationId, {
        leadId: this.id,
        accountId: this.accountId,
        contactId: this.contactId,
        reason,
      }),
    );
  }

  recordConversationOutcome(
    outcome: 'QUALIFIED' | 'NOT_QUALIFIED',
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, LeadInvariantError> {
    if (this.status === 'NOT_QUALIFIED' && outcome === 'QUALIFIED') {
      return fail(new LeadInvariantError('Cannot re-qualify a permanently disqualified lead'));
    }

    this.status = outcome;
    this.decisionReason = reason;
    this.updatedAt = new Date();

    if (outcome === 'QUALIFIED') {
      this.applyEvent(
        new Events.LeadQualified(eventId, this.tenantId, correlationId, {
          leadId: this.id,
          accountId: this.accountId,
          contactId: this.contactId,
          score: this.scores.overall,
        }),
      );
    } else {
      this.applyEvent(
        new Events.LeadDisqualified(eventId, this.tenantId, correlationId, {
          leadId: this.id,
          accountId: this.accountId,
          contactId: this.contactId,
          reason,
        }),
      );
    }

    return ok(undefined);
  }
}
