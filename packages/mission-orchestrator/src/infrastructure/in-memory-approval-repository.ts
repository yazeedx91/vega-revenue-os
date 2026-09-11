import type { TenantContext } from '@projectx/domain';
import type { Approval } from '../domain/approval/approval';
import type { IApprovalRepository } from '../ports/approval-repository.interface';

export class InMemoryApprovalRepository implements IApprovalRepository {
  private readonly approvals = new Map<string, Approval>();

  async load(ctx: TenantContext, approvalId: string): Promise<Approval | null> {
    if (!ctx.workspaceId) return null;
    return this.approvals.get(`${ctx.tenantId}:${ctx.workspaceId}:${approvalId}`) ?? null;
  }

  async save(ctx: TenantContext, approval: Approval): Promise<void> {
    if (!ctx.workspaceId || approval.tenantId !== ctx.tenantId || approval.workspaceId !== ctx.workspaceId || approval.workspaceBindingState !== 'WORKSPACE_BOUND') {
      throw new Error('Approval workspace ownership mismatch');
    }
    this.approvals.set(`${approval.tenantId}:${approval.workspaceId}:${approval.id}`, approval);
  }
}
