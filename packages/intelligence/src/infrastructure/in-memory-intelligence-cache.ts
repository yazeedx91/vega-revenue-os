import type { CacheEntry, IntelligenceCacheContext, IIntelligenceCache } from '../ports/intelligence-cache.interface';

export class InMemoryIntelligenceCache implements IIntelligenceCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  private key(ctx: IntelligenceCacheContext, key: string): string {
    return `${ctx.tenantId}:${key}:${ctx.workspaceId}`;
  }

  async get<T>(ctx: IntelligenceCacheContext, key: string): Promise<CacheEntry<T> | null> {
    const entry = this.store.get(this.key(ctx, key)) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (new Date().getTime() > entry.expiresAt.getTime()) {
      this.store.delete(this.key(ctx, key));
      return null;
    }
    return entry;
  }

  async set<T>(ctx: IntelligenceCacheContext, key: string, entry: CacheEntry<T>): Promise<void> {
    this.store.set(this.key(ctx, key), entry as CacheEntry<unknown>);
  }

  async invalidate(ctx: IntelligenceCacheContext, pattern: string): Promise<void> {
    const prefix = this.key(ctx, pattern);
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}
