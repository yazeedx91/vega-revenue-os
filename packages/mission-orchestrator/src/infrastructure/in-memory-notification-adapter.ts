import type { TenantContext } from '@projectx/domain';
import type { Approval } from '../domain/approval/approval';
import type { INotificationPort } from '../ports/notification-port.interface';

export class InMemoryNotificationAdapter implements INotificationPort {
  readonly requests: Array<{ ctx: TenantContext; approval: Approval }> = [];

  async notifyApprovalRequested(ctx: TenantContext, approval: Approval): Promise<void> {
    this.requests.push({ ctx, approval });
  }

  clear(): void {
    this.requests.length = 0;
  }
}
