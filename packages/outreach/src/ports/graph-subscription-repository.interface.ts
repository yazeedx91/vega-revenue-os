import type { TenantContext } from '@projectx/domain';

export type GraphSubscriptionScope = 'WORKSPACE_BOUND' | 'LEGACY_UNBOUND';

export interface GraphSubscriptionRecord {
  readonly tenantId: string;
  readonly workspaceId: string | null;
  readonly subscriptionScope: GraphSubscriptionScope;
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
  readonly workspaceId: string;
  readonly subscriptionScope: 'WORKSPACE_BOUND';
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
