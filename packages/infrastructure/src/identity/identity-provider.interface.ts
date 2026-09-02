import type { TenantId } from '@projectx/shared';

export interface IIdentityProvider {
  validateToken(token: string): Promise<AuthenticatedUser | null>;
  isMemberOfTenant(userId: string, tenantId: TenantId): Promise<boolean>;
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: TenantId;
  roles: string[];
  permissions: string[];
}
