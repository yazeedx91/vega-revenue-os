import type { CampaignId, CorrelationId, EventId, LeadId, TenantId, UserId } from '@projectx/shared';
import { fail, ok, type Result } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import type { OutreachChannel } from './value-objects/provider-contracts';
import { assertProtectedRecipient, type RecipientProtectionState } from './value-objects/protected-recipient';
import type { SequenceStep } from './value-objects/sequence-step';
import * as Events from './campaign-events';
import { canTransitionCampaign, type CampaignStatus } from './campaign-status';

export interface CampaignBudget {
  readonly maxSendCount?: number;
  readonly maxCostUsd?: number;
}

export interface CampaignProps {
  id?: CampaignId;
  tenantId: TenantId;
  workspaceId: string;
  missionId?: string;
  leadId: LeadId;
  contactId: string;
  recipientFingerprint?: string;
  recipientProtectionState: RecipientProtectionState;
  channel: OutreachChannel;
  steps: SequenceStep[];
  budget?: CampaignBudget;
  status?: CampaignStatus;
  sentCount?: number;
  spentCostUsd?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export class CampaignInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignInvariantError';
  }
}

export class OutreachCampaign extends AggregateRoot<CampaignId> {
  public readonly workspaceId: string;
  public readonly missionId?: string;
  public readonly leadId: LeadId;
  public readonly contactId: string;
  public readonly recipientFingerprint?: string;
  public readonly recipientProtectionState: RecipientProtectionState;
  public readonly channel: OutreachChannel;
  public readonly steps: SequenceStep[];
  public readonly budget: CampaignBudget;
  public status: CampaignStatus;
  public sentCount: number;
  public spentCostUsd: number;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: CampaignProps) {
    super(props.tenantId, props.id!);
    this.workspaceId = props.workspaceId;
    this.missionId = props.missionId;
    this.leadId = props.leadId;
    this.contactId = props.contactId;
    this.recipientFingerprint = props.recipientFingerprint;
    this.recipientProtectionState = props.recipientProtectionState;
    this.channel = props.channel;
    this.steps = props.steps;
    this.budget = props.budget ?? {};
    this.status = props.status ?? 'DRAFT';
    this.sentCount = props.sentCount ?? 0;
    this.spentCostUsd = props.spentCostUsd ?? 0;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: CampaignProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): OutreachCampaign {
    if (!props.contactId || !props.channel) {
      throw new CampaignInvariantError('Contact and channel are required');
    }
    assertProtectedRecipient(props);
    if (props.steps.length === 0) {
      throw new CampaignInvariantError('Campaign must have at least one sequence step');
    }
    const campaign = new OutreachCampaign({ ...props, status: 'DRAFT' });
    campaign.applyEvent(
      new Events.OutreachCampaignCreated(eventId, props.tenantId, correlationId, {
        campaignId: campaign.id,
        missionId: props.missionId,
        leadId: props.leadId,
        channel: props.channel,
      }),
    );
    return campaign;
  }

  static reconstitute(snapshot: CampaignProps, version: number): OutreachCampaign {
    const campaign = new OutreachCampaign(snapshot);
    campaign.setVersion(version);
    campaign.clearDomainEvents();
    return campaign;
  }

  private transition(
    to: CampaignStatus,
    correlationId: CorrelationId,
    eventId: EventId,
    reason?: string,
    decidedBy?: UserId,
  ): Result<void, CampaignInvariantError> {
    if (!canTransitionCampaign(this.status, to)) {
      return fail(new CampaignInvariantError(`Cannot transition campaign from ${this.status} to ${to}`));
    }
    const from = this.status;
    this.status = to;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.OutreachCampaignStatusChanged(eventId, this.tenantId, correlationId, {
        campaignId: this.id,
        from,
        to,
        reason,
        decidedBy,
      }),
    );
    return ok(undefined);
  }

  submitForApproval(correlationId: CorrelationId, eventId: EventId): Result<void, CampaignInvariantError> {
    return this.transition('PENDING_APPROVAL', correlationId, eventId, 'Submitted for approval');
  }

  approve(decidedBy: UserId, reason: string, correlationId: CorrelationId, eventId: EventId): Result<void, CampaignInvariantError> {
    return this.transition('APPROVED', correlationId, eventId, reason, decidedBy);
  }

  reject(decidedBy: UserId, reason: string, correlationId: CorrelationId, eventId: EventId): Result<void, CampaignInvariantError> {
    return this.transition('CANCELLED', correlationId, eventId, `Rejected: ${reason}`, decidedBy);
  }

  start(correlationId: CorrelationId, eventId: EventId): Result<void, CampaignInvariantError> {
    return this.transition('RUNNING', correlationId, eventId, 'Campaign started');
  }

  pause(reason: string, correlationId: CorrelationId, eventId: EventId): Result<void, CampaignInvariantError> {
    return this.transition('PAUSED', correlationId, eventId, reason);
  }

  resume(correlationId: CorrelationId, eventId: EventId): Result<void, CampaignInvariantError> {
    return this.transition('RUNNING', correlationId, eventId, 'Campaign resumed');
  }

  complete(correlationId: CorrelationId, eventId: EventId): Result<void, CampaignInvariantError> {
    return this.transition('COMPLETED', correlationId, eventId, 'Campaign completed');
  }

  cancel(reason: string, correlationId: CorrelationId, eventId: EventId): Result<void, CampaignInvariantError> {
    return this.transition('CANCELLED', correlationId, eventId, reason);
  }

  recordSpend(sendCount: number, costUsd: number): boolean {
    if (this.budget.maxSendCount !== undefined && this.sentCount + sendCount > this.budget.maxSendCount) {
      return false;
    }
    if (this.budget.maxCostUsd !== undefined && this.spentCostUsd + costUsd > this.budget.maxCostUsd) {
      return false;
    }
    this.sentCount += sendCount;
    this.spentCostUsd += costUsd;
    return true;
  }
}
