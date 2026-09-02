import type { TenantId } from '@projectx/shared';
import type { Approval } from '../domain/approval/approval';

export interface IApprovalRepository {
  load(tenantId: TenantId, approvalId: string): Promise<Approval | null>;
  save(approval: Approval): Promise<void>;
}
