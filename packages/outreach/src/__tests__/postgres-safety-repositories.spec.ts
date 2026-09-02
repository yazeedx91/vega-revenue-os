import type { Pool } from 'pg';
import { FakePgPool } from '@projectx/infrastructure';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import { PostgresRecipientAllowlistRepository } from '../infrastructure/postgres-recipient-allowlist-repository';
import { PostgresSuppressionRepository } from '../infrastructure/postgres-suppression-repository';

describe('PostgresRecipientAllowlistRepository', () => {
  const tenantId = asTenantId('tenant-1');
  const ctx = { tenantId, correlationId: asCorrelationId('corr-1') };

  function makeRepo() {
    return new PostgresRecipientAllowlistRepository({ pool: new FakePgPool() as unknown as Pool });
  }

  it('denies by default when no allowlist entry exists', async () => {
    const repo = makeRepo();
    expect(await repo.isAllowed(ctx, 'email', 'nobody@example.com')).toBe(false);
  });

  it('allows an exact-match address after being added, and is tenant-scoped', async () => {
    const repo = makeRepo();
    await repo.add(ctx, { channel: 'email', address: 'a@b.com', approvedBy: 'admin-1', reason: 'known contact' });

    expect(await repo.isAllowed(ctx, 'email', 'a@b.com')).toBe(true);
    expect(await repo.isAllowed(ctx, 'email', 'other@b.com')).toBe(false);

    const otherTenantCtx = { tenantId: asTenantId('tenant-2'), correlationId: asCorrelationId('c2') };
    expect(await repo.isAllowed(otherTenantCtx, 'email', 'a@b.com')).toBe(false);
  });

  it('remove() revokes a previously allowed address', async () => {
    const repo = makeRepo();
    await repo.add(ctx, { channel: 'email', address: 'a@b.com', approvedBy: 'admin-1' });
    expect(await repo.isAllowed(ctx, 'email', 'a@b.com')).toBe(true);

    await repo.remove(ctx, 'email', 'a@b.com');
    expect(await repo.isAllowed(ctx, 'email', 'a@b.com')).toBe(false);
  });

  it('list() returns all tenant entries', async () => {
    const repo = makeRepo();
    await repo.add(ctx, { channel: 'email', address: 'a@b.com', approvedBy: 'admin-1' });
    await repo.add(ctx, { channel: 'email', address: 'c@d.com', approvedBy: 'admin-1' });

    const entries = await repo.list(ctx);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.address).sort()).toEqual(['a@b.com', 'c@d.com']);
  });
});

describe('PostgresSuppressionRepository', () => {
  const tenantId = asTenantId('tenant-1');
  const ctx = { tenantId, correlationId: asCorrelationId('corr-1') };

  function makeRepo() {
    return new PostgresSuppressionRepository({ pool: new FakePgPool() as unknown as Pool });
  }

  it('returns null when an address is not suppressed', async () => {
    const repo = makeRepo();
    expect(await repo.isSuppressed(ctx, 'a@b.com')).toBeNull();
  });

  it('records and retrieves a suppression, tenant-scoped', async () => {
    const repo = makeRepo();
    await repo.suppress(ctx, 'a@b.com', 'OPT_OUT', 'conversation-reply-handler', 'asked to stop');

    const record = await repo.isSuppressed(ctx, 'a@b.com');
    expect(record).not.toBeNull();
    expect(record!.suppressionType).toBe('OPT_OUT');
    expect(record!.source).toBe('conversation-reply-handler');
    expect(record!.createdAt).toBeInstanceOf(Date);

    const otherTenantCtx = { tenantId: asTenantId('tenant-2'), correlationId: asCorrelationId('c2') };
    expect(await repo.isSuppressed(otherTenantCtx, 'a@b.com')).toBeNull();
  });

  it('supports all required suppression types', async () => {
    const repo = makeRepo();
    for (const type of ['MANUAL', 'OPT_OUT', 'UNSUBSCRIBE', 'BOUNCE', 'ADMINISTRATIVE'] as const) {
      await repo.suppress(ctx, `${type.toLowerCase()}@example.com`, type, 'test-source');
      const record = await repo.isSuppressed(ctx, `${type.toLowerCase()}@example.com`);
      expect(record?.suppressionType).toBe(type);
    }
  });

  it('list() returns all tenant suppression records', async () => {
    const repo = makeRepo();
    await repo.suppress(ctx, 'a@b.com', 'MANUAL', 'admin');
    await repo.suppress(ctx, 'c@d.com', 'BOUNCE', 'provider-webhook');

    const records = await repo.list(ctx);
    expect(records).toHaveLength(2);
  });
});
