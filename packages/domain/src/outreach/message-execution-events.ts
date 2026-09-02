import type { ApprovalId, CampaignId, CorrelationId, EventId, OutreachExecutionId, OutreachMessageId, SequenceId, TenantId } from '@projectx/shared';
import { DomainEvent } from '../events/domain-event';

export interface MessageExecutionCreatedPayload {
  executionId: OutreachExecutionId;
  campaignId: CampaignId;
  sequenceId: SequenceId;
  stepNumber: number;
  idempotencyKey: string;
}

export class MessageExecutionCreated extends DomainEvent<MessageExecutionCreatedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: MessageExecutionCreatedPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'MessageExecutionCreated', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export interface MessageExecutionDraftedPayload {
  executionId: OutreachExecutionId;
  campaignId: CampaignId;
  sequenceId: SequenceId;
  messageId: OutreachMessageId;
}

export class MessageExecutionDrafted extends DomainEvent<MessageExecutionDraftedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: MessageExecutionDraftedPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'MessageExecutionDrafted', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export interface MessageExecutionStatusChangedPayload {
  executionId: OutreachExecutionId;
  campaignId: CampaignId;
  sequenceId: SequenceId;
  from: string;
  to: string;
  reason?: string;
  providerMessageId?: string;
  providerErrorCode?: string;
}

export class MessageExecutionStatusChanged extends DomainEvent<MessageExecutionStatusChangedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: MessageExecutionStatusChangedPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'MessageExecutionStatusChanged', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export interface MessageExecutionResponseReceivedPayload {
  executionId: OutreachExecutionId;
  campaignId: CampaignId;
  sequenceId: SequenceId;
  responseType: 'OPENED' | 'REPLIED';
}

export class MessageExecutionResponseReceived extends DomainEvent<MessageExecutionResponseReceivedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: MessageExecutionResponseReceivedPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'MessageExecutionResponseReceived', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}
