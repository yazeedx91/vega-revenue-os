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
    if (!ctx.userId) {
      throw new MissionWorkspaceResolutionError('Authenticated user is required to resolve mission workspace');
    }

    const result = await this.client.withTenant(ctx, (client: PoolClient) => client.query(
      `SELECT DISTINCT ip.workspace_id
       FROM mission.missions m
       JOIN intelligence.icp_profiles ip
         ON ip.tenant_id = m.tenant_id AND ip.icp_profile_id = m.icp_id
       JOIN identity.workspaces w
         ON w.tenant_id = ip.tenant_id AND w.id = ip.workspace_id
       JOIN identity.memberships membership
         ON membership.tenant_id = w.tenant_id
        AND membership.workspace_id = w.id
        AND membership.user_id = $3::UUID
       WHERE m.tenant_id = $1 AND m.id = $2::UUID`,
      [ctx.tenantId, missionId, ctx.userId],
    ));

    if (result.rows.length !== 1) {
      throw new MissionWorkspaceResolutionError(
        `Mission ${missionId} did not resolve to exactly one authorized workspace`,
      );
    }
    return result.rows[0].workspace_id as string;
  }
}
