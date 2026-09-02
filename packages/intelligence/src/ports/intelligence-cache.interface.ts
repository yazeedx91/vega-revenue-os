import type { TenantContext } from '@projectx/domain';

export interface CacheEntry<T> {
  value: T;
  cachedAt: Date;
  expiresAt: Date;
  providerId: string;
  queryHash: string;
}

export interface IIntelligenceCache {
  get<T>(ctx: TenantContext, key: string): Promise<CacheEntry<T> | null>;
  set<T>(ctx: TenantContext, key: string, entry: CacheEntry<T>): Promise<void>;
  invalidate(ctx: TenantContext, pattern: string): Promise<void>;
}
