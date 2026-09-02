import type { Pool } from 'pg';
import type { TenantContext } from '@projectx/domain';
import { PostgresClient } from '@projectx/infrastructure';
import type {
  CreateGraphSubscriptionRecord,
  GraphSubscriptionRecord,
  IGraphSubscriptionRepository,
} from '../ports/graph-subscription-repository.interface';

export interface PostgresGraphSubscriptionRepositoryConfig {
  readonly pool: Pool;
}

interface GraphSubscriptionRow {
  tenant_id: string;
  subscription_id: string;
  resource: string;
  notification_url: string;
  client_state: string;
  expiration_date_time: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresGraphSubscriptionRepository implements IGraphSubscriptionRepository {
  private readonly client: PostgresClient;

  constructor(config: PostgresGraphSubscriptionRepositoryConfig) {
    this.client = new PostgresClient(config.pool);
  }

  async save(ctx: TenantContext, record: CreateGraphSubscriptionRecord): Promise<void> {
    await this.client.withTenant(ctx, (client) =>
      client.query(
        `INSERT INTO outreach.graph_subscriptions (
           tenant_id, subscription_id, resource, notification_url, client_state, expiration_date_time, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (tenant_id, subscription_id) DO UPDATE SET
           resource = EXCLUDED.resource,
           notification_url = EXCLUDED.notification_url,
           client_state = EXCLUDED.client_state,
           expiration_date_time = EXCLUDED.expiration_date_time,
           updated_at = NOW()`,
        [
          record.tenantId,
          record.subscriptionId,
          record.resource,
          record.notificationUrl,
          record.clientState,
          record.expirationDateTime,
        ],
      ),
    );
  }

  async findByTenant(ctx: TenantContext): Promise<GraphSubscriptionRecord[]> {
    const result = await this.client.withTenant(ctx, (client) =>
      client.query<GraphSubscriptionRow>(
        `SELECT * FROM outreach.graph_subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [ctx.tenantId as string],
      ),
    );
    return result.rows.map((row) => this.toRecord(row));
  }

  async findBySubscriptionId(ctx: TenantContext, subscriptionId: string): Promise<GraphSubscriptionRecord | null> {
    const result = await this.client.withTenant(ctx, (client) =>
      client.query<GraphSubscriptionRow>(
        `SELECT * FROM outreach.graph_subscriptions WHERE tenant_id = $1 AND subscription_id = $2`,
        [ctx.tenantId as string, subscriptionId],
      ),
    );
    if (result.rows.length === 0) return null;
    return this.toRecord(result.rows[0]);
  }

  async delete(ctx: TenantContext, subscriptionId: string): Promise<void> {
    await this.client.withTenant(ctx, (client) =>
      client.query(`DELETE FROM outreach.graph_subscriptions WHERE tenant_id = $1 AND subscription_id = $2`, [
        ctx.tenantId as string,
        subscriptionId,
      ]),
    );
  }

  private toRecord(row: GraphSubscriptionRow): GraphSubscriptionRecord {
    return {
      tenantId: row.tenant_id,
      subscriptionId: row.subscription_id,
      resource: row.resource,
      notificationUrl: row.notification_url,
      clientState: row.client_state,
      expirationDateTime: row.expiration_date_time instanceof Date ? row.expiration_date_time : new Date(row.expiration_date_time),
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    };
  }
}
