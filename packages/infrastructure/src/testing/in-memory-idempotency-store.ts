import type { TenantContext } from '@projectx/domain';
import type { IdempotencyKey } from '@projectx/shared';
import type { IIdempotencyStore, IdempotencyClaimResult, IdempotencyRecord } from '../idempotency/idempotency-store.interface';

const NEVER_EXPIRE_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/** Deterministic in-memory IIdempotencyStore test double (tenant + scope + key scoped). */
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
    const status = options?.status ?? 'COMPLETED';
    this.entries.set(k, {
      result,
      createdAt: new Date(),
      status,
    });
    // PENDING records represent a possibly-submitted provider request and must
    // never be pruned by a TTL. COMPLETED/FAILED records can still expire.
    const ttlMs = status === 'PENDING' ? NEVER_EXPIRE_MS : (options?.ttlSeconds ?? 86400) * 1000;
    this.expiries.set(k, Date.now() + ttlMs);
  }

  /**
   * Atomic in the sense that matters here: no `await` occurs between the
   * existence check and the reservation write, so no other task can
   * interleave on Node's single-threaded event loop — this mirrors the
   * single round-trip `INSERT ... ON CONFLICT` atomicity of the Postgres
   * implementation.
   */
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
        return { claimed: false, existing: existing as IdempotencyRecord<TResult> };
      }
    }
    this.entries.set(k, { result: undefined as unknown as TResult, createdAt: new Date(), status: 'PENDING' });
    // PENDING records must never expire while they are unresolved.
    this.expiries.set(k, Date.now() + NEVER_EXPIRE_MS);
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
