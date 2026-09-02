import type { TenantId } from '@projectx/shared';
import type { Approval } from '../domain/approval/approval';
import type { IApprovalRepository } from '../ports/approval-repository.interface';

export class InMemoryApprovalRepository implements IApprovalRepository {
  private readonly approvals = new Map<string, Approval>();

  async load(tenantId: TenantId, approvalId: string): Promise<Approval | null> {
    const key = `${tenantId}:${approvalId}`;
    return this.approvals.get(key) ?? null;
  }

  async save(approval: Approval): Promise<void> {
    const key = `${approval.tenantId}:${approval.id}`;
    this.approvals.set(key, approval);
  }
}
