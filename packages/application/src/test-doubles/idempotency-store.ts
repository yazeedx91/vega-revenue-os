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
    const record = this.entries.get(k) as IdempotencyRecord<TResult> | undefined;
    if (!record) return undefined;
    const expiresAt = this.expiries.get(k);
    if (expiresAt === undefined) return record;
    return { ...record, expiresAt: new Date(expiresAt) };
  }

  async set<TResult>(
    ctx: TenantContext,
    scope: string,
    key: IdempotencyKey,
    result: TResult,
    options?: { ttlSeconds?: number; status?: 'PENDING' | 'COMPLETED' | 'FAILED' },
  ): Promise<void> {
    const k = this.key(ctx, scope, key);
    const ttlMs = (options?.ttlSeconds ?? 86400) * 1000;
    const expiresAt = Date.now() + ttlMs;
    this.entries.set(k, {
      result,
      createdAt: new Date(),
      expiresAt: new Date(expiresAt),
      status: options?.status ?? 'COMPLETED',
    });
    this.expiries.set(k, expiresAt);
  }

  async claim<TResult>(
    ctx: TenantContext,
    scope: string,
    key: IdempotencyKey,
    options?: { ttlSeconds?: number },
  ): Promise<IdempotencyClaimResult<TResult>> {
    const k = this.key(ctx, scope, key);
    const existing = this.entries.get(k);
    if (existing) {
      // PENDING records are never reclaimed, even if expired, because the
      // provider may have accepted the submission before the result was persisted.
      // FAILED records may only be reclaimed when they provably had no submission.
      const canReclaim =
        existing.status === 'FAILED' &&
        typeof existing.result === 'object' &&
        existing.result !== null &&
        (existing.result as Record<string, unknown>).submitted === false;
      if (!canReclaim) {
        const expiresAt = this.expiries.get(k);
        const record = { ...(existing as IdempotencyRecord<TResult>) };
        if (expiresAt !== undefined) {
          (record as { expiresAt?: Date }).expiresAt = new Date(expiresAt);
        }
        return { claimed: false, existing: record };
      }
    }
    const expiresAt = Date.now() + (options?.ttlSeconds ?? 86400) * 1000;
    this.entries.set(k, {
      result: undefined as unknown as TResult,
      createdAt: new Date(),
      expiresAt: new Date(expiresAt),
      status: 'PENDING',
    });
    this.expiries.set(k, expiresAt);
    return { claimed: true };
  }

  private isExpired(k: string): boolean {
    const expiresAt = this.expiries.get(k);
    return expiresAt !== undefined && expiresAt <= Date.now();
  }

  clear(): void {
    this.entries.clear();
    this.expiries.clear();
  }
}
