import type { Pool } from 'pg';
import { FakePgPool } from '@projectx/infrastructure';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import { PostgresGraphSubscriptionRepository } from '../infrastructure/postgres-graph-subscription-repository';

describe('PostgresGraphSubscriptionRepository', () => {
  const tenantId = asTenantId('tenant-1');
  const ctx = { tenantId, correlationId: asCorrelationId('corr-1') };

  function makeRepo() {
    return new PostgresGraphSubscriptionRepository({ pool: new FakePgPool() as unknown as Pool });
  }

  it('saves and retrieves a subscription by tenant and id', async () => {
    const repo = makeRepo();
    const expiration = new Date('2026-12-31T23:59:59Z');
    await repo.save(ctx, {
      tenantId: tenantId as string,
      subscriptionId: 'sub-1',
      resource: '/users/mailbox@example.com/messages',
      notificationUrl: 'https://example.com/webhook',
      clientState: 'client-state',
      expirationDateTime: expiration,
    });

    const found = await repo.findBySubscriptionId(ctx, 'sub-1');
    expect(found).not.toBeNull();
    expect(found!.subscriptionId).toBe('sub-1');
    expect(found!.tenantId).toBe(tenantId);
  });

  it('lists subscriptions scoped to the tenant', async () => {
    const repo = makeRepo();
    const otherTenantCtx = { tenantId: asTenantId('tenant-2'), correlationId: asCorrelationId('corr-2') };

    await repo.save(ctx, {
      tenantId: tenantId as string,
      subscriptionId: 'sub-a',
      resource: '/users/a/messages',
      notificationUrl: 'https://example.com/a',
      clientState: 'state-a',
      expirationDateTime: new Date('2026-12-31T23:59:59Z'),
    });
    await repo.save(otherTenantCtx, {
      tenantId: 'tenant-2',
      subscriptionId: 'sub-b',
      resource: '/users/b/messages',
      notificationUrl: 'https://example.com/b',
      clientState: 'state-b',
      expirationDateTime: new Date('2026-12-31T23:59:59Z'),
    });

    const listA = await repo.findByTenant(ctx);
    expect(listA).toHaveLength(1);
    expect(listA[0].subscriptionId).toBe('sub-a');
  });

  it('deletes a subscription scoped to the tenant', async () => {
    const repo = makeRepo();
    await repo.save(ctx, {
      tenantId: tenantId as string,
      subscriptionId: 'sub-del',
      resource: '/users/a/messages',
      notificationUrl: 'https://example.com/a',
      clientState: 'state',
      expirationDateTime: new Date('2026-12-31T23:59:59Z'),
    });
    expect(await repo.findBySubscriptionId(ctx, 'sub-del')).not.toBeNull();

    await repo.delete(ctx, 'sub-del');
    expect(await repo.findBySubscriptionId(ctx, 'sub-del')).toBeNull();
  });
});
