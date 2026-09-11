import { Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PostgresClient } from '@projectx/infrastructure';
import type { TenantContext } from '@projectx/domain';

@Injectable()
export class OperatorApiService {
  private readonly db: PostgresClient;
  constructor(pool?: Pool) {
    this.db = new PostgresClient(pool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }));
  }

  lead(ctx: TenantContext, id: string) {
    return this.one(ctx, 'SELECT id,account_id,contact_id,status,decision_reason,reason_codes,scores,evidence_references FROM intelligence.leads WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3', id);
  }

  campaign(ctx: TenantContext, id: string) {
    return this.one(ctx, 'SELECT id,lead_id,contact_id,version,created_at,updated_at,payload - \'recipientFingerprint\' - \'recipientAddress\' AS state FROM outreach.campaigns WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3', id);
  }

  sequence(ctx: TenantContext, id: string) {
    return this.one(ctx, 'SELECT id,campaign_id,lead_id,contact_id,version,created_at,updated_at,payload - \'recipientFingerprint\' - \'recipientCiphertext\' - \'recipientAddress\' AS state FROM outreach.sequences WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3', id);
  }

  execution(ctx: TenantContext, id: string) {
    return this.one(ctx, 'SELECT id,campaign_id,sequence_id,lead_id,contact_id,status,provider_message_id,version,created_at,updated_at,payload - \'recipientFingerprint\' - \'recipientCiphertext\' - \'recipientAddress\' AS state FROM outreach.message_executions WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3', id);
  }

  conversation(ctx: TenantContext, id: string) {
    return this.one(ctx, 'SELECT id,lead_id,execution_id,version,created_at,updated_at,payload - \'sender\' - \'recipientAddress\' AS state FROM conversation.conversations WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3', id);
  }

  approval(ctx: TenantContext, id: string) {
    return this.one(ctx, 'SELECT id,mission_id,version,created_at,updated_at,payload - \'reasoning\' AS state FROM mission.approvals WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3', id);
  }

  private async one(ctx: TenantContext, sql: string, id: string): Promise<Record<string, unknown>> {
    if (!ctx.workspaceId) throw new NotFoundException('Resource not found');
    const result = await this.db.withTenant(ctx, (client) => client.query(sql, [ctx.tenantId, ctx.workspaceId, id]));
    if (!result.rows[0]) throw new NotFoundException('Resource not found');
    return result.rows[0];
  }
}
