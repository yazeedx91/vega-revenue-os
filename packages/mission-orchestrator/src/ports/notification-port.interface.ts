import type { TenantContext } from '@projectx/domain';
import type { Approval } from '../domain/approval/approval';

export interface INotificationPort {
  notifyApprovalRequested(ctx: TenantContext, approval: Approval): Promise<void>;
}
