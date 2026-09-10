import type { Pool, PoolClient } from 'pg';
import { PostgresClient } from '@projectx/infrastructure';
import type { CacheEntry, IntelligenceCacheContext, IIntelligenceCache } from '../ports/intelligence-cache.interface';

export class PostgresIntelligenceCache implements IIntelligenceCache {
  private readonly client: PostgresClient;

  constructor(pool: Pool) {
    this.client = new PostgresClient(pool);
  }

  async get<T>(ctx: IntelligenceCacheContext, queryHash: string): Promise<CacheEntry<T> | null> {
    return this.client.withTenant(ctx, async (client: PoolClient) => {
      const result = await client.query(
        `SELECT result_value, provider_id, query_hash, cached_at, expires_at
         FROM intelligence.research_cache
         WHERE tenant_id = $1 AND query_hash = $2 AND workspace_id = $3 AND expires_at > NOW()
         LIMIT 1`,
        [ctx.tenantId, queryHash, ctx.workspaceId],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        value: row.result_value as T,
        providerId: row.provider_id,
        queryHash: row.query_hash,
        cachedAt: new Date(row.cached_at),
        expiresAt: new Date(row.expires_at),
      };
    });
  }

  async set<T>(ctx: IntelligenceCacheContext, queryHash: string, entry: CacheEntry<T>): Promise<void> {
    await this.client.withTenant(ctx, (client: PoolClient) => client.query(
      `INSERT INTO intelligence.research_cache
       (tenant_id, query_hash, workspace_id, result_value, provider_id, cached_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, query_hash) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id, result_value = EXCLUDED.result_value,
         provider_id = EXCLUDED.provider_id, cached_at = EXCLUDED.cached_at, expires_at = EXCLUDED.expires_at`,
      [ctx.tenantId, queryHash, ctx.workspaceId, JSON.stringify(entry.value), entry.providerId, entry.cachedAt, entry.expiresAt],
    ));
  }

  async invalidate(ctx: IntelligenceCacheContext, pattern: string): Promise<void> {
    await this.client.withTenant(ctx, (client: PoolClient) => client.query(
      `DELETE FROM intelligence.research_cache
       WHERE tenant_id = $1 AND workspace_id = $2 AND query_hash LIKE $3`,
      [ctx.tenantId, ctx.workspaceId, `${pattern}%`],
    ));
  }
}
