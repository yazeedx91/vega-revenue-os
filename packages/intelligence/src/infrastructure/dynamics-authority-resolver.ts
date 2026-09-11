import type { TenantContext } from '@projectx/domain';

export interface DynamicsAuthority {
  tenantId: string;
  workspaceId: string;
  organizationUrl: string;
  entraTenantId: string;
  clientIdSecretReference: string;
  clientSecretReference: string;
}

export interface IDynamicsAuthorityResolver { resolve(ctx: TenantContext): Promise<DynamicsAuthority | null>; }

export class StaticWorkspaceDynamicsAuthorityResolver implements IDynamicsAuthorityResolver {
  private readonly values = new Map<string, DynamicsAuthority>();
  constructor(authorities: DynamicsAuthority[]) {
    for (const authority of authorities) {
      const url = new URL(authority.organizationUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Dynamics authority URL is invalid');
      this.values.set(`${authority.tenantId}:${authority.workspaceId}`, { ...authority, organizationUrl: url.origin });
    }
  }
  async resolve(ctx: TenantContext): Promise<DynamicsAuthority | null> {
    if (!ctx.workspaceId) return null;
    return this.values.get(`${ctx.tenantId}:${ctx.workspaceId}`) ?? null;
  }
}
