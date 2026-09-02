import type { TenantContext } from '@projectx/domain';
import type { IRateLimiter } from '../cache/cache.interface';

/** Deterministic in-memory IRateLimiter test double — fixed-window counter per (tenant, scope, key). */
export class InMemoryRateLimiter implements IRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: Date }>();

  private key(ctx: TenantContext, scope: string, key: string): string {
    return `${ctx.tenantId as string}:${scope}:${key}`;
  }

  async isAllowed(
    ctx: TenantContext,
    scope: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const fullKey = this.key(ctx, scope, key);
    const now = new Date();
    let window = this.windows.get(fullKey);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: new Date(now.getTime() + windowSeconds * 1000) };
      this.windows.set(fullKey, window);
    }
    window.count += 1;
    const allowed = window.count <= limit;
    return { allowed, remaining: Math.max(0, limit - window.count), resetAt: window.resetAt };
  }

  clear(): void {
    this.windows.clear();
  }
}
