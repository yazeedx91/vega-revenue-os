import { type EventId, type CorrelationId, type TenantId, type AccountId, type ContactId, type LeadId, type EvidenceId, type ICPProfileId, type ICPProfileVersionId, type SignalId, ok, fail, type Result } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import * as Events from './events';

export interface LeadScores {
  icpMatch: number;
  signalScore: number;
  intentScore: number;
  evidenceConfidence: number;
  overall: number;
}

export type QualificationOutcome = 'QUALIFIED' | 'NEEDS_REVIEW' | 'NOT_QUALIFIED';

export const HARD_FILTER_CODES = ['INDUSTRY', 'GEOGRAPHY', 'COMPANY_SIZE', 'TERRITORY', 'EXCLUDED_INDUSTRY'] as const;
export type HardFilterCode = (typeof HARD_FILTER_CODES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonSafeObject = { [key: string]: JsonValue };

export interface QualificationSnapshot {
  readonly snapshotSchemaVersion: string;
  readonly scoringPolicyVersion: string;
  readonly algorithmVersion: string;
  readonly evaluatedAt: string;
  readonly icpProfileId: ICPProfileId;
  readonly icpProfileVersionId: ICPProfileVersionId;
  readonly normalizedFeatures: JsonSafeObject;
  readonly hardFilterResults: ReadonlyArray<{ readonly filter: HardFilterCode; readonly passed: boolean }>;
  readonly scores: Readonly<LeadScores>;
  readonly thresholdsUsed: Readonly<{ qualification: number; review: number }>;
  readonly evidenceIds: readonly EvidenceId[];
  readonly signalIds: readonly SignalId[];
  readonly reasonCodes: readonly string[];
  readonly finalOutcome: QualificationOutcome;
  readonly reasoningArtifactId?: string;
}

export interface EvaluationInput {
  scores: LeadScores;
  qualificationThreshold: number;
  reviewThreshold: number;
  hardFilterResults: Array<{ filter: HardFilterCode; passed: boolean }>;
  evidenceIds: EvidenceId[];
  signalIds: SignalId[];
  normalizedFeatures: JsonSafeObject;
  snapshotSchemaVersion: string;
  scoringPolicyVersion: string;
  algorithmVersion: string;
  evaluatedAt: Date;
  reasoningArtifactId?: string;
}

export interface LeadProps {
  id?: LeadId;
  tenantId: TenantId;
  workspaceId: string;
  missionId?: string;
  accountId: AccountId;
  contactId: ContactId;
  icpProfileId: ICPProfileId;
  icpProfileVersionId: ICPProfileVersionId;
  scores?: LeadScores;
  status?: LeadStatus;
  decisionReason?: string;
  reasonCodes?: string[];
  qualificationSnapshot?: QualificationSnapshot;
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

function isJsonSafe(value: unknown, seen: Set<unknown> = new Set()): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'function' || typeof value === 'undefined' || typeof value === 'symbol' || typeof value === 'bigint') return false;
  if (value instanceof Date || value instanceof RegExp || value instanceof Map || value instanceof Set) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((v) => isJsonSafe(v, seen));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((v) => isJsonSafe(v, seen));
  }
  return false;
}

function deepFreeze<T>(obj: T): T {
  Object.freeze(obj);
  if (obj !== null && typeof obj === 'object') {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
        deepFreeze(val);
      }
    }
  }
  return obj;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

export class Lead extends AggregateRoot<LeadId> {
  public readonly workspaceId: string;
  public missionId?: string;
  public accountId: AccountId;
  public contactId: ContactId;
  public icpProfileId: ICPProfileId;
  public icpProfileVersionId: ICPProfileVersionId;
  public scores: LeadScores;
  public status: LeadStatus;
  public decisionReason?: string;
  public reasonCodes: string[];
  public qualificationSnapshot?: QualificationSnapshot;
  public readonly evidenceReferences: EvidenceId[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: LeadProps) {
    super(props.tenantId, props.id!);
    this.workspaceId = props.workspaceId;
    this.missionId = props.missionId;
    this.accountId = props.accountId;
    this.contactId = props.contactId;
    this.icpProfileId = props.icpProfileId;
    this.icpProfileVersionId = props.icpProfileVersionId;
    this.scores = props.scores ?? { icpMatch: 0, signalScore: 0, intentScore: 0, evidenceConfidence: 0, overall: 0 };
    this.status = props.status ?? 'PENDING';
    this.decisionReason = props.decisionReason;
    this.reasonCodes = props.reasonCodes ?? [];
    this.qualificationSnapshot = props.qualificationSnapshot;
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
    input: EvaluationInput,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, LeadInvariantError> {
    if (this.qualificationSnapshot) {
      return fail(new LeadInvariantError('Evaluation is single-shot: qualificationSnapshot already exists'));
    }
    if (this.status !== 'PENDING') {
      return fail(new LeadInvariantError(`Cannot evaluate Lead in status ${this.status}; must be PENDING`));
    }

    const { scores, qualificationThreshold, reviewThreshold, hardFilterResults, evaluatedAt } = input;

    if (scores.overall < 0 || scores.overall > 1) {
      return fail(new LeadInvariantError('Overall lead score must be between 0 and 1'));
    }
    for (const key of ['icpMatch', 'signalScore', 'intentScore', 'evidenceConfidence', 'overall'] as const) {
      if (!Number.isFinite(scores[key])) {
        return fail(new LeadInvariantError(`Score component ${key} must be finite`));
      }
    }
    if (!Number.isFinite(qualificationThreshold) || !Number.isFinite(reviewThreshold)) {
      return fail(new LeadInvariantError('Thresholds must be finite numbers'));
    }
    if (qualificationThreshold < reviewThreshold) {
      return fail(new LeadInvariantError('qualificationThreshold must be >= reviewThreshold'));
    }
    if (!(evaluatedAt instanceof Date) || isNaN(evaluatedAt.getTime())) {
      return fail(new LeadInvariantError('evaluatedAt must be a valid Date'));
    }
    if (!input.snapshotSchemaVersion) {
      return fail(new LeadInvariantError('snapshotSchemaVersion must be non-empty'));
    }
    if (!input.scoringPolicyVersion) {
      return fail(new LeadInvariantError('scoringPolicyVersion must be non-empty'));
    }
    if (!input.algorithmVersion) {
      return fail(new LeadInvariantError('algorithmVersion must be non-empty'));
    }
    if (!isJsonSafe(input.normalizedFeatures)) {
      return fail(new LeadInvariantError('normalizedFeatures must be JSON-safe (no functions, cycles, undefined, NaN, Infinity)'));
    }
    for (const hf of hardFilterResults) {
      if (!(HARD_FILTER_CODES as readonly string[]).includes(hf.filter)) {
        return fail(new LeadInvariantError(`Invalid hard filter code: ${hf.filter}. Must be one of: ${HARD_FILTER_CODES.join(', ')}`));
      }
    }

    this.status = 'EVALUATING';

    const reasonCodes: string[] = [];
    let finalOutcome: QualificationOutcome;

    const failedFilters = hardFilterResults.filter((hf) => !hf.passed);
    if (failedFilters.length > 0) {
      finalOutcome = 'NOT_QUALIFIED';
      for (const ff of failedFilters) {
        reasonCodes.push(`HARD_FILTER_FAIL:${ff.filter}`);
      }
    } else if (scores.overall >= qualificationThreshold) {
      finalOutcome = 'QUALIFIED';
      reasonCodes.push('SCORE_ABOVE_QUALIFICATION_THRESHOLD');
    } else if (scores.overall >= reviewThreshold) {
      finalOutcome = 'NEEDS_REVIEW';
      reasonCodes.push('SCORE_BETWEEN_REVIEW_AND_QUALIFICATION');
    } else {
      finalOutcome = 'NOT_QUALIFIED';
      reasonCodes.push('SCORE_BELOW_REVIEW_THRESHOLD');
    }

    const snapshot: QualificationSnapshot = deepFreeze({
      snapshotSchemaVersion: input.snapshotSchemaVersion,
      scoringPolicyVersion: input.scoringPolicyVersion,
      algorithmVersion: input.algorithmVersion,
      evaluatedAt: evaluatedAt.toISOString(),
      icpProfileId: this.icpProfileId,
      icpProfileVersionId: this.icpProfileVersionId,
      normalizedFeatures: deepClone(input.normalizedFeatures),
      hardFilterResults: deepClone(hardFilterResults),
      scores: { ...scores },
      thresholdsUsed: { qualification: qualificationThreshold, review: reviewThreshold },
      evidenceIds: [...input.evidenceIds],
      signalIds: [...input.signalIds],
      reasonCodes: [...reasonCodes],
      finalOutcome,
      ...(input.reasoningArtifactId ? { reasoningArtifactId: input.reasoningArtifactId } : {}),
    });

    this.qualificationSnapshot = snapshot;
    this.scores = { ...scores };
    this.reasonCodes = [...reasonCodes];
    this.status = finalOutcome === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : finalOutcome;
    this.decisionReason = reasonCodes.join('; ');
    this.evidenceReferences.push(...input.evidenceIds);
    this.updatedAt = new Date();

    if (finalOutcome === 'QUALIFIED') {
      this.applyEvent(
        new Events.LeadQualified(eventId, this.tenantId, correlationId, {
          leadId: this.id,
          accountId: this.accountId,
          contactId: this.contactId,
          score: scores.overall,
        }),
      );
    } else if (finalOutcome === 'NEEDS_REVIEW') {
      this.applyEvent(
        new Events.LeadRequiresReview(eventId, this.tenantId, correlationId, {
          leadId: this.id,
          accountId: this.accountId,
          contactId: this.contactId,
          reason: this.decisionReason,
        }),
      );
    } else {
      this.applyEvent(
        new Events.LeadDisqualified(eventId, this.tenantId, correlationId, {
          leadId: this.id,
          accountId: this.accountId,
          contactId: this.contactId,
          reason: this.decisionReason,
        }),
      );
    }

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
