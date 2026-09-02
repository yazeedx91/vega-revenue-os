import type { TenantContext } from '@projectx/domain';
import type { IdempotencyKey } from '@projectx/shared';

export interface ICache {
  get<T>(ctx: TenantContext, key: string): Promise<T | null>;
  set<T>(ctx: TenantContext, key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(ctx: TenantContext, key: string): Promise<void>;
  exists(ctx: TenantContext, idempotencyKey: IdempotencyKey): Promise<boolean>;
}

export interface IRateLimiter {
  isAllowed(
    ctx: TenantContext,
    scope: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>;
}

export interface ILock {
  acquire(ctx: TenantContext, resourceId: string, ttlSeconds: number): Promise<LockToken | null>;
  release(ctx: TenantContext, resourceId: string, token: LockToken): Promise<void>;
}

export type LockToken = string & { readonly __brand: 'LockToken' };
