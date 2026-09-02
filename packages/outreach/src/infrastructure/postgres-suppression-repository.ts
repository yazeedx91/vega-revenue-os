import type { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';
import type { ISuppressionRepository, SuppressionRecord, SuppressionType } from '../ports/suppression-repository.interface';

export interface PostgresSuppressionRepositoryConfig {
  pool: Pool;
}

interface SuppressionRow {
  tenant_id: string;
  email_address: string;
  suppression_type: string;
  source: string;
  reason: string | null;
  created_at: Date | string;
}

/** Backed by the existing `outreach.suppression` table (RLS-enabled, see infra/database/migrations/001_phase14_initial.sql). */
export class PostgresSuppressionRepository implements ISuppressionRepository {
  private readonly client: PostgresClient;

  constructor(config: PostgresSuppressionRepositoryConfig) {
    this.client = new PostgresClient(config.pool);
  }

  async isSuppressed(ctx: TenantContext, address: string): Promise<SuppressionRecord | null> {
    const result = await this.client.withTenant(ctx, (client) =>
      client.query<SuppressionRow>(`SELECT * FROM outreach.suppression WHERE tenant_id = $1 AND email_address = $2`, [ctx.tenantId as string, address]),
    );
    if (result.rows.length === 0) return null;
    return this.toRecord(result.rows[0]);
  }

  async suppress(ctx: TenantContext, address: string, suppressionType: SuppressionType, source: string, reason?: string): Promise<void> {
    await this.client.withTenant(ctx, (client) =>
      client.query(
        `INSERT INTO outreach.suppression (tenant_id, email_address, suppression_type, source, reason)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, email_address) DO UPDATE SET
           suppression_type = EXCLUDED.suppression_type,
           source = EXCLUDED.source,
           reason = EXCLUDED.reason,
           created_at = NOW()`,
        [ctx.tenantId as string, address, suppressionType, source, reason ?? null],
      ),
    );
  }

  async list(ctx: TenantContext): Promise<SuppressionRecord[]> {
    const result = await this.client.withTenant(ctx, (client) =>
      client.query<SuppressionRow>(`SELECT * FROM outreach.suppression WHERE tenant_id = $1`, [ctx.tenantId as string]),
    );
    return result.rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: SuppressionRow): SuppressionRecord {
    return {
      address: row.email_address,
      suppressionType: row.suppression_type as SuppressionType,
      source: row.source,
      reason: row.reason ?? undefined,
      createdAt: new Date(row.created_at),
    };
  }
}
