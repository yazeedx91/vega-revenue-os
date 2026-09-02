import type { TenantId } from '@projectx/shared';

export interface Workspace {
  id: string;
  name: string;
  tenantId: TenantId;
  ownerUserId: string;
  createdAt: Date;
}
