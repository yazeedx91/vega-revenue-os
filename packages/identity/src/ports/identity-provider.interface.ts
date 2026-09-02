import type { TenantId } from '@projectx/shared';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string | null;
  tenantId: TenantId;
  workspaceId: string;
  roles: string[];
  permissions: string[];
}

export interface IdentityProvider {
  /**
   * Validates an externally-issued OIDC token and returns an authoritative
   * tenant-scoped identity. No caller-supplied tenant ID is trusted.
   */
  validateToken(token: string): Promise<AuthenticatedUser | null>;
  /**
   * Returns the list of identity provider capabilities for telemetry/audit.
   */
  describe(): { issuer: string; type: string };
}
