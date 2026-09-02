import type { TenantContext } from '@projectx/domain';
import type { IdempotencyKey } from '@projectx/shared';
import type { IIdempotencyStore, IdempotencyClaimResult, IdempotencyRecord } from '../ports/idempotency-store';

export class InMemoryIdempotencyStore implements IIdempotencyStore {
  private readonly entries = new Map<string, IdempotencyRecord<unknown>>();
  private readonly expiries = new Map<string, number>();

  private key(ctx: TenantContext, scope: string, key: IdempotencyKey): string {
    return `${ctx.tenantId as string}:${scope}:${key as string}`;
  }

  async get<TResult>(ctx: TenantContext, scope: string, key: IdempotencyKey): Promise<IdempotencyRecord<TResult> | undefined> {
    const k = this.key(ctx, scope, key);
    if (this.isExpired(k)) return undefined;
    return this.entries.get(k) as IdempotencyRecord<TResult> | undefined;
  }

  async set<TResult>(
    ctx: TenantContext,
    scope: string,
    key: IdempotencyKey,
    result: TResult,
    options?: { ttlSeconds?: number; status?: 'PENDING' | 'COMPLETED' | 'FAILED' },
  ): Promise<void> {
    const k = this.key(ctx, scope, key);
    this.entries.set(k, {
      result,
      createdAt: new Date(),
      status: options?.status ?? 'COMPLETED',
    });
    this.expiries.set(k, Date.now() + (options?.ttlSeconds ?? 86400) * 1000);
  }

  async claim<TResult>(
    ctx: TenantContext,
    scope: string,
    key: IdempotencyKey,
    options?: { ttlSeconds?: number },
  ): Promise<IdempotencyClaimResult<TResult>> {
    const k = this.key(ctx, scope, key);
    if (this.entries.has(k) && !this.isExpired(k)) {
      return { claimed: false, existing: this.entries.get(k) as IdempotencyRecord<TResult> };
    }
    this.entries.set(k, { result: undefined as unknown as TResult, createdAt: new Date(), status: 'PENDING' });
    this.expiries.set(k, Date.now() + (options?.ttlSeconds ?? 86400) * 1000);
    return { claimed: true };
  }

  private isExpired(k: string): boolean {
    const expiresAt = this.expiries.get(k);
    return expiresAt !== undefined && expiresAt <= Date.now();
  }
}
