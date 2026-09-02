import type { TenantContext } from '@projectx/domain';
import type { ISuppressionRepository, SuppressionRecord, SuppressionType } from '../ports/suppression-repository.interface';

export class InMemorySuppressionRepository implements ISuppressionRepository {
  private readonly store = new Map<string, SuppressionRecord>();

  private key(tenantId: string, address: string): string {
    return `${tenantId}:${address}`;
  }

  async isSuppressed(ctx: TenantContext, address: string): Promise<SuppressionRecord | null> {
    return this.store.get(this.key(ctx.tenantId as string, address)) ?? null;
  }

  async suppress(ctx: TenantContext, address: string, suppressionType: SuppressionType, source: string, reason?: string): Promise<void> {
    this.store.set(this.key(ctx.tenantId as string, address), {
      address,
      suppressionType,
      source,
      reason,
      createdAt: new Date(),
    });
  }

  async list(ctx: TenantContext): Promise<SuppressionRecord[]> {
    return [...this.store.entries()].filter(([key]) => key.startsWith(`${ctx.tenantId as string}:`)).map(([, record]) => record);
  }
}
