import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { TenantContext } from '@projectx/domain';

export interface PostgresClientConfig {
  pool: Pool;
}

export class PostgresClient {
  constructor(private readonly pool: Pool) {}

  async withTenant<T>(ctx: TenantContext, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, ctx);
      return await operation(client);
    } finally {
      await this.clearTenantContext(client).catch(() => {});
      client.release();
    }
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params);
  }

  async end(): Promise<void> { await this.pool.end(); }

  async transaction<T>(ctx: TenantContext, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.setTenantContext(client, ctx);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      await this.clearTenantContext(client).catch(() => {});
      client.release();
    }
  }

  /**
   * Sets the session-level tenant context used by row-level security
   * policies (`current_setting('app.current_tenant', TRUE)`). Uses
   * `set_config(..., false)` so the value is visible for the whole borrowed
   * connection, then clears it before the client is returned to the pool.
   * The tenant id is always bound as a query parameter and never concatenated
   * into SQL text.
   */
  private async setTenantContext(client: PoolClient, ctx: TenantContext): Promise<void> {
    // Session-level (is_local=false) so the value is visible across all
    // queries on this pooled connection for the duration of the operation.
    await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [ctx.tenantId as string]);
  }

  private async clearTenantContext(client: PoolClient): Promise<void> {
    await client.query(`SELECT set_config('app.current_tenant', '', false)`);
  }
}
