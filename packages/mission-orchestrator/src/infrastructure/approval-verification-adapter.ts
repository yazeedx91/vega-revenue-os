import type { TenantContext } from '@projectx/domain';
import type {
  ApprovalVerificationRequest,
  ApprovalVerificationResult,
  IApprovalVerificationPort,
} from '@projectx/outreach';
import type { IApprovalRepository } from '../ports/approval-repository.interface';

/**
 * Concrete adapter implementing outreach's IApprovalVerificationPort using
 * the authoritative Approval aggregate + IApprovalRepository. Wired at the
 * application composition root (apps/temporal-worker) — outreach never
 * instantiates this directly and never imports the Approval aggregate.
 *
 * A workflow-level "approvalGranted" flag is never sufficient on its own:
 * this adapter re-reads the Approval aggregate from the repository and
 * independently checks tenant, target (campaign/sequence/execution/
 * recipient), status, expiry, and action type on every call.
 */
export class ApprovalVerificationAdapter implements IApprovalVerificationPort {
  constructor(private readonly approvalRepository: IApprovalRepository) {}

  async verify(ctx: TenantContext, request: ApprovalVerificationRequest): Promise<ApprovalVerificationResult> {
    const approval = await this.approvalRepository.load(ctx.tenantId, request.approvalId);

    if (!approval) {
      return { outcome: 'NOT_FOUND', reason: `Approval ${request.approvalId} not found` };
    }

    if (approval.tenantId !== ctx.tenantId) {
      return { outcome: 'WRONG_TENANT', reason: `Approval ${request.approvalId} belongs to a different tenant` };
    }

    if (approval.executionId !== undefined && approval.executionId !== (request.executionId as unknown as string)) {
      return {
        outcome: 'WRONG_TARGET',
        reason: `Approval ${request.approvalId} targets execution ${approval.executionId}, not ${request.executionId}`,
      };
    }

    if (approval.sequenceId !== undefined && approval.sequenceId !== (request.sequenceId as unknown as string)) {
      return {
        outcome: 'WRONG_TARGET',
        reason: `Approval ${request.approvalId} targets sequence ${approval.sequenceId}, not ${request.sequenceId}`,
      };
    }

    if (approval.idempotencyKey !== (request.idempotencyKey as unknown as string)) {
      return {
        outcome: 'WRONG_TARGET',
        reason: `Approval ${request.approvalId} idempotency key does not match execution`,
      };
    }

    if (approval.actionType !== request.actionType) {
      return {
        outcome: 'INVALID_ACTION_TYPE',
        reason: `Approval ${request.approvalId} was requested for actionType ${approval.actionType}, not ${request.actionType}`,
      };
    }

    if (approval.status === 'REJECTED') {
      return { outcome: 'REJECTED', reason: `Approval ${request.approvalId} was rejected: ${approval.decisionReason ?? 'no reason given'}` };
    }

    if (approval.status === 'ESCALATED' || approval.status === 'PENDING') {
      return { outcome: 'PENDING', reason: `Approval ${request.approvalId} is not yet decided (status: ${approval.status})` };
    }

    if (approval.status === 'EXPIRED') {
      return { outcome: 'EXPIRED', reason: `Approval ${request.approvalId} has expired` };
    }

    const expiresAtMs = approval.createdAt.getTime() + approval.timeoutSeconds * 1000;
    if (approval.status === 'APPROVED' && Date.now() > expiresAtMs) {
      return { outcome: 'EXPIRED', reason: `Approval ${request.approvalId} exceeded its timeout window and must be re-requested` };
    }

    if (approval.status !== 'APPROVED') {
      // Defensive fallback for any future ApprovalStatus value not
      // explicitly handled above (e.g. a future CANCELLED status).
      return { outcome: 'CANCELLED', reason: `Approval ${request.approvalId} is not in an approved state (status: ${approval.status})` };
    }

    return { outcome: 'APPROVED', reason: 'Approval is valid, current-tenant, target-matched, and unexpired' };
  }
}
