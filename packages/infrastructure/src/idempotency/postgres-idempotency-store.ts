import type { Pool } from 'pg';
import type { IdempotencyKey } from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';
import type { IIdempotencyStore, IdempotencyClaimResult, IdempotencyRecord } from './idempotency-store.interface';
import { PostgresClient } from '../persistence/postgres-client';

export interface PostgresIdempotencyStoreConfig {
  pool: Pool;
  defaultTtlSeconds?: number;
}

const NEVER_EXPIRE_SECONDS = 100 * 365 * 24 * 60 * 60;

export class PostgresIdempotencyStore implements IIdempotencyStore {
  private readonly client: PostgresClient;
  private readonly defaultTtlSeconds: number;

  constructor(config: PostgresIdempotencyStoreConfig) {
    this.client = new PostgresClient(config.pool);
    this.defaultTtlSeconds = config.defaultTtlSeconds ?? 86400;
  }

  async get<TResult>(ctx: TenantContext, scope: string, key: IdempotencyKey): Promise<IdempotencyRecord<TResult> | undefined> {
    const result = await this.client.withTenant(ctx, async (client) => {
      return client.query(
        `SELECT status, result, created_at, expires_at FROM idempotency.keys
         WHERE tenant_id = $1 AND scope = $2 AND key = $3`,
        [ctx.tenantId as string, scope, key as string],
      );
    });

    if (result.rows.length === 0) {
      return undefined;
    }

    const row = result.rows[0];
    return {
      status: row.status,
      result: row.result as TResult,
      createdAt: row.created_at as Date,
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
    };
  }

  async set<TResult>(
    ctx: TenantContext,
    scope: string,
    key: IdempotencyKey,
    result: TResult,
    options?: { ttlSeconds?: number; status?: 'PENDING' | 'COMPLETED' | 'FAILED' },
  ): Promise<void> {
    const status = options?.status ?? 'COMPLETED';
    // PENDING records represent a possibly-submitted provider request, so they
    // must never be pruned by a TTL. COMPLETED/FAILED records can still expire.
    const ttlSeconds = status === 'PENDING' ? NEVER_EXPIRE_SECONDS : (options?.ttlSeconds ?? this.defaultTtlSeconds);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO idempotency.keys (tenant_id, scope, key, status, result, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, key, scope) DO UPDATE SET
           status = EXCLUDED.status,
           result = EXCLUDED.result,
           expires_at = EXCLUDED.expires_at`,
        [ctx.tenantId as string, scope, key as string, status, JSON.stringify(result), expiresAt],
      );
    });
  }

  async claim<TResult>(
    ctx: TenantContext,
    scope: string,
    key: IdempotencyKey,
    options?: { ttlSeconds?: number },
  ): Promise<IdempotencyClaimResult<TResult>> {
    // PENDING records must never expire while they are unresolved.
    const expiresAt = new Date(Date.now() + NEVER_EXPIRE_SECONDS * 1000);

    // Single atomic statement: succeeds (returns exactly one row) either on a
    // fresh insert (no conflict) or when re-claiming a FAILED key that is
    // provably safe to retry (result.submitted === false). PENDING records are
    // never reclaimed — even if expired — because the provider may have accepted
    // the submission before the result was persisted. If a live record already
    // exists, the WHERE guard suppresses the update and RETURNING yields no
    // row — this is the atomic "claim failed" signal, with no separate
    // read-then-write race window.
    const result = await this.client.withTenant(ctx, async (client) => {
      return client.query(
        `INSERT INTO idempotency.keys (tenant_id, scope, key, status, result, expires_at)
         VALUES ($1, $2, $3, 'PENDING', $4, $5)
         ON CONFLICT (tenant_id, key, scope) DO UPDATE SET
           status = EXCLUDED.status,
           result = EXCLUDED.result,
           expires_at = EXCLUDED.expires_at
         WHERE idempotency.keys.status = 'FAILED'
           AND (idempotency.keys.result->>'submitted')::boolean = false
         RETURNING status, result, created_at, expires_at`,
        [ctx.tenantId as string, scope, key as string, JSON.stringify(null), expiresAt],
      );
    });

    if (result.rows.length === 1) {
      return { claimed: true };
    }

    const existing = await this.get<TResult>(ctx, scope, key);
    return { claimed: false, existing };
  }
}
