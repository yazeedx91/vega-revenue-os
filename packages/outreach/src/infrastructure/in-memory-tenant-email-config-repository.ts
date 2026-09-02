import type { TenantContext } from '@projectx/domain';
import type { ITenantEmailConfigRepository, TenantEmailConfig } from '../ports/tenant-email-config-repository.interface';

export class InMemoryTenantEmailConfigRepository implements ITenantEmailConfigRepository {
  private readonly store = new Map<string, TenantEmailConfig>();

  private key(tenantId: string, providerId: string): string {
    return `${tenantId}::${providerId}`;
  }

  /** Test/seed helper — not part of the port. */
  seed(config: TenantEmailConfig): void {
    this.store.set(this.key(config.tenantId, config.providerId), config);
  }

  async get(ctx: TenantContext, providerId: string): Promise<TenantEmailConfig | null> {
    return this.store.get(this.key(ctx.tenantId as string, providerId)) ?? null;
  }

  async findByMailboxAddress(fromAddress: string): Promise<TenantEmailConfig | null> {
    const normalized = fromAddress.toLowerCase();
    for (const config of this.store.values()) {
      if (config.fromAddress.toLowerCase() === normalized) {
        return config;
      }
    }
    return null;
  }
}
