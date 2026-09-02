import type { IdempotencyKey } from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';

export interface IdempotencyRecord<TResult> {
  readonly result: TResult;
  readonly createdAt: Date;
  readonly status: 'PENDING' | 'COMPLETED' | 'FAILED';
}

export interface IdempotencyClaimResult<TResult> {
  /** True if this call atomically reserved the key (no prior live record existed). */
  readonly claimed: boolean;
  /** The pre-existing record, if the claim was not won. */
  readonly existing?: IdempotencyRecord<TResult>;
}

export interface IIdempotencyStore {
  get<TResult>(ctx: TenantContext, scope: string, key: IdempotencyKey): Promise<IdempotencyRecord<TResult> | undefined>;
  set<TResult>(
    ctx: TenantContext,
    scope: string,
    key: IdempotencyKey,
    result: TResult,
    options?: { ttlSeconds?: number; status?: 'PENDING' | 'COMPLETED' | 'FAILED' },
  ): Promise<void>;
  /**
   * Atomically test-and-reserve a key in a single operation, closing the
   * TOCTOU race inherent in separate get()-then-set() calls. Exactly one
   * concurrent caller for a given (tenant, scope, key) will receive
   * `claimed: true`; all others receive `claimed: false` with the existing
   * record (if available) for diagnostics.
   *
   * PENDING records representing a possibly-submitted external request must
   * never be reclaimed, regardless of expiry. FAILED records may only be
   * reclaimed when their stored result explicitly proves no submission
   * occurred (`result.submitted === false`).
   */
  claim<TResult>(ctx: TenantContext, scope: string, key: IdempotencyKey, options?: { ttlSeconds?: number }): Promise<IdempotencyClaimResult<TResult>>;
}
