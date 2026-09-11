import type { Pool, PoolClient } from 'pg';
import type { TenantContext } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';
import { MissionWorkspaceResolutionError, type IMissionWorkspaceResolver } from '../ports/mission-workspace-resolver.interface';

export class PostgresMissionWorkspaceResolver implements IMissionWorkspaceResolver {
  private readonly client: PostgresClient;

  constructor(pool: Pool) {
    this.client = new PostgresClient(pool);
  }

  async resolveAuthorizedWorkspace(ctx: TenantContext, missionId: string): Promise<string> {
    if (!ctx.userId || !ctx.workspaceId) {
      throw new MissionWorkspaceResolutionError('Authenticated user and workspace are required to resolve mission workspace');
    }

    const result = await this.client.withTenant(ctx, (client: PoolClient) => client.query(
      `SELECT m.workspace_id
       FROM mission.missions m
       JOIN identity.memberships membership
         ON membership.tenant_id = m.tenant_id
        AND membership.workspace_id = m.workspace_id
        AND membership.user_id = $3::UUID
       WHERE m.tenant_id = $1
         AND m.id = $2::UUID
         AND m.workspace_id = $4::UUID
         AND m.workspace_binding_state = 'WORKSPACE_BOUND'`,
      [ctx.tenantId, missionId, ctx.userId, ctx.workspaceId],
    ));

    if (result.rows.length !== 1) {
      throw new MissionWorkspaceResolutionError(
        `Mission ${missionId} did not resolve to exactly one authorized workspace`,
      );
    }
    return result.rows[0].workspace_id as string;
  }
}
