import type { TenantContext } from '@projectx/domain';
import { asTenantId, type TenantId } from '@projectx/shared';
import type { IAuditLog } from '@projectx/infrastructure';
import type { ITelemetry } from '@projectx/infrastructure';
import type { IdentityProvider } from '../ports/identity-provider.interface';
import type { TokenIssuer } from '../ports/token-issuer.interface';
import type { IdentityRepository } from '../ports/identity-repository.interface';
import type { User } from '../domain/user';
import type { Workspace } from '../domain/workspace';
import { permissionsForRole, type WorkspaceRole } from '../domain/roles';

export interface AuthServiceConfig {
  identityProvider: IdentityProvider;
  tokenIssuer: TokenIssuer;
  repository: IdentityRepository;
  audit?: IAuditLog;
  telemetry?: ITelemetry;
}

export interface AuthResult {
  user: User;
  workspace: Workspace;
  accessToken: string;
  refreshToken?: string;
}

export interface MeResult {
  userId: string;
  email: string;
  name: string | null;
  tenantId: TenantId;
  workspaceId: string;
  roles: string[];
  permissions: string[];
}

export class AuthService {
  constructor(private readonly config: AuthServiceConfig) {}

  async authenticate(oidcToken: string, correlationId?: string): Promise<AuthResult | null> {
    const provider = this.config.identityProvider;
    const identity = await provider.validateToken(oidcToken);
    if (!identity) {
      await this.audit('auth.authenticate', 'denied', 'oidc_token_invalid', undefined, correlationId);
      return null;
    }

    let workspace: Workspace;
    const user = await this.config.repository.upsertUser({
      id: identity.userId,
      email: identity.email,
      name: identity.name,
    });

    if (identity.workspaceId) {
      // Provider already resolved a workspace (E2E fake or pre-baked token).
      const found = await this.config.repository.findWorkspaceById(
        identity.workspaceId,
        asTenantId(identity.tenantId as string),
      );
      if (!found) {
        await this.audit('auth.authenticate', 'denied', 'workspace_not_found', identity.userId, correlationId);
        return null;
      }
      workspace = found;
    } else {
      // Production Entra path: user has no workspace claim; resolve from database.
      const workspaces = await this.config.repository.listWorkspacesForUser(user.id);
      if (workspaces.length === 0) {
        workspace = await this.config.repository.createWorkspace(
          `${identity.email.split('@')[0]}'s workspace`,
          user.id,
        );
      } else {
        workspace = workspaces[0];
      }
    }

    const membership = (await this.config.repository.listMembers(workspace.id, workspace.tenantId)).members.find(
      (m) => m.userId === identity.userId,
    );
    const role: WorkspaceRole = (membership?.role ?? 'MEMBER') as WorkspaceRole;
    const permissions = permissionsForRole(role);

    const tenantId = workspace.tenantId;
    const authUser: User = {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId,
      createdAt: user.createdAt,
    };

    const accessToken = await this.config.tokenIssuer.issue({
      userId: authUser.id,
      email: authUser.email,
      name: authUser.name,
      tenantId,
      workspaceId: workspace.id,
      roles: [role],
      permissions,
    });

    await this.audit(
      'auth.authenticate',
      'success',
      `provider=${provider.describe().type};workspace=${workspace.id}`,
      authUser.id,
      correlationId,
      tenantId,
    );

    this.config.telemetry?.increment('auth.authenticate.success', 1, {
      tenantId: tenantId as string,
      provider: provider.describe().type,
    });

    return { user: authUser, workspace, accessToken };
  }

  async me(accessToken: string): Promise<MeResult | null> {
    const identity = await this.config.tokenIssuer.verify(accessToken);
    if (!identity) {
      await this.audit('auth.me', 'denied', 'access_token_invalid', undefined);
      return null;
    }
    return {
      userId: identity.userId,
      email: identity.email,
      name: identity.name,
      tenantId: identity.tenantId,
      workspaceId: identity.workspaceId,
      roles: identity.roles,
      permissions: identity.permissions,
    };
  }

  private async audit(
    action: string,
    result: 'success' | 'denied' | 'failure',
    reason: string,
    actor?: string,
    correlationId?: string,
    tenantId?: TenantId,
  ): Promise<void> {
    if (!this.config.audit) return;
    const ctx: TenantContext = {
      tenantId: tenantId ?? (actor ? asTenantId(actor) : asTenantId('system')),
      correlationId: correlationId ?? 'none',
    };
    await this.config.audit.record(ctx, {
      action,
      resourceType: 'identity',
      resourceId: actor ?? 'anonymous',
      result,
      reason,
      metadata: { actor, correlationId },
    });
  }
}
