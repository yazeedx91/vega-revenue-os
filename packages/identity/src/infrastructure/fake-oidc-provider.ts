import { asTenantId } from '@projectx/shared';
import type { IdentityProvider, AuthenticatedUser } from '../ports/identity-provider.interface';

export interface FakeOidcProviderConfig {
  email: string;
  name: string;
  userId: string;
  tenantId: string;
  workspaceId: string;
  roles: string[];
  permissions: string[];
}

/**
 * E2E-only identity provider. It ignores the provided token and returns the
 * configured user. This must never be the production composition default.
 */
export class FakeOidcProvider implements IdentityProvider {
  constructor(private readonly config: FakeOidcProviderConfig) {}

  async validateToken(_token: string): Promise<AuthenticatedUser | null> {
    return {
      userId: this.config.userId,
      email: this.config.email,
      name: this.config.name,
      tenantId: asTenantId(this.config.tenantId),
      workspaceId: this.config.workspaceId,
      roles: this.config.roles,
      permissions: this.config.permissions,
    };
  }

  describe(): { issuer: string; type: string } {
    return { issuer: 'fake-oidc', type: 'FakeOidcProvider' };
  }
}
