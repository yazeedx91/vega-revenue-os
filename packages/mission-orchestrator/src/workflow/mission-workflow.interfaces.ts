import type { CorrelationId, TenantId } from '@projectx/shared';

export interface MissionWorkflowInput {
  tenantId: TenantId;
  missionId: string;
  correlationId: CorrelationId;
}

export interface MissionWorkflowStatus {
  missionId: string;
  status: string;
  currentTaskId?: string;
  waitingForApproval?: boolean;
}

export interface ApprovalDecisionSignal {
  approvalId: string;
  decision: 'APPROVED' | 'REJECTED' | 'EXPIRED';
  reason: string;
}

export interface MissionControlSignal {
  action: 'PAUSE' | 'RESUME' | 'CANCEL';
  reason?: string;
}
