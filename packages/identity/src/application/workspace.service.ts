import { randomUUID } from 'crypto';
import type { TenantContext } from '@projectx/domain';
import { asTenantId, type TenantId } from '@projectx/shared';
import type { IAuditLog } from '@projectx/infrastructure';
import type { ITelemetry } from '@projectx/infrastructure';
import type { IdentityRepository } from '../ports/identity-repository.interface';
import type { Workspace } from '../domain/workspace';
import type { WorkspaceRole } from '../domain/roles';

export interface WorkspaceServiceConfig {
  repository: IdentityRepository;
  audit?: IAuditLog;
  telemetry?: ITelemetry;
}

export interface CreateWorkspaceCommand {
  name: string;
  ownerUserId: string;
}

export interface InviteMemberCommand {
  workspaceId: string;
  tenantId: TenantId;
  inviterUserId: string;
  inviteeEmail: string;
  role: WorkspaceRole;
}

export class WorkspaceService {
  constructor(private readonly config: WorkspaceServiceConfig) {}

  async createWorkspace(cmd: CreateWorkspaceCommand, correlationId?: string): Promise<Workspace | null> {
    const workspace = await this.config.repository.createWorkspace(cmd.name, cmd.ownerUserId);
    await this.audit(
      'workspace.create',
      'success',
      `owner=${cmd.ownerUserId}`,
      workspace.tenantId,
      cmd.ownerUserId,
      correlationId,
    );
    this.config.telemetry?.increment('workspace.create', 1, { tenantId: workspace.tenantId as string });
    return workspace;
  }

  async listWorkspaces(userId: string): Promise<Workspace[]> {
    return this.config.repository.listWorkspacesForUser(userId);
  }

  async inviteMember(cmd: InviteMemberCommand, correlationId?: string): Promise<{ userId: string } | null> {
    const existing = await this.config.repository.findUserByEmail(cmd.inviteeEmail);
    const userId = existing?.id ?? randomUUID();

    if (!existing) {
      await this.config.repository.upsertUser({
        id: userId,
        email: cmd.inviteeEmail,
        name: null,
      });
    }

    const added = await this.config.repository.addMember(
      cmd.workspaceId,
      cmd.tenantId,
      userId,
      cmd.role,
    );

    await this.audit(
      'workspace.invite',
      'success',
      `invitee=${userId};role=${added.role}`,
      cmd.tenantId,
      cmd.inviterUserId,
      correlationId,
    );

    this.config.telemetry?.increment('workspace.invite', 1, { tenantId: cmd.tenantId as string });
    return { userId };
  }

  async listMembers(workspaceId: string, tenantId: TenantId, _requesterUserId: string) {
    return this.config.repository.listMembers(workspaceId, tenantId);
  }

  private async audit(
    action: string,
    result: 'success' | 'denied' | 'failure',
    reason: string,
    tenantId: TenantId,
    actor: string,
    correlationId?: string,
  ): Promise<void> {
    if (!this.config.audit) return;
    const ctx: TenantContext = { tenantId, correlationId: correlationId ?? 'none' } as unknown as TenantContext;
    await this.config.audit.record(ctx, {
      action,
      resourceType: 'workspace',
      resourceId: tenantId as string,
      result,
      reason,
      metadata: { actor, correlationId },
    });
  }
}
