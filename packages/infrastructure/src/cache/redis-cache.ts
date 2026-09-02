import type { RedisClientType } from 'redis';
import type { TenantContext } from '@projectx/domain';
import type { IdempotencyKey } from '@projectx/shared';
import type { ICache, IRateLimiter } from './cache.interface';

export interface RedisCacheConfig {
  client: RedisClientType;
}

export class RedisCache implements ICache {
  constructor(private readonly client: RedisClientType) {}

  private key(ctx: TenantContext, key: string): string {
    return `tenant:${ctx.tenantId as string}:cache:${key}`;
  }

  async get<T>(ctx: TenantContext, key: string): Promise<T | null> {
    try {
      const value = await this.client.get(this.key(ctx, key));
      if (value === null) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    } catch (err) {
      // Cache is not authoritative; a miss is safe.
      return null;
    }
  }

  async set<T>(ctx: TenantContext, key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    const fullKey = this.key(ctx, key);
    try {
      if (ttlSeconds) {
        await this.client.set(fullKey, serialized, { EX: ttlSeconds });
      } else {
        await this.client.set(fullKey, serialized);
      }
    } catch (err) {
      // Cache is not authoritative; a failed write is a safe no-op.
    }
  }

  async delete(ctx: TenantContext, key: string): Promise<void> {
    try {
      await this.client.del(this.key(ctx, key));
    } catch (err) {
      // Best-effort cache invalidation.
    }
  }

  async exists(ctx: TenantContext, idempotencyKey: IdempotencyKey): Promise<boolean> {
    try {
      const value = await this.client.get(`tenant:${ctx.tenantId as string}:idempotency:${idempotencyKey as string}`);
      return value !== null;
    } catch (err) {
      // Cache is not authoritative; treat as a miss.
      return false;
    }
  }
}

export interface RedisRateLimiterConfig {
  client: RedisClientType;
}

export class RedisRateLimiter implements IRateLimiter {
  constructor(private readonly client: RedisClientType) {}

  private key(ctx: TenantContext, scope: string, key: string): string {
    return `tenant:${ctx.tenantId as string}:rate:${scope}:${key}`;
  }

  async isAllowed(
    ctx: TenantContext,
    scope: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const fullKey = this.key(ctx, scope, key);
    const nowMs = Date.now();
    const resetAt = new Date(nowMs + windowSeconds * 1000);

    const multi = this.client.multi();
    multi.incr(fullKey);
    multi.expire(fullKey, windowSeconds);
    const results = await multi.exec();

    const count = (results?.[0] as number | null) ?? 0;
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    return { allowed, remaining, resetAt };
  }
}
