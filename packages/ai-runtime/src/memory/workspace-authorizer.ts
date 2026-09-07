import type { TenantContext } from '@projectx/domain';

/**
 * Minimal trusted-membership port. Satisfied structurally by the identity
 * package's `IdentityRepository.isMember` — ai-runtime does not depend on the
 * identity package, so the port is declared here and bound at composition time.
 *
 * CRITICAL: workspace authorization is resolved ONLY from this trusted source.
 * Caller-supplied workspace ids or membership claims are NEVER trusted.
 */
export interface IWorkspaceMembership {
  isMember(workspaceId: string, tenantId: string, userId: string): Promise<boolean>;
}

export class WorkspaceAuthorizationError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly userId: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceAuthorizationError';
  }
}

/**
 * Authorizes access to workspace-scoped memory/knowledge using TRUSTED
 * membership only. A workspace-scoped read/write is permitted only when the
 * acting user is a verified member of that workspace; tenant-scoped (NULL
 * workspace) resources require no workspace check.
 */
export interface IWorkspaceAuthorizer {
  /**
   * Resolves the set of workspace ids the acting user may access. When the
   * caller supplies a workspaceId, it is validated against trusted membership;
   * an unauthorized workspaceId throws rather than silently widening scope.
   */
  authorize(ctx: TenantContext, requestedWorkspaceId?: string): Promise<WorkspaceScope>;
}

export interface WorkspaceScope {
  /** Workspace ids the user is a verified member of (empty = tenant scope only). */
  readonly allowedWorkspaceIds: readonly string[];
  /** True when the request is restricted to a single validated workspace. */
  readonly restrictedTo?: string;
}

export class TrustedWorkspaceAuthorizer implements IWorkspaceAuthorizer {
  constructor(private readonly membership: IWorkspaceMembership) {}

  async authorize(ctx: TenantContext, requestedWorkspaceId?: string): Promise<WorkspaceScope> {
    const userId = ctx.userId;
    if (!requestedWorkspaceId) {
      // Tenant-scoped request: no workspace restriction.
      return { allowedWorkspaceIds: [] };
    }
    if (!userId) {
      throw new WorkspaceAuthorizationError(
        requestedWorkspaceId,
        userId,
        `Workspace-scoped access to ${requestedWorkspaceId} requires an authenticated user`,
      );
    }
    const allowed = await this.membership.isMember(
      requestedWorkspaceId,
      String(ctx.tenantId),
      userId,
    );
    if (!allowed) {
      throw new WorkspaceAuthorizationError(
        requestedWorkspaceId,
        userId,
        `User ${userId} is not a member of workspace ${requestedWorkspaceId}`,
      );
    }
    return { allowedWorkspaceIds: [requestedWorkspaceId], restrictedTo: requestedWorkspaceId };
  }
}
