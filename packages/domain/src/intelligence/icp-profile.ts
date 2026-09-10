import { type EventId, type CorrelationId, type TenantId, type ICPProfileId, type ICPProfileVersionId, asICPProfileId, ok, fail, type Result } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import * as Events from './events';

export interface ICPHardFilter {
  industries?: string[];
  minEmployees?: number;
  maxEmployees?: number;
  territories?: string[];
  excludedIndustries?: string[];
}

export interface ICPScoringWeights {
  icpMatch: number;
  signal: number;
  intent: number;
  evidenceConfidence: number;
}

export interface ICPProfileProps {
  id?: ICPProfileId;
  versionId: ICPProfileVersionId;
  version: number;
  tenantId: TenantId;
  workspaceId: string;
  name: string;
  hardFilters: ICPHardFilter;
  softCriteria: Array<{ criterion: string; weight: number }>;
  positiveSignals: string[];
  negativeSignals: string[];
  disqualifiers: string[];
  scoringWeights: ICPScoringWeights;
  qualificationThreshold: number;
  reviewThreshold: number;
  minimumConfidence: number;
  status?: ICPProfileStatus;
  createdAt?: Date;
}

export type ICPProfileStatus = 'ACTIVE' | 'ARCHIVED';

export class ICPProfileInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ICPProfileInvariantError';
  }
}

export class ICPProfile extends AggregateRoot<ICPProfileId> {
  public readonly workspaceId: string;
  public readonly versionId: ICPProfileVersionId;
  public readonly versionNumber: number;
  public readonly name: string;
  public readonly hardFilters: ICPHardFilter;
  public readonly softCriteria: Array<{ criterion: string; weight: number }>;
  public readonly positiveSignals: string[];
  public readonly negativeSignals: string[];
  public readonly disqualifiers: string[];
  public readonly scoringWeights: ICPScoringWeights;
  public readonly qualificationThreshold: number;
  public readonly reviewThreshold: number;
  public readonly minimumConfidence: number;
  public status: ICPProfileStatus;
  public readonly createdAt: Date;

  private constructor(props: ICPProfileProps) {
    super(props.tenantId, props.id ?? asICPProfileId('icp-unknown'));
    this.workspaceId = props.workspaceId;
    this.versionId = props.versionId;
    this.versionNumber = props.version;
    this.name = props.name;
    this.hardFilters = props.hardFilters;
    this.softCriteria = props.softCriteria;
    this.positiveSignals = props.positiveSignals;
    this.negativeSignals = props.negativeSignals;
    this.disqualifiers = props.disqualifiers;
    this.scoringWeights = props.scoringWeights;
    this.qualificationThreshold = props.qualificationThreshold;
    this.reviewThreshold = props.reviewThreshold;
    this.minimumConfidence = props.minimumConfidence;
    this.status = props.status ?? 'ACTIVE';
    this.createdAt = props.createdAt ?? new Date();
  }

  private static validateProps(props: ICPProfileProps): ICPProfileInvariantError | null {
    if (!props.name || props.name.trim().length === 0) {
      return new ICPProfileInvariantError('ICP profile name is required');
    }
    if (props.qualificationThreshold < 0 || props.qualificationThreshold > 1) {
      return new ICPProfileInvariantError('qualificationThreshold must be between 0 and 1');
    }
    if (props.reviewThreshold < 0 || props.reviewThreshold > 1 || props.reviewThreshold > props.qualificationThreshold) {
      return new ICPProfileInvariantError('reviewThreshold must be between 0 and 1 and not exceed qualificationThreshold');
    }
    const totalWeight = Object.values(props.scoringWeights ?? {}).reduce((sum, w) => sum + w, 0);
    if (Math.abs(totalWeight - 1) > 0.001) {
      return new ICPProfileInvariantError('scoringWeights must sum to 1');
    }
    return ICPProfile.validateVersion(props.version);
  }

  private static validateVersion(version: number): ICPProfileInvariantError | null {
    if (!Number.isFinite(version) || !Number.isInteger(version) || version < 1) {
      return new ICPProfileInvariantError('version must be a positive integer >= 1');
    }
    return null;
  }

  static create(
    props: ICPProfileProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<ICPProfile, ICPProfileInvariantError> {
    const error = ICPProfile.validateProps(props);
    if (error) return fail(error);

    const profile = new ICPProfile(props);
    profile.applyEvent(
      new Events.ICPProfileCreated(eventId, props.tenantId, correlationId, {
        profileId: profile.id,
        versionId: profile.versionId,
        version: profile.versionNumber,
        name: profile.name,
      }),
    );
    return ok(profile);
  }

  createNextVersion(
    changes: Partial<Omit<ICPProfileProps, 'id' | 'tenantId' | 'workspaceId' | 'version' | 'versionId'>>,
    nextVersionId: ICPProfileVersionId,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<ICPProfile, ICPProfileInvariantError> {
    const nextVersion = this.versionNumber + 1;
    const nextProps: ICPProfileProps = {
      id: this.id,
      versionId: nextVersionId,
      version: nextVersion,
      tenantId: this.tenantId,
      workspaceId: this.workspaceId,
      name: changes.name ?? this.name,
      hardFilters: changes.hardFilters ?? this.hardFilters,
      softCriteria: changes.softCriteria ?? this.softCriteria,
      positiveSignals: changes.positiveSignals ?? this.positiveSignals,
      negativeSignals: changes.negativeSignals ?? this.negativeSignals,
      disqualifiers: changes.disqualifiers ?? this.disqualifiers,
      scoringWeights: changes.scoringWeights ?? this.scoringWeights,
      qualificationThreshold: changes.qualificationThreshold ?? this.qualificationThreshold,
      reviewThreshold: changes.reviewThreshold ?? this.reviewThreshold,
      minimumConfidence: changes.minimumConfidence ?? this.minimumConfidence,
    };

    const error = ICPProfile.validateProps(nextProps);
    if (error) return fail(error);

    const next = new ICPProfile(nextProps);
    next.applyEvent(
      new Events.ICPProfileVersionCreated(eventId, this.tenantId, correlationId, {
        profileId: next.id,
        versionId: next.versionId,
        version: next.versionNumber,
        previousVersionId: this.versionId,
        name: next.name,
      }),
    );
    return ok(next);
  }

  static reconstitute(props: ICPProfileProps, aggregateVersion: number): ICPProfile {
    const profile = new ICPProfile(props);
    profile.setVersion(aggregateVersion);
    profile.clearDomainEvents();
    return profile;
  }

  archive(correlationId: CorrelationId, eventId: EventId): void {
    this.status = 'ARCHIVED';
    this.applyEvent(
      new Events.ICPProfileUpdated(eventId, this.tenantId, correlationId, {
        profileId: this.id,
        versionId: this.versionId,
        version: this.versionNumber,
        name: this.name,
      }),
    );
  }
}
