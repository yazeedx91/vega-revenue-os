import type { ApprovalId, CampaignId, CorrelationId, EventId, IdempotencyKey, OutreachExecutionId, OutreachMessageId, SequenceId, TenantId } from '@projectx/shared';
import { asOutreachExecutionId, fail, ok, type Result } from '@projectx/shared';
import { randomUUID } from 'crypto';
import { AggregateRoot } from '../aggregate/aggregate-root';
import type { MessageDraft } from './value-objects/message-draft';
import type { OutreachChannel } from './value-objects/provider-contracts';
import * as Events from './message-execution-events';
import { canTransitionMessageExecution, type MessageExecutionStatus } from './message-execution-status';

export interface MessageExecutionProps {
  id?: OutreachExecutionId;
  tenantId: TenantId;
  campaignId: CampaignId;
  sequenceId: SequenceId;
  stepNumber: number;
  leadId: string;
  recipientAddress: string;
  channel: OutreachChannel;
  idempotencyKey: IdempotencyKey;
  messageId?: OutreachMessageId;
  draft?: MessageDraft;
  status?: MessageExecutionStatus;
  approvalId?: ApprovalId;
  providerId?: string;
  providerMessageId?: string;
  internetMessageId?: string;
  attempts?: number;
  lastError?: string;
  retryClassification?: 'RETRYABLE' | 'NON_RETRYABLE' | 'RATE_LIMITED';
  retryAfterMs?: number;
  providerErrorCode?: string;
  providerAcceptedAt?: Date;
  deliveredAt?: Date;
  deliveryFailedAt?: Date;
  failedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export class MessageExecutionInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageExecutionInvariantError';
  }
}

export class OutreachMessageExecution extends AggregateRoot<OutreachExecutionId> {
  public readonly campaignId: CampaignId;
  public readonly sequenceId: SequenceId;
  public readonly stepNumber: number;
  public readonly leadId: string;
  public readonly recipientAddress: string;
  public readonly channel: OutreachChannel;
  public readonly idempotencyKey: IdempotencyKey;
  public status: MessageExecutionStatus;
  public messageId?: OutreachMessageId;
  public draft?: MessageDraft;
  public approvalId?: ApprovalId;
  public providerId?: string;
  public providerMessageId?: string;
  public internetMessageId?: string;
  public attempts = 0;
  public lastError?: string;
  public retryClassification?: 'RETRYABLE' | 'NON_RETRYABLE' | 'RATE_LIMITED';
  public retryAfterMs?: number;
  public providerErrorCode?: string;
  public providerAcceptedAt?: Date;
  public deliveredAt?: Date;
  public deliveryFailedAt?: Date;
  public failedAt?: Date;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: MessageExecutionProps) {
    super(props.tenantId, props.id!);
    this.campaignId = props.campaignId;
    this.sequenceId = props.sequenceId;
    this.stepNumber = props.stepNumber;
    this.leadId = props.leadId;
    this.recipientAddress = props.recipientAddress;
    this.channel = props.channel;
    this.idempotencyKey = props.idempotencyKey;
    this.status = props.status ?? 'PENDING';
    this.messageId = props.messageId;
    this.draft = props.draft;
    this.approvalId = props.approvalId;
    this.providerId = props.providerId;
    this.providerMessageId = props.providerMessageId;
    this.internetMessageId = props.internetMessageId;
    this.attempts = props.attempts ?? 0;
    this.lastError = props.lastError;
    this.retryClassification = props.retryClassification;
    this.retryAfterMs = props.retryAfterMs;
    this.providerErrorCode = props.providerErrorCode;
    this.providerAcceptedAt = props.providerAcceptedAt;
    this.deliveredAt = props.deliveredAt;
    this.deliveryFailedAt = props.deliveryFailedAt;
    this.failedAt = props.failedAt;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: MessageExecutionProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): OutreachMessageExecution {
    const id = props.id ?? asOutreachExecutionId(randomUUID());
    const execution = new OutreachMessageExecution({ ...props, id, status: 'PENDING' });
    execution.applyEvent(
      new Events.MessageExecutionCreated(eventId, props.tenantId, correlationId, {
        executionId: execution.id,
        campaignId: props.campaignId,
        sequenceId: props.sequenceId,
        stepNumber: props.stepNumber,
        idempotencyKey: props.idempotencyKey as string,
      }),
    );
    return execution;
  }

  static reconstitute(snapshot: MessageExecutionProps, version: number): OutreachMessageExecution {
    const execution = new OutreachMessageExecution(snapshot);
    execution.setVersion(version);
    execution.clearDomainEvents();
    return execution;
  }

  private transition(
    to: MessageExecutionStatus,
    correlationId: CorrelationId,
    eventId: EventId,
    reason?: string,
  ): Result<void, MessageExecutionInvariantError> {
    if (!canTransitionMessageExecution(this.status, to)) {
      return fail(new MessageExecutionInvariantError(`Cannot transition message execution from ${this.status} to ${to}`));
    }
    const from = this.status;
    this.status = to;
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.MessageExecutionStatusChanged(eventId, this.tenantId, correlationId, {
        executionId: this.id,
        campaignId: this.campaignId,
        sequenceId: this.sequenceId,
        from,
        to,
        reason,
        providerMessageId: this.providerMessageId,
      }),
    );
    return ok(undefined);
  }

  startDrafting(correlationId: CorrelationId, eventId: EventId): Result<void, MessageExecutionInvariantError> {
    return this.transition('DRAFTING', correlationId, eventId, 'Drafting started');
  }

  setDraft(
    messageId: OutreachMessageId,
    draft: MessageDraft,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MessageExecutionInvariantError> {
    if (this.status !== 'DRAFTING' && this.status !== 'PENDING') {
      return fail(new MessageExecutionInvariantError('Draft can only be set while PENDING or DRAFTING'));
    }
    this.messageId = messageId;
    this.draft = draft;
    return this.transition('PENDING_APPROVAL', correlationId, eventId, 'Draft created and awaiting approval');
  }

  approve(approvalId: ApprovalId, correlationId: CorrelationId, eventId: EventId): Result<void, MessageExecutionInvariantError> {
    if (this.status !== 'PENDING_APPROVAL') {
      return fail(new MessageExecutionInvariantError('Only PENDING_APPROVAL executions can be approved'));
    }
    this.approvalId = approvalId;
    return this.transition('APPROVED', correlationId, eventId, `Approved via ${approvalId}`);
  }

  reject(reason: string, correlationId: CorrelationId, eventId: EventId): Result<void, MessageExecutionInvariantError> {
    if (this.status !== 'PENDING_APPROVAL') {
      return fail(new MessageExecutionInvariantError('Only PENDING_APPROVAL executions can be rejected'));
    }
    this.lastError = reason;
    return this.transition('FAILED', correlationId, eventId, `Rejected: ${reason}`);
  }

  markSending(correlationId: CorrelationId, eventId: EventId): Result<void, MessageExecutionInvariantError> {
    return this.transition('SENDING', correlationId, eventId, 'Sending to provider');
  }

  markProviderAttempt(providerId: string): void {
    if (this.status !== 'SENDING') {
      throw new MessageExecutionInvariantError('Can only record provider attempt while SENDING');
    }
    this.providerId = providerId;
    this.attempts += 1;
    this.updatedAt = new Date();
  }

  markProviderAccepted(
    providerMessageId: string | undefined,
    internetMessageId: string | undefined,
    providerErrorCode: string | undefined,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MessageExecutionInvariantError> {
    this.providerMessageId = providerMessageId;
    this.internetMessageId = internetMessageId;
    this.providerErrorCode = providerErrorCode;
    this.providerAcceptedAt = new Date();
    return this.transition('PROVIDER_ACCEPTED', correlationId, eventId, `Provider accepted: ${providerMessageId ?? 'no message id'}`);
  }

  markDeliveryPending(correlationId: CorrelationId, eventId: EventId): Result<void, MessageExecutionInvariantError> {
    return this.transition('DELIVERY_PENDING', correlationId, eventId, 'Awaiting delivery confirmation');
  }

  markDelivered(
    internetMessageId: string | undefined,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MessageExecutionInvariantError> {
    if (internetMessageId) {
      this.internetMessageId = internetMessageId;
    }
    this.deliveredAt = new Date();
    return this.transition('DELIVERED', correlationId, eventId, 'Message delivered');
  }

  markOpened(correlationId: CorrelationId, eventId: EventId): Result<void, MessageExecutionInvariantError> {
    return this.transition('OPENED', correlationId, eventId, 'Message opened');
  }

  markReplied(correlationId: CorrelationId, eventId: EventId): Result<void, MessageExecutionInvariantError> {
    return this.transition('REPLIED', correlationId, eventId, 'Recipient replied');
  }

  markBounced(reason: string, correlationId: CorrelationId, eventId: EventId): Result<void, MessageExecutionInvariantError> {
    this.lastError = reason;
    return this.transition('BOUNCED', correlationId, eventId, `Bounced: ${reason}`);
  }

  markFailed(
    classification: 'RETRYABLE' | 'NON_RETRYABLE' | 'RATE_LIMITED',
    reason: string,
    providerErrorCode: string | undefined,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MessageExecutionInvariantError> {
    this.retryClassification = classification;
    this.lastError = reason;
    this.providerErrorCode = providerErrorCode;
    this.failedAt = new Date();

    const preSubmission = this.status === 'SENDING' || this.status === 'APPROVED';

    if (classification === 'RETRYABLE' || classification === 'RATE_LIMITED') {
      if (preSubmission) {
        // Do not transition out of SENDING/APPROVED; a retry will re-attempt
        // from the same state after the retry backoff.
        this.updatedAt = new Date();
        return ok(undefined);
      }
      // Post-acceptance retryable failures should not be blindly retried.
      return this.transition('REQUIRES_RECONCILIATION', correlationId, eventId, `Post-acceptance retryable failure: ${reason}`);
    }

    if (preSubmission) {
      return this.transition('FAILED_PRE_SUBMISSION', correlationId, eventId, `Failed before submission: ${reason}`);
    }

    if (this.status === 'PROVIDER_ACCEPTED' || this.status === 'DELIVERY_PENDING' || this.status === 'DELIVERED' || this.status === 'OPENED') {
      this.deliveryFailedAt = new Date();
      return this.transition('DELIVERY_FAILED', correlationId, eventId, `Delivery failed: ${reason}`);
    }

    return this.transition('FAILED', correlationId, eventId, `Failed: ${reason}`);
  }

  markDeliveryUnknown(
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MessageExecutionInvariantError> {
    this.lastError = reason;
    return this.transition('DELIVERY_UNKNOWN', correlationId, eventId, `Delivery outcome unknown: ${reason}`);
  }

  markRequiresReconciliation(
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MessageExecutionInvariantError> {
    this.lastError = reason;
    return this.transition('REQUIRES_RECONCILIATION', correlationId, eventId, `Requires reconciliation: ${reason}`);
  }

  markReconciledDelivered(
    internetMessageId: string | undefined,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MessageExecutionInvariantError> {
    if (internetMessageId) {
      this.internetMessageId = internetMessageId;
      this.providerMessageId = internetMessageId;
    }
    const from = this.status;
    this.status = 'DELIVERED';
    this.deliveredAt = new Date();
    this.updatedAt = new Date();
    this.applyEvent(
      new Events.MessageExecutionStatusChanged(eventId, this.tenantId, correlationId, {
        executionId: this.id,
        campaignId: this.campaignId,
        sequenceId: this.sequenceId,
        from,
        to: 'DELIVERED',
        reason: 'Operator reconciled as delivered',
        providerMessageId: this.providerMessageId,
      }),
    );
    return ok(undefined);
  }

  markReconciledFailed(
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, MessageExecutionInvariantError> {
    const from = this.status;
    this.lastError = reason;
    this.failedAt = new Date();
    this.updatedAt = new Date();
    this.status = 'FAILED';
    this.applyEvent(
      new Events.MessageExecutionStatusChanged(eventId, this.tenantId, correlationId, {
        executionId: this.id,
        campaignId: this.campaignId,
        sequenceId: this.sequenceId,
        from,
        to: 'FAILED',
        reason: `Operator reconciled as failed: ${reason}`,
        providerMessageId: this.providerMessageId,
      }),
    );
    return ok(undefined);
  }

  cancel(reason: string, correlationId: CorrelationId, eventId: EventId): Result<void, MessageExecutionInvariantError> {
    return this.transition('CANCELLED', correlationId, eventId, `Cancelled: ${reason}`);
  }

  recordRetryAfter(ms: number): void {
    this.retryAfterMs = ms;
  }
}
