import type { ConversationId, CorrelationId, EventId, LeadId, ReplyMessageId, TenantId } from '@projectx/shared';
import { fail, ok, type Result } from '@projectx/shared';
import { AggregateRoot } from '../aggregate/aggregate-root';
import { InvalidStateTransitionError } from '../errors/domain-errors';
import type { DomainEvent } from '../events/domain-event';
import * as Events from './conversation-events';
import { canTransitionConversation, type ConversationStatus } from './conversation-status';
import type { IntentClassification, ReplyIntent } from './intent-classification';
import type { NextBestAction, NextActionType } from './next-best-action';
import { ReplyMessage } from './reply-message';

export interface ConversationProps {
  readonly id: ConversationId;
  readonly tenantId: TenantId;
  readonly workspaceId: string;
  readonly leadId: LeadId;
  readonly channel: string;
  readonly recipientAddress?: string;
  readonly campaignId?: string;
  readonly sequenceId?: string;
  readonly executionId?: string;
  readonly status?: ConversationStatus;
  readonly messages?: ReplyMessage[];
  readonly latestIntent?: ReplyIntent;
  readonly latestConfidence?: number;
  readonly nextAction?: NextActionType;
  readonly escalatedReason?: string;
  readonly optedOut?: boolean;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export class Conversation extends AggregateRoot<ConversationId> {
  public readonly workspaceId: string;
  public readonly leadId: LeadId;
  public readonly channel: string;
  public readonly recipientAddress?: string;
  public readonly campaignId?: string;
  public readonly sequenceId?: string;
  public readonly executionId?: string;
  public readonly createdAt: Date;
  public updatedAt: Date;
  private _status: ConversationStatus;
  private readonly _messages: ReplyMessage[] = [];
  private _latestIntent?: ReplyIntent;
  private _latestConfidence?: number;
  private _nextAction?: NextActionType;
  private _escalatedReason?: string;
  private _optedOut = false;

  get status(): ConversationStatus {
    return this._status;
  }

  get messages(): readonly ReplyMessage[] {
    return this._messages;
  }

  get latestIntent(): ReplyIntent | undefined {
    return this._latestIntent;
  }

  get latestConfidence(): number | undefined {
    return this._latestConfidence;
  }

  get nextAction(): NextActionType | undefined {
    return this._nextAction;
  }

  get escalatedReason(): string | undefined {
    return this._escalatedReason;
  }

  get optedOut(): boolean {
    return this._optedOut;
  }

  private constructor(props: ConversationProps) {
    super(props.tenantId, props.id);
    this.workspaceId = props.workspaceId;
    this.leadId = props.leadId;
    this.channel = props.channel;
    this.recipientAddress = props.recipientAddress;
    this.campaignId = props.campaignId;
    this.sequenceId = props.sequenceId;
    this.executionId = props.executionId;
    this._status = props.status ?? 'PENDING';
    this._messages.push(...(props.messages ?? []));
    this._latestIntent = props.latestIntent;
    this._latestConfidence = props.latestConfidence;
    this._nextAction = props.nextAction;
    this._escalatedReason = props.escalatedReason;
    this._optedOut = props.optedOut ?? false;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  static create(
    props: ConversationProps,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Conversation {
    const conversation = new Conversation(props);
    conversation.applyEvent(
      new Events.ConversationStarted(eventId, props.tenantId, correlationId, {
        conversationId: props.id,
        leadId: props.leadId,
        channel: props.channel,
        executionId: props.executionId,
      }),
    );
    return conversation;
  }

  static reconstitute(snapshot: ConversationProps, version: number): Conversation {
    const conversation = new Conversation(snapshot);
    conversation.setVersion(version);
    conversation.clearDomainEvents();
    return conversation;
  }

  recordReply(
    reply: ReplyMessage,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, InvalidStateTransitionError> {
    if (this._optedOut) {
      return fail(new InvalidStateTransitionError('Cannot record reply: conversation has opted out'));
    }

    if (reply.content.toLowerCase().includes('unsubscribe') || reply.content.toLowerCase().includes('opt out')) {
      this.transitionTo('OPTED_OUT', correlationId, () =>
        new Events.OptOutRecorded(eventId, this.tenantId, correlationId, {
          conversationId: this.id,
          leadId: this.leadId,
          channel: this.channel,
        }),
      );
      this._optedOut = true;
      this._messages.push(reply);
      this.updatedAt = new Date();
      return ok(undefined);
    }

    const targetStatus: ConversationStatus = this._status === 'PENDING' ? 'CLASSIFIED' : 'CLASSIFIED';
    const transition = this.transitionTo(targetStatus, correlationId, () =>
      new Events.ReplyReceived(eventId, this.tenantId, correlationId, {
        conversationId: this.id,
        replyMessageId: reply.id,
        providerMessageId: reply.providerMessageId,
        channel: reply.channel,
        snippet: reply.content.slice(0, 200),
      }),
    );
    if (!transition.success) {
      return transition;
    }

    this._messages.push(reply);
    this.updatedAt = new Date();
    return ok(undefined);
  }

  classifyIntent(
    classification: IntentClassification,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, InvalidStateTransitionError> {
    if (this._status === 'OPTED_OUT' || this._status === 'DISQUALIFIED') {
      return fail(new InvalidStateTransitionError(`Cannot classify intent: conversation is ${this._status}`));
    }

    const targetStatus: ConversationStatus = this._status === 'AWAITING_REPLY' ? 'CLASSIFIED' : 'CLASSIFIED';
    const transition = this.transitionTo(targetStatus, correlationId, () =>
      new Events.IntentClassified(eventId, this.tenantId, correlationId, {
        conversationId: this.id,
        intent: classification.intent,
        confidence: classification.confidence,
        reason: classification.reason,
      }),
    );
    if (!transition.success) {
      return transition;
    }

    this._latestIntent = classification.intent;
    this._latestConfidence = classification.confidence;
    this.updatedAt = new Date();
    return ok(undefined);
  }

  decideAction(
    action: NextBestAction,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, InvalidStateTransitionError> {
    if (this._optedOut) {
      return fail(new InvalidStateTransitionError('Cannot decide action: conversation has opted out'));
    }

    let targetStatus: ConversationStatus;
    switch (action.actionType) {
      case 'FOLLOW_UP':
        targetStatus = 'FOLLOW_UP_SCHEDULED';
        break;
      case 'ESCALATE':
        targetStatus = 'ESCALATED';
        this._escalatedReason = action.reason;
        break;
      case 'DISQUALIFY':
        targetStatus = 'DISQUALIFIED';
        break;
      case 'CLOSE':
        targetStatus = 'CLOSED';
        break;
      case 'SCHEDULE_MEETING_DEFERRED':
        targetStatus = 'FOLLOW_UP_SCHEDULED';
        break;
      default:
        targetStatus = 'ESCALATED';
    }

    const transition = this.transitionTo(targetStatus, correlationId, () =>
      new Events.FollowUpScheduled(eventId, this.tenantId, correlationId, {
        conversationId: this.id,
        actionType: action.actionType,
        reason: action.reason,
      }),
    );
    if (!transition.success) {
      return transition;
    }

    this._nextAction = action.actionType;
    this.updatedAt = new Date();
    return ok(undefined);
  }

  close(
    disposition: 'QUALIFIED' | 'DISQUALIFIED' | 'OPTED_OUT' | 'NO_ACTION',
    reason: string,
    correlationId: CorrelationId,
    eventId: EventId,
  ): Result<void, InvalidStateTransitionError> {
    const transition = this.transitionTo('CLOSED', correlationId, () =>
      new Events.ConversationClosed(eventId, this.tenantId, correlationId, {
        conversationId: this.id,
        disposition,
        reason,
      }),
    );
    if (!transition.success) {
      return transition;
    }
    this.updatedAt = new Date();
    return ok(undefined);
  }

  private transitionTo(
    to: ConversationStatus,
    _correlationId: CorrelationId,
    eventFactory: () => DomainEvent<unknown>,
  ): Result<void, InvalidStateTransitionError> {
    if (!canTransitionConversation(this._status, to)) {
      return fail(new InvalidStateTransitionError(`Cannot transition conversation from ${this._status} to ${to}`));
    }
    this._status = to;
    this.applyEvent(eventFactory() as unknown as DomainEvent<unknown>);
    return ok(undefined);
  }
}
