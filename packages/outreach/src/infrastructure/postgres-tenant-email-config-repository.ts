import type { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import { asTenantId } from '@projectx/shared';
import { PostgresClient } from '@projectx/infrastructure';
import type { ITenantEmailConfigRepository, TenantEmailConfig } from '../ports/tenant-email-config-repository.interface';

export interface PostgresTenantEmailConfigRepositoryConfig {
  pool: Pool;
}

interface TenantEmailConfigRow {
  tenant_id: string;
  provider_id: string;
  channel: string;
  from_address: string;
  reply_to_address: string | null;
  allowed_domains: string[] | null;
  graph_client_secret_reference: string | null;
  webhook_secret_reference: string | null;
}

interface InboundMailboxLookupRow {
  tenant_id: string;
  provider_id: string;
  channel: string;
}

function toConfig(row: TenantEmailConfigRow): TenantEmailConfig {
  return {
    tenantId: row.tenant_id,
    providerId: row.provider_id,
    channel: row.channel,
    fromAddress: row.from_address,
    replyToAddress: row.reply_to_address ?? undefined,
    allowedDomains: row.allowed_domains ?? [],
    graphClientSecretReference: row.graph_client_secret_reference ?? undefined,
    webhookSecretReference: row.webhook_secret_reference ?? undefined,
  };
}

/**
 * Backed by the existing (previously unused) `outreach.tenant_email_config`
 * table (see `infra/database/migrations/001_phase14_initial.sql`). A
 * named-column table, not the generic `payload` JSONB pattern used by the
 * aggregate repositories.
 */
export class PostgresTenantEmailConfigRepository implements ITenantEmailConfigRepository {
  private readonly client: PostgresClient;

  constructor(config: PostgresTenantEmailConfigRepositoryConfig) {
    this.client = new PostgresClient(config.pool);
  }

  async get(ctx: TenantContext, providerId: string): Promise<TenantEmailConfig | null> {
    const result = await this.client.withTenant(ctx, (client) =>
      client.query<TenantEmailConfigRow>(
        `SELECT * FROM outreach.tenant_email_config WHERE tenant_id = $1 AND provider_id = $2 LIMIT 1`,
        [ctx.tenantId as string, providerId],
      ),
    );
    return result.rows.length > 0 ? toConfig(result.rows[0]) : null;
  }

  /**
   * Resolves an inbound mailbox address to a tenant/provider via the
   * narrow `outreach.resolve_inbound_mailbox` SECURITY DEFINER function.
   * The function has no cross-tenant return risk and the actual
   * `tenant_email_config` row is then loaded through the resolved tenant's
   * RLS-scoped `TenantContext`, so the application role never bypasses RLS.
   */
  async findByMailboxAddress(fromAddress: string): Promise<TenantEmailConfig | null> {
    const lookup = await this.client.query<InboundMailboxLookupRow>(
      `SELECT * FROM outreach.resolve_inbound_mailbox($1)`,
      [fromAddress],
    );
    if (lookup.rows.length === 0) {
      return null;
    }
    const resolved = lookup.rows[0];
    const resolvedCtx: TenantContext = {
      tenantId: asTenantId(resolved.tenant_id),
      correlationId: 'inbound-mailbox-resolve',
    };
    return this.get(resolvedCtx, resolved.provider_id);
  }
}
