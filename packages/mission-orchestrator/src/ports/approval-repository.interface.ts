import type { TenantContext } from '@projectx/domain';
import type { Approval } from '../domain/approval/approval';

export interface IApprovalRepository {
  load(ctx: TenantContext, approvalId: string): Promise<Approval | null>;
  save(ctx: TenantContext, approval: Approval): Promise<void>;
}
