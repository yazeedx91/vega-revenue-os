import { type EventId, type CorrelationId, type TenantId, type ICPProfileId, asICPProfileId, ok, fail, type Result } from '@projectx/shared';
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
  tenantId: TenantId;
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
  createdAt?: Date;
  updatedAt?: Date;
}

export type ICPProfileStatus = 'ACTIVE' | 'ARCHIVED';

export class ICPProfileInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ICPProfileInvariantError';
  }
}

export class ICPProfile extends AggregateRoot<ICPProfileId> {
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
  public updatedAt: Date;

  private constructor(props: ICPProfileProps) {
    super(props.tenantId, props.id ?? asICPProfileId('icp-unknown'));
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
    this.status = 'ACTIVE';
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: ICPProfileProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<ICPProfile, ICPProfileInvariantError> {
    if (!props.name || props.name.trim().length === 0) {
      return fail(new ICPProfileInvariantError('ICP profile name is required'));
    }
    if (props.qualificationThreshold < 0 || props.qualificationThreshold > 1) {
      return fail(new ICPProfileInvariantError('qualificationThreshold must be between 0 and 1'));
    }
    if (props.reviewThreshold < 0 || props.reviewThreshold > 1 || props.reviewThreshold > props.qualificationThreshold) {
      return fail(new ICPProfileInvariantError('reviewThreshold must be between 0 and 1 and not exceed qualificationThreshold'));
    }
    const totalWeight = Object.values(props.scoringWeights ?? {}).reduce((sum, w) => sum + w, 0);
    if (Math.abs(totalWeight - 1) > 0.001) {
      return fail(new ICPProfileInvariantError('scoringWeights must sum to 1'));
    }

    const profile = new ICPProfile(props);
    profile.applyEvent(
      new Events.ICPProfileCreated(eventId, props.tenantId, correlationId, {
        profileId: profile.id,
        name: profile.name,
      }),
    );
    return ok(profile);
  }

  update(
    changes: Partial<Omit<ICPProfileProps, 'id' | 'tenantId'>>,
    correlationId: CorrelationId,
    eventId: EventId,
  ): void {
    Object.assign(this, changes);
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ICPProfileUpdated(eventId, this.tenantId, correlationId, {
        profileId: this.id,
        name: this.name,
      }),
    );
  }

  archive(correlationId: CorrelationId, eventId: EventId): void {
    this.status = 'ARCHIVED';
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.ICPProfileUpdated(eventId, this.tenantId, correlationId, {
        profileId: this.id,
        name: this.name,
      }),
    );
  }
}
