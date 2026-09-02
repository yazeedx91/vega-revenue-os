import type { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import type { IAuditLog, AuditRecord } from './audit-log.interface';
import { PostgresClient } from '../persistence/postgres-client';

export interface PostgresAuditLogConfig {
  pool: Pool;
}

export class PostgresAuditLog implements IAuditLog {
  private readonly client: PostgresClient;

  constructor(config: PostgresAuditLogConfig) {
    this.client = new PostgresClient(config.pool);
  }

  async record(ctx: TenantContext, entry: AuditRecord): Promise<void> {
    await this.client.withTenant(ctx, async (client) => {
      await client.query(
        `INSERT INTO audit.audit_log
         (action, resource_type, resource_id, tenant_id, actor, result, reason, metadata, correlation_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          entry.action,
          entry.resourceType,
          entry.resourceId,
          ctx.tenantId as string,
          // Actor is not part of TenantContext; callers may extend context.
          'actor' in ctx ? JSON.stringify((ctx as Record<string, unknown>).actor) : null,
          entry.result,
          entry.reason ?? null,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
          ctx.correlationId as string,
        ],
      );
    });
  }
}
