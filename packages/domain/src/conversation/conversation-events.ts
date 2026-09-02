import type { ConversationId, CorrelationId, EventId, LeadId, ReplyMessageId, TenantId } from '@projectx/shared';
import { DomainEvent } from '../events/domain-event';
import type { ReplyIntent } from './intent-classification';
import type { NextActionType } from './next-best-action';

export interface ConversationStartedPayload {
  conversationId: ConversationId;
  leadId: LeadId;
  channel: string;
  executionId?: string;
}

export class ConversationStarted extends DomainEvent<ConversationStartedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: ConversationStartedPayload,
  ) {
    super(eventId, 'ConversationStarted', '1', new Date(), tenantId, correlationId, 'conversation', payload);
  }
}

export interface ReplyReceivedPayload {
  conversationId: ConversationId;
  replyMessageId: ReplyMessageId;
  providerMessageId: string;
  channel: string;
  snippet: string;
}

export class ReplyReceived extends DomainEvent<ReplyReceivedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: ReplyReceivedPayload,
  ) {
    super(eventId, 'ReplyReceived', '1', new Date(), tenantId, correlationId, 'conversation', payload);
  }
}

export interface IntentClassifiedPayload {
  conversationId: ConversationId;
  intent: ReplyIntent;
  confidence: number;
  reason: string;
}

export class IntentClassified extends DomainEvent<IntentClassifiedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: IntentClassifiedPayload,
  ) {
    super(eventId, 'IntentClassified', '1', new Date(), tenantId, correlationId, 'conversation', payload);
  }
}

export interface ConversationEscalatedPayload {
  conversationId: ConversationId;
  reason: string;
}

export class ConversationEscalated extends DomainEvent<ConversationEscalatedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: ConversationEscalatedPayload,
  ) {
    super(eventId, 'ConversationEscalated', '1', new Date(), tenantId, correlationId, 'conversation', payload);
  }
}

export interface FollowUpScheduledPayload {
  conversationId: ConversationId;
  actionType: NextActionType;
  reason: string;
}

export class FollowUpScheduled extends DomainEvent<FollowUpScheduledPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: FollowUpScheduledPayload,
  ) {
    super(eventId, 'FollowUpScheduled', '1', new Date(), tenantId, correlationId, 'conversation', payload);
  }
}

export interface ConversationClosedPayload {
  conversationId: ConversationId;
  disposition: 'QUALIFIED' | 'DISQUALIFIED' | 'OPTED_OUT' | 'NO_ACTION';
  reason: string;
}

export class ConversationClosed extends DomainEvent<ConversationClosedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: ConversationClosedPayload,
  ) {
    super(eventId, 'ConversationClosed', '1', new Date(), tenantId, correlationId, 'conversation', payload);
  }
}

export interface OptOutRecordedPayload {
  conversationId: ConversationId;
  leadId: LeadId;
  channel: string;
}

export class OptOutRecorded extends DomainEvent<OptOutRecordedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: OptOutRecordedPayload,
  ) {
    super(eventId, 'OptOutRecorded', '1', new Date(), tenantId, correlationId, 'conversation', payload);
  }
}
