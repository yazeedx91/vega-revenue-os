import type { TenantContext } from '@projectx/domain';
import { TenantIsolationError } from '@projectx/shared';
import type { Agent, IAgentRepository } from '@projectx/domain';
import type { AgentId, TenantId } from '@projectx/shared';

export class InMemoryAgentRepository implements IAgentRepository {
  private readonly store = new Map<string, Agent>();

  async findById(ctx: TenantContext, id: AgentId): Promise<Agent | null> {
    const aggregate = this.store.get(this.key(ctx.tenantId, id));
    if (aggregate && aggregate.tenantId !== ctx.tenantId) {
      throw new TenantIsolationError('Cross-tenant access detected');
    }
    return aggregate ?? null;
  }

  async save(ctx: TenantContext, aggregate: Agent): Promise<void> {
    if (aggregate.tenantId !== ctx.tenantId) {
      throw new TenantIsolationError('Cross-tenant save detected');
    }
    this.store.set(this.key(ctx.tenantId, aggregate.id), aggregate);
  }

  private key(tenantId: TenantId, id: AgentId): string {
    return `${tenantId}:${id}`;
  }
}
