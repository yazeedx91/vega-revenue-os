import type { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import type { OutreachChannel } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';
import type { AllowlistEntry, IRecipientAllowlistRepository } from '../ports/recipient-allowlist-repository.interface';

export interface PostgresRecipientAllowlistRepositoryConfig {
  pool: Pool;
}

interface AllowlistRow {
  tenant_id: string;
  email_address: string;
  display_name: string | null;
  approved_by: string;
  approved_at: Date | string;
  reason: string | null;
}

/**
 * Backed by the existing `outreach.allowed_recipients` table (see
 * infra/database/migrations/001_phase14_initial.sql). This table currently
 * only models email addresses (no `channel` column); the `channel` argument
 * is validated/passed through the port for future multi-channel support but
 * is not yet part of the WHERE clause for this adapter. Non-email channels
 * are out of scope for Milestone 5 (no Microsoft Graph / live email yet).
 */
export class PostgresRecipientAllowlistRepository implements IRecipientAllowlistRepository {
  private readonly client: PostgresClient;

  constructor(config: PostgresRecipientAllowlistRepositoryConfig) {
    this.client = new PostgresClient(config.pool);
  }

  async isAllowed(ctx: TenantContext, _channel: OutreachChannel, address: string): Promise<boolean> {
    const result = await this.client.withTenant(ctx, (client) =>
      client.query<AllowlistRow>(
        `SELECT tenant_id FROM outreach.allowed_recipients WHERE tenant_id = $1 AND email_address = $2`,
        [ctx.tenantId as string, address],
      ),
    );
    return result.rows.length > 0;
  }

  async add(
    ctx: TenantContext,
    entry: { channel: OutreachChannel; address: string; displayName?: string; approvedBy: string; reason?: string },
  ): Promise<void> {
    await this.client.withTenant(ctx, (client) =>
      client.query(
        `INSERT INTO outreach.allowed_recipients (tenant_id, email_address, display_name, approved_by, reason)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, email_address) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           approved_by = EXCLUDED.approved_by,
           reason = EXCLUDED.reason,
           approved_at = NOW()`,
        [ctx.tenantId as string, entry.address, entry.displayName ?? null, entry.approvedBy, entry.reason ?? null],
      ),
    );
  }

  async remove(ctx: TenantContext, _channel: OutreachChannel, address: string): Promise<void> {
    await this.client.withTenant(ctx, (client) =>
      client.query(`DELETE FROM outreach.allowed_recipients WHERE tenant_id = $1 AND email_address = $2`, [ctx.tenantId as string, address]),
    );
  }

  async list(ctx: TenantContext): Promise<AllowlistEntry[]> {
    const result = await this.client.withTenant(ctx, (client) =>
      client.query<AllowlistRow>(`SELECT * FROM outreach.allowed_recipients WHERE tenant_id = $1`, [ctx.tenantId as string]),
    );
    return result.rows.map((row) => ({
      address: row.email_address,
      channel: 'email' as OutreachChannel,
      displayName: row.display_name ?? undefined,
      approvedBy: row.approved_by,
      approvedAt: new Date(row.approved_at),
      reason: row.reason ?? undefined,
    }));
  }
}
