import type { TenantContext } from '@projectx/domain';
import { InMemoryAuditLog } from '@projectx/infrastructure';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import type {
  CreateGraphSubscriptionRequest,
  GraphSubscription,
  GraphSubscriptionClientError,
  GraphSubscriptionResult,
  IGraphSubscriptionClient,
} from '../../ports/graph-subscription-client.interface';
import { InMemoryGraphSubscriptionRepository } from '../../infrastructure/in-memory-graph-subscription-repository';
import { GraphSubscriptionAdminService } from '../graph-subscription-admin.service';

class FakeGraphSubscriptionClient implements IGraphSubscriptionClient {
  private subscriptions = new Map<string, GraphSubscription>();
  shouldFailCreate = false;
  shouldFailDelete = false;

  async createSubscription(
    _ctx: TenantContext,
    request: CreateGraphSubscriptionRequest,
  ): Promise<GraphSubscriptionResult<GraphSubscription>> {
    if (this.shouldFailCreate) {
      return { success: false, error: { code: 'GRAPH_ERROR', message: 'create failed' } };
    }
    const subscription: GraphSubscription = {
      id: `sub-${Date.now()}`,
      resource: request.resource,
      notificationUrl: request.notificationUrl,
      expirationDateTime: request.expirationDateTime,
      clientState: request.clientState,
    };
    this.subscriptions.set(subscription.id, subscription);
    return { success: true, value: subscription };
  }

  async listSubscriptions(_ctx: TenantContext): Promise<GraphSubscriptionResult<GraphSubscription[]>> {
    return { success: true, value: Array.from(this.subscriptions.values()) };
  }

  async deleteSubscription(_ctx: TenantContext, subscriptionId: string): Promise<GraphSubscriptionResult<void>> {
    if (this.shouldFailDelete) {
      return { success: false, error: { code: 'GRAPH_ERROR', message: 'delete failed' } };
    }
    if (!this.subscriptions.has(subscriptionId)) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'not found', statusCode: 404 } };
    }
    this.subscriptions.delete(subscriptionId);
    return { success: true, value: undefined };
  }
}

describe('GraphSubscriptionAdminService', () => {
  const tenantA: TenantContext = { tenantId: asTenantId('tenant-a'), correlationId: asCorrelationId('corr-a') };
  const tenantB: TenantContext = { tenantId: asTenantId('tenant-b'), correlationId: asCorrelationId('corr-b') };

  function buildService(allowedNotificationUrlPrefix?: string) {
    const client = new FakeGraphSubscriptionClient();
    const repository = new InMemoryGraphSubscriptionRepository();
    const auditLog = new InMemoryAuditLog();
    const service = new GraphSubscriptionAdminService({
      subscriptionClient: client,
      subscriptionRepository: repository,
      auditLog,
      allowedNotificationUrlPrefix,
    });
    return { service, client, repository, auditLog };
  }

  it('creates and persists a subscription when notification URL is allowed', async () => {
    const { service, repository } = buildService('https://example.com/webhook/');
    const expiration = new Date(Date.now() + 3600_000);
    const result = await service.create({
      ctx: tenantA,
      resource: '/users/mailbox@example.com/messages',
      notificationUrl: 'https://example.com/webhook/graph',
      expirationDateTime: expiration,
      clientState: 'secret-state',
    });
    expect(result.success).toBe(true);
    expect(result.value!.subscriptionId).toBeDefined();
    expect(result.value!.tenantId).toBe('tenant-a');
    const persisted = await repository.findBySubscriptionId(tenantA, result.value!.subscriptionId);
    expect(persisted).not.toBeNull();
  });

  it('rejects creation with disallowed notification URL', async () => {
    const { service, repository } = buildService('https://example.com/webhook/');
    const result = await service.create({
      ctx: tenantA,
      resource: '/users/mailbox@example.com/messages',
      notificationUrl: 'https://attacker.com/webhook/graph',
      expirationDateTime: new Date(Date.now() + 3600_000),
      clientState: 'secret-state',
    });
    expect(result.success).toBe(false);
    const all = await repository.findByTenant(tenantA);
    expect(all).toHaveLength(0);
  });

  it('refuses to create a subscription when no allowedNotificationUrlPrefix is configured (deny-by-default)', async () => {
    const { service, repository, auditLog } = buildService();
    const result = await service.create({
      ctx: tenantA,
      resource: '/users/mailbox@example.com/messages',
      notificationUrl: 'https://example.com/webhook/graph',
      expirationDateTime: new Date(Date.now() + 3600_000),
      clientState: 'secret-state',
    });
    expect(result.success).toBe(false);
    expect(await repository.findByTenant(tenantA)).toHaveLength(0);
    expect(auditLog.entries.some((e) => e.action === 'graph_subscription_created')).toBe(false);
  });

  it('returns an error and audits when Graph client create fails', async () => {
    const { service, client, auditLog } = buildService('https://example.com/webhook/');
    client.shouldFailCreate = true;
    const result = await service.create({
      ctx: tenantA,
      resource: '/users/mailbox@example.com/messages',
      notificationUrl: 'https://example.com/webhook/graph',
      expirationDateTime: new Date(Date.now() + 3600_000),
      clientState: 'secret-state',
    });
    expect(result.success).toBe(false);
    expect(auditLog.entries.some((e) => e.action === 'graph_subscription_create_failed')).toBe(true);
  });

  it('lists only tenant-scoped subscriptions', async () => {
    const { service: serviceA } = buildService('https://example.com/webhook/');
    await serviceA.create({
      ctx: tenantA,
      resource: '/users/a/messages',
      notificationUrl: 'https://example.com/webhook/a',
      expirationDateTime: new Date(Date.now() + 3600_000),
      clientState: 's1',
    });

    const { service: serviceB, repository: repoB } = buildService();
    await repoB.save(tenantB, {
      tenantId: 'tenant-b',
      subscriptionId: 'sub-b',
      resource: '/users/b/messages',
      notificationUrl: 'https://example.com/webhook/b',
      clientState: 's2',
      expirationDateTime: new Date(Date.now() + 3600_000),
    });

    const listA = await serviceA.list(tenantA);
    const listB = await serviceB.list(tenantB);
    expect(listA).toHaveLength(1);
    expect(listA[0].tenantId).toBe('tenant-a');
    expect(listB).toHaveLength(1);
    expect(listB[0].tenantId).toBe('tenant-b');
  });

  it('deletes a subscription and removes the persisted record', async () => {
    const { service, repository } = buildService('https://example.com/webhook/');
    const created = await service.create({
      ctx: tenantA,
      resource: '/users/a/messages',
      notificationUrl: 'https://example.com/webhook/a',
      expirationDateTime: new Date(Date.now() + 3600_000),
      clientState: 's1',
    });
    const id = created.value!.subscriptionId;

    const deleted = await service.delete(tenantA, id);
    expect(deleted.success).toBe(true);
    expect(await repository.findBySubscriptionId(tenantA, id)).toBeNull();
  });

  it('returns error deleting unknown subscription', async () => {
    const { service } = buildService();
    const result = await service.delete(tenantA, 'missing-id');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});
