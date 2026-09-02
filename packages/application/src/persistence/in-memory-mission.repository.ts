import type { TenantContext } from '@projectx/domain';
import { TenantIsolationError } from '@projectx/shared';
import type { Mission, IMissionRepository } from '@projectx/domain';
import type { MissionId, TenantId } from '@projectx/shared';

export class InMemoryMissionRepository implements IMissionRepository {
  private readonly store = new Map<string, Mission>();

  async findById(ctx: TenantContext, id: MissionId): Promise<Mission | null> {
    const aggregate = this.store.get(this.key(ctx.tenantId, id));
    if (aggregate && aggregate.tenantId !== ctx.tenantId) {
      throw new TenantIsolationError('Cross-tenant access detected');
    }
    return aggregate ?? null;
  }

  async save(ctx: TenantContext, aggregate: Mission): Promise<void> {
    if (aggregate.tenantId !== ctx.tenantId) {
      throw new TenantIsolationError('Cross-tenant save detected');
    }
    this.store.set(this.key(ctx.tenantId, aggregate.id), aggregate);
  }

  private key(tenantId: TenantId, id: MissionId): string {
    return `${tenantId}:${id}`;
  }
}
