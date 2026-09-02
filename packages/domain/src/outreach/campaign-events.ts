import type { CampaignId, CorrelationId, EventId, LeadId, TenantId, UserId } from '@projectx/shared';
import { DomainEvent } from '../events/domain-event';

export interface OutreachCampaignCreatedPayload {
  campaignId: CampaignId;
  missionId?: string;
  leadId: LeadId;
  channel: string;
}

export class OutreachCampaignCreated extends DomainEvent<OutreachCampaignCreatedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: OutreachCampaignCreatedPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'OutreachCampaignCreated', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export interface OutreachCampaignStatusChangedPayload {
  campaignId: CampaignId;
  from: string;
  to: string;
  reason?: string;
  decidedBy?: UserId;
}

export class OutreachCampaignStatusChanged extends DomainEvent<OutreachCampaignStatusChangedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: OutreachCampaignStatusChangedPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'OutreachCampaignStatusChanged', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export interface OutreachBudgetExceededPayload {
  campaignId: CampaignId;
  attemptedSends: number;
  attemptedCostUsd: number;
  sendCountLimit?: number;
  costLimitUsd?: number;
}

export class OutreachBudgetExceeded extends DomainEvent<OutreachBudgetExceededPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: OutreachBudgetExceededPayload,
    producer = 'outreach',
  ) {
    super(eventId, 'OutreachBudgetExceeded', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}
