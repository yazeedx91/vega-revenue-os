import type { TenantId } from '@projectx/shared';

export interface User {
  id: string;
  email: string;
  name: string | null;
  tenantId: TenantId;
  createdAt: Date;
}
