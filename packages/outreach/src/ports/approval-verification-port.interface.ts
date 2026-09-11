import type { TenantContext } from '@projectx/domain';
import type { CampaignId, CorrelationId, IdempotencyKey, OutreachExecutionId, SequenceId } from '@projectx/shared';

export interface ApprovalVerificationRequest {
  readonly approvalId: string;
  readonly campaignId: CampaignId;
  readonly sequenceId: SequenceId;
  readonly executionId: OutreachExecutionId;
  readonly idempotencyKey: IdempotencyKey;
  readonly recipientFingerprint: string;
  readonly actionType: string;
  readonly correlationId: CorrelationId;
}

export type ApprovalVerificationOutcome =
  | 'APPROVED'
  | 'NOT_FOUND'
  | 'WRONG_TENANT'
  | 'WRONG_TARGET'
  | 'EXPIRED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'PENDING'
  | 'INVALID_ACTION_TYPE';

export interface ApprovalVerificationResult {
  readonly outcome: ApprovalVerificationOutcome;
  readonly reason: string;
}

/**
 * Narrow port used ONLY by the outreach send-safety boundary to
 * independently re-verify that a specific outbound action currently has an
 * authoritative, valid approval. Never trust a workflow-level
 * "approvalGranted" flag — always call through this port immediately before
 * sending.
 *
 * This port intentionally does NOT expose the Approval aggregate (which
 * lives in `@projectx/mission-orchestrator`) to `@projectx/outreach`, to
 * preserve the existing package dependency direction
 * (mission-orchestrator -> outreach, never the reverse).
 */
export interface IApprovalVerificationPort {
  verify(ctx: TenantContext, request: ApprovalVerificationRequest): Promise<ApprovalVerificationResult>;
}
