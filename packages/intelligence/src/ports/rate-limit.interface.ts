import type { TenantContext } from '@projectx/domain';

export interface RateLimitInfo {
  allowed: boolean;
  remaining: number;
  resetAt?: Date;
  retryAfterMs?: number;
}

export interface IRateLimitStore {
  check(ctx: TenantContext, providerId: string, cost: number): Promise<RateLimitInfo>;
  recordUsage(ctx: TenantContext, providerId: string, cost: number): Promise<void>;
}
