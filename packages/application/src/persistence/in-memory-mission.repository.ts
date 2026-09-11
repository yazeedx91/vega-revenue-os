import type { TenantContext } from '@projectx/domain';
import { TenantIsolationError } from '@projectx/shared';
import type { Mission, IMissionRepository } from '@projectx/domain';
import type { MissionId, TenantId } from '@projectx/shared';

export class InMemoryMissionRepository implements IMissionRepository {
  private readonly store = new Map<string, Mission>();

  async findById(ctx: TenantContext, id: MissionId): Promise<Mission | null> {
    if (!ctx.workspaceId) return null;
    const aggregate = this.store.get(this.key(ctx.tenantId, ctx.workspaceId, id));
    if (aggregate && aggregate.tenantId !== ctx.tenantId) {
      throw new TenantIsolationError('Cross-tenant access detected');
    }
    return aggregate ?? null;
  }

  async save(ctx: TenantContext, aggregate: Mission): Promise<void> {
    if (aggregate.tenantId !== ctx.tenantId) {
      throw new TenantIsolationError('Cross-tenant save detected');
    }
    if (!ctx.workspaceId || aggregate.workspaceId !== ctx.workspaceId || aggregate.workspaceBindingState !== 'WORKSPACE_BOUND') {
      throw new TenantIsolationError('Cross-workspace save detected');
    }
    this.store.set(this.key(ctx.tenantId, ctx.workspaceId, aggregate.id), aggregate);
  }

  private key(tenantId: TenantId, workspaceId: string, id: MissionId): string {
    return `${tenantId}:${workspaceId}:${id}`;
  }
}
