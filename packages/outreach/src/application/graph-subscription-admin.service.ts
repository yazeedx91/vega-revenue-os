import type { TenantContext } from '@projectx/domain';
import type { IAuditLog, ITelemetry } from '@projectx/infrastructure';
import type { IGraphSubscriptionClient } from '../ports/graph-subscription-client.interface';
import type {
  CreateGraphSubscriptionRecord,
  GraphSubscriptionRecord,
  IGraphSubscriptionRepository,
} from '../ports/graph-subscription-repository.interface';

export interface GraphSubscriptionAdminServiceConfig {
  readonly subscriptionClient: IGraphSubscriptionClient;
  readonly subscriptionRepository: IGraphSubscriptionRepository;
  readonly auditLog: IAuditLog;
  readonly telemetry?: ITelemetry;
  readonly allowedNotificationUrlPrefix?: string;
}

export interface CreateGraphSubscriptionAdminRequest {
  readonly ctx: TenantContext;
  readonly workspaceId: string;
  readonly resource: string;
  readonly notificationUrl: string;
  readonly expirationDateTime: Date;
  readonly clientState: string;
}

export interface GraphSubscriptionAdminResult<T> {
  readonly success: boolean;
  readonly value?: T;
  readonly error?: string;
}

/**
 * Application service for manual Graph webhook subscription management.
 * Coordinates the Graph REST client, durable repository, audit, and telemetry.
 */
export class GraphSubscriptionAdminService {
  constructor(private readonly config: GraphSubscriptionAdminServiceConfig) {}

  async create(request: CreateGraphSubscriptionAdminRequest): Promise<GraphSubscriptionAdminResult<GraphSubscriptionRecord>> {
    if (!this.isNotificationUrlAllowed(request.notificationUrl)) {
      this.telemetry('graph_subscription_create_denied', { reason: 'invalid_notification_url' });
      return { success: false, error: 'Notification URL does not match allowed callback configuration' };
    }

    const clientResult = await this.config.subscriptionClient.createSubscription(request.ctx, {
      resource: request.resource,
      notificationUrl: request.notificationUrl,
      expirationDateTime: request.expirationDateTime,
      clientState: request.clientState,
    });

    if (!clientResult.success) {
      await this.audit(request.ctx, 'graph_subscription_create_failed', 'failure', clientResult.error.message);
      this.telemetry('graph_subscription_create_failed', { code: clientResult.error.code });
      return { success: false, error: clientResult.error.message };
    }

    const record: CreateGraphSubscriptionRecord = {
      tenantId: request.ctx.tenantId as string,
      workspaceId: request.workspaceId,
      subscriptionScope: 'WORKSPACE_BOUND',
      subscriptionId: clientResult.value.id,
      resource: clientResult.value.resource,
      notificationUrl: clientResult.value.notificationUrl,
      clientState: clientResult.value.clientState,
      expirationDateTime: clientResult.value.expirationDateTime,
    };

    await this.config.subscriptionRepository.save(request.ctx, record);
    await this.audit(request.ctx, 'graph_subscription_created', 'success', undefined, {
      subscriptionId: record.subscriptionId,
      resource: record.resource,
    });
    this.telemetry('graph_subscription_created', { subscriptionId: record.subscriptionId });

    return {
      success: true,
      value: {
        ...record,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  }

  async list(ctx: TenantContext): Promise<GraphSubscriptionRecord[]> {
    return this.config.subscriptionRepository.findByTenant(ctx);
  }

  async delete(ctx: TenantContext, subscriptionId: string): Promise<GraphSubscriptionAdminResult<void>> {
    const persisted = await this.config.subscriptionRepository.findBySubscriptionId(ctx, subscriptionId);
    if (!persisted) {
      this.telemetry('graph_subscription_delete_not_found', { subscriptionId });
      return { success: false, error: 'Subscription not found' };
    }

    const clientResult = await this.config.subscriptionClient.deleteSubscription(ctx, subscriptionId);
    if (!clientResult.success && clientResult.error.statusCode !== 404) {
      await this.audit(ctx, 'graph_subscription_delete_failed', 'failure', clientResult.error.message, { subscriptionId });
      this.telemetry('graph_subscription_delete_failed', { code: clientResult.error.code, subscriptionId });
      return { success: false, error: clientResult.error.message };
    }

    await this.config.subscriptionRepository.delete(ctx, subscriptionId);
    await this.audit(ctx, 'graph_subscription_deleted', 'success', undefined, { subscriptionId });
    this.telemetry('graph_subscription_deleted', { subscriptionId });
    return { success: true };
  }

  private isNotificationUrlAllowed(notificationUrl: string): boolean {
    if (!this.config.allowedNotificationUrlPrefix) {
      return false;
    }
    return notificationUrl.startsWith(this.config.allowedNotificationUrlPrefix);
  }

  private async audit(
    ctx: TenantContext,
    action: string,
    result: 'success' | 'failure',
    reason?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.config.auditLog.record(ctx, {
      action,
      resourceType: 'graph_subscription',
      resourceId: (metadata?.subscriptionId as string) ?? 'unknown',
      result,
      reason,
      metadata,
    });
  }

  private telemetry(name: string, tags?: Record<string, string | undefined>): void {
    if (!this.config.telemetry) return;
    const safeTags: Record<string, string> = {};
    for (const [key, value] of Object.entries(tags ?? {})) {
      if (value !== undefined) safeTags[key] = value;
    }
    this.config.telemetry.increment(name, 1, safeTags);
  }
}
