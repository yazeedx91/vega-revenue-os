import type { CampaignId, CorrelationId, EventId, LeadId, OutreachExecutionId, SequenceId, TenantId, UserId } from '@projectx/shared';
import { fail, ok, type Result } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import { assertProtectedRecipientSnapshot, type RecipientProtectionState } from './value-objects/protected-recipient';
import type { SequenceStep } from './value-objects/sequence-step';
import * as Events from './sequence-events';
import { canTransitionSequence, type SequenceStatus } from './sequence-status';

export interface SequenceProps {
  id?: SequenceId;
  tenantId: TenantId;
  workspaceId: string;
  campaignId: CampaignId;
  leadId: LeadId;
  contactId: string;
  recipientFingerprint?: string;
  recipientCiphertext?: string;
  recipientProtectionState: RecipientProtectionState;
  campaignRecipientFingerprint?: string;
  steps: SequenceStep[];
  status?: SequenceStatus;
  currentStepIndex?: number;
  nextDueAt?: Date;
  responseDeadlineAt?: Date;
  workflowId?: string;
  workflowStartedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export class SequenceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SequenceInvariantError';
  }
}

export class OutreachSequence extends AggregateRoot<SequenceId> {
  public readonly workspaceId: string;
  public readonly campaignId: CampaignId;
  public readonly leadId: LeadId;
  public readonly contactId: string;
  public readonly recipientFingerprint?: string;
  public readonly recipientCiphertext?: string;
  public readonly recipientProtectionState: RecipientProtectionState;
  public readonly steps: SequenceStep[];
  public status: SequenceStatus;
  public currentStepIndex: number;
  public nextDueAt?: Date;
  public responseDeadlineAt?: Date;
  public workflowId?: string;
  public workflowStartedAt?: Date;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: SequenceProps) {
    super(props.tenantId, props.id!);
    this.workspaceId = props.workspaceId;
    this.campaignId = props.campaignId;
    this.leadId = props.leadId;
    this.contactId = props.contactId;
    this.recipientFingerprint = props.recipientFingerprint;
    this.recipientCiphertext = props.recipientCiphertext;
    this.recipientProtectionState = props.recipientProtectionState;
    this.steps = props.steps;
    this.status = props.status ?? 'DRAFT';
    this.currentStepIndex = props.currentStepIndex ?? 0;
    this.nextDueAt = props.nextDueAt;
    this.responseDeadlineAt = props.responseDeadlineAt;
    this.workflowId = props.workflowId;
    this.workflowStartedAt = props.workflowStartedAt;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: SequenceProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): OutreachSequence {
    if (!props.contactId) throw new SequenceInvariantError('Contact is required');
    assertProtectedRecipientSnapshot(props);
    if (props.campaignRecipientFingerprint !== undefined && props.campaignRecipientFingerprint !== props.recipientFingerprint) {
      throw new SequenceInvariantError('Campaign and Sequence recipient fingerprints must match');
    }
    if (props.steps.length === 0) {
      throw new SequenceInvariantError('Sequence must have at least one step');
    }
    const sequence = new OutreachSequence({ ...props, status: 'DRAFT' });
    sequence.applyEvent(
      new Events.OutreachSequenceCreated(eventId, props.tenantId, correlationId, {
        sequenceId: sequence.id,
        campaignId: props.campaignId,
        leadId: props.leadId,
        stepCount: props.steps.length,
      }),
    );
    return sequence;
  }

  static reconstitute(snapshot: SequenceProps, version: number): OutreachSequence {
    const sequence = new OutreachSequence(snapshot);
    sequence.setVersion(version);
    sequence.clearDomainEvents();
    return sequence;
  }

  private transition(
    to: SequenceStatus,
    correlationId: CorrelationId,
    eventId: EventId,
    reason?: string,
    decidedBy?: UserId,
  ): Result<void, SequenceInvariantError> {
    if (!canTransitionSequence(this.status, to)) {
      return fail(new SequenceInvariantError(`Cannot transition sequence from ${this.status} to ${to}`));
    }
    const from = this.status;
    this.status = to;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.OutreachSequenceStatusChanged(eventId, this.tenantId, correlationId, {
        sequenceId: this.id,
        campaignId: this.campaignId,
        from,
        to,
        reason,
        decidedBy,
      }),
    );
    return ok(undefined);
  }

  submitForApproval(correlationId: CorrelationId, eventId: EventId): Result<void, SequenceInvariantError> {
    return this.transition('PENDING_APPROVAL', correlationId, eventId, 'Submitted for approval');
  }

  approve(decidedBy: UserId, reason: string, correlationId: CorrelationId, eventId: EventId): Result<void, SequenceInvariantError> {
    return this.transition('APPROVED', correlationId, eventId, reason, decidedBy);
  }

  reject(decidedBy: UserId, reason: string, correlationId: CorrelationId, eventId: EventId): Result<void, SequenceInvariantError> {
    return this.transition('CANCELLED', correlationId, eventId, `Rejected: ${reason}`, decidedBy);
  }

  start(correlationId: CorrelationId, eventId: EventId): Result<void, SequenceInvariantError> {
    return this.transition('RUNNING', correlationId, eventId, 'Sequence started');
  }

  startStep(
    executionId: OutreachExecutionId,
    scheduledAt: Date,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, SequenceInvariantError> {
    if (this.status !== 'RUNNING') {
      return fail(new SequenceInvariantError('Sequence must be RUNNING to start a step'));
    }
    if (this.currentStepIndex >= this.steps.length) {
      return fail(new SequenceInvariantError('No more steps to start'));
    }
    if (this.nextDueAt && scheduledAt.getTime() < this.nextDueAt.getTime()) {
      return fail(new SequenceInvariantError('Step cannot start before scheduled time'));
    }
    const step = this.steps[this.currentStepIndex];
    this.applyEvent(
      new Events.OutreachSequenceStepStarted(eventId, this.tenantId, correlationId, {
        sequenceId: this.id,
        campaignId: this.campaignId,
        stepNumber: step.stepNumber,
        executionId,
      }),
    );
    return ok(undefined);
  }

  completeStep(
    executionId: OutreachExecutionId,
    nextDueAt: Date | undefined,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, SequenceInvariantError> {
    if (this.status !== 'RUNNING') {
      return fail(new SequenceInvariantError('Sequence must be RUNNING to complete a step'));
    }
    const step = this.steps[this.currentStepIndex];
    this.currentStepIndex += 1;
    const hasMoreSteps = this.currentStepIndex < this.steps.length;
    this.nextDueAt = nextDueAt;
    this.applyEvent(
      new Events.OutreachSequenceStepCompleted(eventId, this.tenantId, correlationId, {
        sequenceId: this.id,
        campaignId: this.campaignId,
        stepNumber: step.stepNumber,
        executionId,
        nextStepNumber: hasMoreSteps ? this.steps[this.currentStepIndex].stepNumber : undefined,
        nextDueAt,
      }),
    );
    if (!hasMoreSteps) {
      return this.transition('COMPLETED', correlationId, eventId, 'All steps completed');
    }
    return ok(undefined);
  }

  failStep(
    executionId: OutreachExecutionId,
    reason: string,
    retryable: boolean,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, SequenceInvariantError> {
    if (this.status !== 'RUNNING') {
      return fail(new SequenceInvariantError('Sequence must be RUNNING to fail a step'));
    }
    const step = this.steps[this.currentStepIndex];
    this.applyEvent(
      new Events.OutreachSequenceStepFailed(eventId, this.tenantId, correlationId, {
        sequenceId: this.id,
        campaignId: this.campaignId,
        stepNumber: step.stepNumber,
        executionId,
        reason,
        retryable,
      }),
    );
    if (!retryable) {
      return this.transition('FAILED', correlationId, eventId, reason);
    }
    return ok(undefined);
  }

  pause(reason: string, correlationId: CorrelationId, eventId: EventId): Result<void, SequenceInvariantError> {
    return this.transition('PAUSED', correlationId, eventId, reason);
  }

  resume(correlationId: CorrelationId, eventId: EventId): Result<void, SequenceInvariantError> {
    return this.transition('RUNNING', correlationId, eventId, 'Sequence resumed');
  }

  waitForResponse(deadline: Date, correlationId: CorrelationId, eventId: EventId): Result<void, SequenceInvariantError> {
    if (this.status !== 'RUNNING') {
      return fail(new SequenceInvariantError('Sequence must be RUNNING to wait for response'));
    }
    this.responseDeadlineAt = deadline;
    return this.transition('WAITING', correlationId, eventId, 'Awaiting recipient response');
  }

  continueAfterResponse(correlationId: CorrelationId, eventId: EventId): Result<void, SequenceInvariantError> {
    this.responseDeadlineAt = undefined;
    return this.transition('RUNNING', correlationId, eventId, 'Response received or timeout');
  }

  linkWorkflow(workflowId: string, correlationId: CorrelationId, eventId: EventId): Result<void, SequenceInvariantError> {
    if (this.workflowId && this.workflowId !== workflowId) {
      return fail(new SequenceInvariantError(`Sequence already linked to workflow ${this.workflowId}`));
    }
    this.workflowId = workflowId;
    this.workflowStartedAt = new Date();
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.SequenceWorkflowLinked(eventId, this.tenantId, correlationId, {
        sequenceId: this.id,
        workflowId,
      }),
    );
    return ok(undefined);
  }

  cancel(reason: string, correlationId: CorrelationId, eventId: EventId): Result<void, SequenceInvariantError> {
    return this.transition('CANCELLED', correlationId, eventId, reason);
  }
}
