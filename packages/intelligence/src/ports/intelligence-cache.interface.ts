import type { TenantContext } from '@projectx/domain';

export interface CacheEntry<T> {
  value: T;
  cachedAt: Date;
  expiresAt: Date;
  providerId: string;
  queryHash: string;
}

export interface IntelligenceCacheContext extends TenantContext {
  readonly workspaceId: string;
}

export interface IIntelligenceCache {
  get<T>(ctx: IntelligenceCacheContext, queryHash: string): Promise<CacheEntry<T> | null>;
  set<T>(ctx: IntelligenceCacheContext, queryHash: string, entry: CacheEntry<T>): Promise<void>;
  invalidate(ctx: IntelligenceCacheContext, pattern: string): Promise<void>;
}
