import type { Pool } from 'pg';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import type { TenantContext } from '@projectx/domain';
import { FakePgPool } from '../testing/fake-pg-pool';
import { PostgresClient } from '../persistence/postgres-client';

function ctxFor(tenantId: string): TenantContext {
  return { tenantId: asTenantId(tenantId), correlationId: asCorrelationId('corr-1') };
}

describe('PostgresClient tenant context safety', () => {
  it('sets tenant context via a parameterized set_config call, not string interpolation', async () => {
    const pool = new FakePgPool();
    const client = new PostgresClient(pool as unknown as Pool);

    await client.withTenant(ctxFor('tenant-1'), async () => undefined);

    const setConfigCall = pool.recordedQueries.find((q) => q.sql.includes('set_config'));
    expect(setConfigCall).toBeDefined();
    expect(setConfigCall!.sql).toContain('$1');
    expect(setConfigCall!.sql).not.toContain('tenant-1');
    expect(setConfigCall!.params).toEqual(['tenant-1']);
  });

  it('binds a SQL-metacharacter-shaped tenant id as a parameter without altering query structure', async () => {
    const pool = new FakePgPool();
    const client = new PostgresClient(pool as unknown as Pool);
    const maliciousTenantId = "tenant-1'; DROP TABLE outreach.campaigns; --";

    await client.withTenant(ctxFor(maliciousTenantId), async () => undefined);

    const setConfigCall = pool.recordedQueries.find((q) => q.sql.includes('set_config'));
    expect(setConfigCall).toBeDefined();
    // The malicious string must appear only as a bound parameter, never inside the SQL text.
    expect(setConfigCall!.sql).not.toContain('DROP TABLE');
    expect(setConfigCall!.sql).not.toContain(maliciousTenantId);
    expect(setConfigCall!.params).toEqual([maliciousTenantId]);
  });

  it('sets tenant context inside transactions the same parameterized way', async () => {
    const pool = new FakePgPool();
    const client = new PostgresClient(pool as unknown as Pool);

    await client.transaction(ctxFor('tenant-2'), async () => undefined);

    const setConfigCall = pool.recordedQueries.find((q) => q.sql.includes('set_config'));
    expect(setConfigCall).toBeDefined();
    expect(setConfigCall!.params).toEqual(['tenant-2']);
  });
});
