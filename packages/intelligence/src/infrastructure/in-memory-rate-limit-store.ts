import type { TenantContext } from '@projectx/domain';
import type { IRateLimitStore, RateLimitInfo } from '../ports/rate-limit.interface';

export class InMemoryRateLimitStore implements IRateLimitStore {
  private readonly usage = new Map<string, number>();
  private readonly quota = new Map<string, number>();

  setQuota(tenantId: string, providerId: string, quota: number): void {
    this.quota.set(`${tenantId}:${providerId}`, quota);
  }

  async check(ctx: TenantContext, providerId: string, _cost: number): Promise<RateLimitInfo> {
    const key = `${ctx.tenantId}:${providerId}`;
    const used = this.usage.get(key) ?? 0;
    const limit = this.quota.get(key) ?? Number.MAX_SAFE_INTEGER;
    const allowed = used < limit;
    return {
      allowed,
      remaining: Math.max(0, limit - used),
      retryAfterMs: allowed ? undefined : 60_000,
    };
  }

  async recordUsage(ctx: TenantContext, providerId: string, cost: number): Promise<void> {
    const key = `${ctx.tenantId}:${providerId}`;
    this.usage.set(key, (this.usage.get(key) ?? 0) + cost);
  }
}
