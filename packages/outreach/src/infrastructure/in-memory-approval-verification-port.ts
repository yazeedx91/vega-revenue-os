import type { TenantContext } from '@projectx/domain';
import type {
  ApprovalVerificationOutcome,
  ApprovalVerificationRequest,
  ApprovalVerificationResult,
  IApprovalVerificationPort,
} from '../ports/approval-verification-port.interface';

export interface FakeApprovalRecord {
  readonly approvalId: string;
  readonly tenantId: string;
  readonly campaignId: string;
  readonly sequenceId: string;
  readonly executionId: string;
  readonly recipientAddress: string;
  readonly actionType: string;
  readonly outcome: ApprovalVerificationOutcome;
}

/**
 * Deterministic test double for IApprovalVerificationPort, used only in
 * `packages/outreach` unit tests. The real adapter (wrapping the Approval
 * aggregate) lives in `packages/mission-orchestrator`.
 */
export class InMemoryApprovalVerificationPort implements IApprovalVerificationPort {
  private readonly records = new Map<string, FakeApprovalRecord>();

  seed(record: FakeApprovalRecord): void {
    this.records.set(record.approvalId, record);
  }

  async verify(ctx: TenantContext, request: ApprovalVerificationRequest): Promise<ApprovalVerificationResult> {
    const record = this.records.get(request.approvalId);
    if (!record) {
      return { outcome: 'NOT_FOUND', reason: `Approval ${request.approvalId} not found` };
    }
    if (record.outcome !== 'APPROVED') {
      return { outcome: record.outcome, reason: `Seeded outcome: ${record.outcome}` };
    }
    if (record.tenantId !== (ctx.tenantId as string)) {
      return { outcome: 'WRONG_TENANT', reason: 'Tenant mismatch' };
    }
    if (
      record.campaignId !== (request.campaignId as string) ||
      record.sequenceId !== (request.sequenceId as string) ||
      record.executionId !== (request.executionId as string) ||
      record.recipientAddress !== request.recipientAddress
    ) {
      return { outcome: 'WRONG_TARGET', reason: 'Target mismatch' };
    }
    if (record.actionType !== request.actionType) {
      return { outcome: 'INVALID_ACTION_TYPE', reason: 'Action type mismatch' };
    }
    return { outcome: 'APPROVED', reason: 'Approved' };
  }
}
