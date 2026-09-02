import type { Pool } from 'pg';
import type { AggregateRoot } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import { TenantIsolationError } from '@projectx/domain';
import { PostgresClient } from './postgres-client';
import { ConcurrencyConflictError } from './concurrency-conflict.error';

export interface AggregateMapper<TEntity, TSnapshot, TId extends string = string> {
  toSnapshot(entity: TEntity): TSnapshot;
  fromSnapshot(snapshot: TSnapshot, id: TId, tenantId: string, version: number): TEntity;
}

export interface PostgresRepositoryConfig {
  pool: Pool;
  tableName: string;
}

export class PostgresRepository<TEntity extends AggregateRoot<TId>, TSnapshot, TId extends string = string> {
  private readonly client: PostgresClient;
  private readonly tableName: string;

  constructor(
    config: PostgresRepositoryConfig,
    private readonly mapper: AggregateMapper<TEntity, TSnapshot, TId>,
  ) {
    this.client = new PostgresClient(config.pool);
    this.tableName = config.tableName;
  }

  async findById(ctx: TenantContext, id: TId): Promise<TEntity | null> {
    const result = await this.client.withTenant(ctx, async (client) => {
      return client.query(
        `SELECT tenant_id, payload, version FROM ${this.tableName}
         WHERE tenant_id = $1 AND id = $2
         LIMIT 1`,
        [ctx.tenantId as string, id],
      );
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    // Defense-in-depth: the WHERE clause and RLS policy should already make
    // this impossible, but a repository-layer assertion catches a
    // hypothetical RLS misconfiguration rather than silently returning
    // another tenant's data.
    if (row.tenant_id !== (ctx.tenantId as string)) {
      throw new TenantIsolationError('Cross-tenant row returned by persistence layer');
    }

    const snapshot = row.payload as TSnapshot;
    return this.mapper.fromSnapshot(snapshot, id, ctx.tenantId as string, row.version as number);
  }

  /**
   * Persists the aggregate with real optimistic concurrency control.
   *
   * - `entity.loadedVersion === undefined` means the aggregate was never
   *   persisted (fresh `create()`): performs an insert-only write and fails
   *   if a row with this id already exists (duplicate id).
   * - Otherwise: performs an update guarded by
   *   `WHERE version = loadedVersion`, and fails if the stored version has
   *   since moved (a concurrent writer got there first).
   *
   * Throws ConcurrencyConflictError in either failure case.
   */
  async save(ctx: TenantContext, entity: TEntity): Promise<void> {
    const snapshot = this.mapper.toSnapshot(entity);
    const newVersion = entity.version;
    const expectedVersion = entity.loadedVersion;
    const payload = JSON.stringify(snapshot);

    await this.client.withTenant(ctx, async (client) => {
      if (expectedVersion === undefined) {
        const result = await client.query(
          `INSERT INTO ${this.tableName} (tenant_id, id, payload, version, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (tenant_id, id) DO NOTHING
           RETURNING id`,
          [ctx.tenantId as string, entity.id, payload, newVersion],
        );
        if (result.rowCount === 0) {
          throw new ConcurrencyConflictError(
            `Insert failed: aggregate ${entity.id} already exists in ${this.tableName}`,
            ctx.tenantId as string,
            entity.id,
            undefined,
          );
        }
        return;
      }

      const result = await client.query(
        `UPDATE ${this.tableName}
         SET payload = $3, version = $4, updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 AND version = $5`,
        [ctx.tenantId as string, entity.id, payload, newVersion, expectedVersion],
      );
      if (result.rowCount === 0) {
        throw new ConcurrencyConflictError(
          `Update failed: expected version ${expectedVersion} for aggregate ${entity.id} in ${this.tableName} is stale`,
          ctx.tenantId as string,
          entity.id,
          expectedVersion,
        );
      }
    });
    entity.setVersion(newVersion);
  }
}