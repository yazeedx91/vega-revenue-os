import type { CampaignId, CorrelationId, EventId, LeadId, OutreachExecutionId, SequenceId, TenantId, UserId } from '@projectx/shared';
import { DomainEvent } from '../events/domain-event';

export interface OutreachSequenceCreatedPayload {
  sequenceId: SequenceId;
  campaignId: CampaignId;
  leadId: LeadId;
  stepCount: number;
}

export class OutreachSequenceCreated extends DomainEvent<OutreachSequenceCreatedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: OutreachSequenceCreatedPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'OutreachSequenceCreated', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export interface OutreachSequenceStatusChangedPayload {
  sequenceId: SequenceId;
  campaignId: CampaignId;
  from: string;
  to: string;
  reason?: string;
  decidedBy?: UserId;
}

export class OutreachSequenceStatusChanged extends DomainEvent<OutreachSequenceStatusChangedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: OutreachSequenceStatusChangedPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'OutreachSequenceStatusChanged', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export interface OutreachSequenceStepStartedPayload {
  sequenceId: SequenceId;
  campaignId: CampaignId;
  stepNumber: number;
  executionId: OutreachExecutionId;
}

export class OutreachSequenceStepStarted extends DomainEvent<OutreachSequenceStepStartedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: OutreachSequenceStepStartedPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'OutreachSequenceStepStarted', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export interface OutreachSequenceStepCompletedPayload {
  sequenceId: SequenceId;
  campaignId: CampaignId;
  stepNumber: number;
  executionId: OutreachExecutionId;
  nextStepNumber?: number;
  nextDueAt?: Date;
}

export class OutreachSequenceStepCompleted extends DomainEvent<OutreachSequenceStepCompletedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: OutreachSequenceStepCompletedPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'OutreachSequenceStepCompleted', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export interface OutreachSequenceStepFailedPayload {
  sequenceId: SequenceId;
  campaignId: CampaignId;
  stepNumber: number;
  executionId: OutreachExecutionId;
  reason: string;
  retryable: boolean;
}

export class OutreachSequenceStepFailed extends DomainEvent<OutreachSequenceStepFailedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: OutreachSequenceStepFailedPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'OutreachSequenceStepFailed', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export interface SequenceWorkflowLinkedPayload {
  sequenceId: SequenceId;
  workflowId: string;
}

export class SequenceWorkflowLinked extends DomainEvent<SequenceWorkflowLinkedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: SequenceWorkflowLinkedPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'SequenceWorkflowLinked', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}
