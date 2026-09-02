import type { TenantContext } from '@projectx/domain';

export interface GraphSubscriptionRecord {
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly resource: string;
  readonly notificationUrl: string;
  readonly clientState: string;
  readonly expirationDateTime: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateGraphSubscriptionRecord {
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly resource: string;
  readonly notificationUrl: string;
  readonly clientState: string;
  readonly expirationDateTime: Date;
}

/**
 * Persists the lifecycle state of Microsoft Graph webhook subscriptions so that
 * the admin API can list, renew, and delete them deterministically without
 * relying on Graph as the system of record.
 */
export interface IGraphSubscriptionRepository {
  save(ctx: TenantContext, record: CreateGraphSubscriptionRecord): Promise<void>;
  findByTenant(ctx: TenantContext): Promise<GraphSubscriptionRecord[]>;
  findBySubscriptionId(ctx: TenantContext, subscriptionId: string): Promise<GraphSubscriptionRecord | null>;
  delete(ctx: TenantContext, subscriptionId: string): Promise<void>;
}
