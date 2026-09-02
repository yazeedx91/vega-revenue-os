import type { CorrelationId, EventId, TenantId, UserId } from '@projectx/shared';
import { DomainEvent } from '@projectx/domain';
import type { ApprovalId } from '@projectx/domain';
import type { ApprovalStatus } from './approval-status';

export interface ApprovalRequestedPayload {
  approvalId: ApprovalId;
  missionId: string;
  sequenceId?: string;
  taskId?: string;
  executionId?: string;
  actionType: string;
  riskCategory: string;
  proposedAction: unknown;
  evidence: unknown[];
  reasoning: string;
  confidence: number;
  requestedBy: string;
  approverRole: string;
  timeoutSeconds: number;
}

export class ApprovalRequested extends DomainEvent<ApprovalRequestedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: ApprovalRequestedPayload,
    producer = 'mission-orchestrator',
  ) {
    super(eventId, 'ApprovalRequested', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}

export interface ApprovalStatusChangedPayload {
  approvalId: ApprovalId;
  missionId: string;
  sequenceId?: string;
  status: ApprovalStatus;
  decidedBy?: UserId;
  decisionReason?: string;
}

export class ApprovalStatusChanged extends DomainEvent<ApprovalStatusChangedPayload> {
  constructor(
    eventId: EventId,
    tenantId: TenantId,
    correlationId: CorrelationId,
    payload: ApprovalStatusChangedPayload,
    producer = 'mission-orchestrator',
  ) {
    super(eventId, 'ApprovalStatusChanged', '1', new Date(), tenantId, correlationId, producer, payload);
  }
}
