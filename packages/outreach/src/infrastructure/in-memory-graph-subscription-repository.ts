import type { TenantContext } from '@projectx/domain';
import type {
  CreateGraphSubscriptionRecord,
  GraphSubscriptionRecord,
  IGraphSubscriptionRepository,
} from '../ports/graph-subscription-repository.interface';

export class InMemoryGraphSubscriptionRepository implements IGraphSubscriptionRepository {
  private readonly records = new Map<string, GraphSubscriptionRecord>();

  private key(tenantId: string, subscriptionId: string): string {
    return `${tenantId}:${subscriptionId}`;
  }

  async save(ctx: TenantContext, record: CreateGraphSubscriptionRecord): Promise<void> {
    const now = new Date();
    this.records.set(this.key(record.tenantId, record.subscriptionId), {
      ...record,
      createdAt: now,
      updatedAt: now,
    });
  }

  async findByTenant(ctx: TenantContext): Promise<GraphSubscriptionRecord[]> {
    const tenantId = ctx.tenantId as string;
    return Array.from(this.records.values())
      .filter((record) => record.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findBySubscriptionId(ctx: TenantContext, subscriptionId: string): Promise<GraphSubscriptionRecord | null> {
    return this.records.get(this.key(ctx.tenantId as string, subscriptionId)) ?? null;
  }

  async delete(ctx: TenantContext, subscriptionId: string): Promise<void> {
    this.records.delete(this.key(ctx.tenantId as string, subscriptionId));
  }
}
