import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import {
  DEFAULT_ADMIN_DATABASE_URL,
  getAdminDatabaseUrl,
  getAppDatabaseUrl,
} from '../../../../tests/e2e/phase14/integration-config';
import { PostgresClient } from '../persistence/postgres-client';
import { ConcurrencyConflictError } from '../persistence/concurrency-conflict.error';

async function runMigrations(connectionString: string): Promise<void> {
  const { main } = await import('../../../../infra/database/migrations/run');
  process.env.DATABASE_URL = connectionString;
  await main();
}

async function isReachable(connectionString: string): Promise<boolean> {
  let pool: Pool | undefined;
  try {
    const parsed = new URL(connectionString);
    pool = new Pool({
      host: '127.0.0.1',
      port: Number(parsed.port || 5432),
      user: decodeURIComponent(parsed.username || 'projectx'),
      password: decodeURIComponent(parsed.password || 'projectx'),
      database: (parsed.pathname || '/projectx').slice(1) || 'projectx',
      connectionTimeoutMillis: 2000,
    });
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool?.end();
  }
}

describe('PostgreSQL integration acceptance', () => {
  let pool: Pool;
  let client: PostgresClient;
  let adminPool: Pool;

  beforeAll(async () => {
    // Always run migrations as the admin user, not the runtime app role.
    process.env.ADMIN_DATABASE_URL = DEFAULT_ADMIN_DATABASE_URL;
    const appConnectionString = getAppDatabaseUrl();
    const adminConnectionString = getAdminDatabaseUrl();
    if (!(await isReachable(adminConnectionString))) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping PostgreSQL acceptance tests: ${adminConnectionString} unreachable`);
      return;
    }

    await runMigrations(adminConnectionString);

    const adminParsed = new URL(adminConnectionString);
    adminPool = new Pool({
      host: '127.0.0.1',
      port: Number(adminParsed.port || 5432),
      user: decodeURIComponent(adminParsed.username || 'projectx'),
      password: decodeURIComponent(adminParsed.password || 'projectx'),
      database: (adminParsed.pathname || '/projectx').slice(1) || 'projectx',
    });
    await adminPool.query('TRUNCATE TABLE outreach.allowed_recipients');

    const parsed = new URL(appConnectionString);
    pool = new Pool({
      host: '127.0.0.1',
      port: Number(parsed.port || 5432),
      user: decodeURIComponent(parsed.username || 'projectx_app'),
      password: decodeURIComponent(parsed.password || 'projectx_app'),
      database: (parsed.pathname || '/projectx').slice(1) || 'projectx',
    });
    client = new PostgresClient(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await adminPool?.end();
  });

  function ctx(tenantId: string) {
    return { tenantId: asTenantId(tenantId), correlationId: asCorrelationId('acceptance-test') };
  }

  it('applied migrations create required schemas and extensions', async () => {
    if (!pool) return;
    const schemas = await pool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1)`, [
      ['outreach', 'conversation', 'mission', 'audit', 'idempotency', 'intelligence'],
    ]);
    const names = schemas.rows.map((r) => r.schema_name);
    expect(names).toContain('outreach');
    expect(names).toContain('conversation');
    expect(names).toContain('mission');
    expect(names).toContain('audit');
    expect(names).toContain('idempotency');
    expect(names).toContain('intelligence');

    const ext = await pool.query(`SELECT extname FROM pg_extension WHERE extname = $1`, ['uuid-ossp']);
    expect(ext.rowCount).toBeGreaterThan(0);
  });

  it('sets tenant context as a parameter and defends against SQL injection', async () => {
    if (!pool) return;
    const malicious = "tenant-1'; DROP TABLE outreach.campaigns; --";
    const logs: string[] = [];
    await client.withTenant(ctx(malicious), async (db) => {
      const result = await db.query(`SELECT current_setting('app.current_tenant', TRUE) AS tenant`);
      logs.push(result.rows[0].tenant);
    });
    expect(logs[0]).toBe(malicious);

    // The malicious tenant string must not appear in any executed SQL text.
    const sqlText = await pool.query(`SELECT query FROM pg_stat_activity WHERE state = 'active'`);
    const dangerous = sqlText.rows.find((r) => typeof r.query === 'string' && r.query.includes('DROP TABLE'));
    expect(dangerous).toBeUndefined();
  });

  it('RLS isolates outreach.allowed_recipients between tenants', async () => {
    if (!pool) return;
    const tenantA = `tenant-a-${randomUUID()}`;
    const tenantB = `tenant-b-${randomUUID()}`;

    await client.withTenant(ctx(tenantA), async (db) => {
      await db.query(
        `INSERT INTO outreach.allowed_recipients (tenant_id, email_address, approved_by) VALUES ($1, $2, $3)`,
        [tenantA, 'alice@example.com', 'admin'],
      );
    });

    const aResult = await client.withTenant(ctx(tenantA), async (db) =>
      db.query(`SELECT email_address FROM outreach.allowed_recipients`),
    );
    expect(aResult.rows).toHaveLength(1);
    expect(aResult.rows[0].email_address).toBe('alice@example.com');

    const bResult = await client.withTenant(ctx(tenantB), async (db) =>
      db.query(`SELECT email_address FROM outreach.allowed_recipients`),
    );
    expect(bResult.rows).toHaveLength(0);
  });

  it('transactions roll back on error and do not leave partial writes', async () => {
    if (!pool) return;
    const id = `tx-test-${Date.now()}`;
    await expect(
      client.transaction(ctx('tenant-tx'), async (db) => {
        await db.query(
          `INSERT INTO outreach.campaigns (tenant_id, id, payload, version) VALUES ($1, $2, $3, $4)`,
          ['tenant-tx', id, JSON.stringify({ id, tenantId: 'tenant-tx', status: 'draft' }), 0],
        );
        throw new Error('forced failure');
      }),
    ).rejects.toThrow('forced failure');

    const found = await client.withTenant(ctx('tenant-tx'), async (db) =>
      db.query(`SELECT 1 FROM outreach.campaigns WHERE id = $1`, [id]),
    );
    expect(found.rowCount).toBe(0);
  });

  it('idempotency keys are scoped per tenant', async () => {
    if (!pool) return;
    const key = `idem-${Date.now()}`;
    await client.transaction(ctx('tenant-i1'), async (db) => {
      await db.query(
        `INSERT INTO idempotency.keys (tenant_id, key, scope, status, expires_at) VALUES ($1, $2, $3, $4, NOW() + interval '1 hour')`,
        ['tenant-i1', key, 'send', 'COMPLETED'],
      );
    });

    // Same key for a different tenant is allowed.
    await expect(
      client.transaction(ctx('tenant-i2'), async (db) => {
        await db.query(
          `INSERT INTO idempotency.keys (tenant_id, key, scope, status, expires_at) VALUES ($1, $2, $3, $4, NOW() + interval '1 hour')`,
          ['tenant-i2', key, 'send', 'COMPLETED'],
        );
      }),
    ).resolves.toBeUndefined();

    // Duplicate key for the same tenant violates the primary key.
    await expect(
      client.transaction(ctx('tenant-i1'), async (db) => {
        await db.query(
          `INSERT INTO idempotency.keys (tenant_id, key, scope, status, expires_at) VALUES ($1, $2, $3, $4, NOW() + interval '1 hour')`,
          ['tenant-i1', key, 'send', 'COMPLETED'],
        );
      }),
    ).rejects.toThrow();
  });

  it.skip('optimistic concurrency detects stale updates', async () => {
    if (!pool) return;
    const id = `occ-${Date.now()}`;
    const initialPayload = JSON.stringify({ id, tenantId: 'tenant-occ', status: 'draft' });
    await client.withTenant(ctx('tenant-occ'), async (db) => {
      await db.query(
        `INSERT INTO outreach.campaigns (tenant_id, id, payload, version) VALUES ($1, $2, $3, $4)`,
        ['tenant-occ', id, initialPayload, 0],
      );
    });

    const tx1 = client.transaction(ctx('tenant-occ'), async (db) => {
      await db.query(`UPDATE outreach.campaigns SET payload = payload || $1, version = 1 WHERE tenant_id = $2 AND id = $3 AND version = 0`, [
        JSON.stringify({ status: 'active' }),
        'tenant-occ',
        id,
      ]);
    });

    const tx2 = client.transaction(ctx('tenant-occ'), async (db) => {
      const result = await db.query(
        `UPDATE outreach.campaigns SET payload = payload || $1, version = 1 WHERE tenant_id = $2 AND id = $3 AND version = 0`,
        [JSON.stringify({ status: 'archived' }), 'tenant-occ', id],
      );
      if (result.rowCount === 0) {
        throw new ConcurrencyConflictError('Concurrent update conflict', 'tenant-occ', id, 0);
      }
    });

    await expect(Promise.all([tx1, tx2])).rejects.toThrow();

    const finalVersion = await client.withTenant(ctx('tenant-occ'), async (db) => {
      return db.query(`SELECT version FROM outreach.campaigns WHERE tenant_id = $1 AND id = $2`, ['tenant-occ', id]);
    });
    expect(finalVersion.rows[0].version).toBe(1);
  });

  it('RLS isolates mission.missions between tenants', async () => {
    if (!pool) return;
    const tenantA = `tenant-mission-a-${randomUUID()}`;
    const tenantB = `tenant-mission-b-${randomUUID()}`;
    const id = randomUUID();

    await client.withTenant(ctx(tenantA), async (db) => {
      await db.query(
        `INSERT INTO mission.missions
         (id, tenant_id, owner_user_id, name, objective, icp_id, territory, channels,
          budget, autonomy_level, constraints, success_criteria, status,
          current_plan_version, outcomes, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          id,
          tenantA,
          randomUUID(),
          'Mission A',
          'objective A',
          'icp-1',
          [],
          [],
          '{}',
          0,
          '{}',
          '{}',
          'DRAFT',
          0,
          '{}',
          1,
        ],
      );
    });

    const aResult = await client.withTenant(ctx(tenantA), async (db) =>
      db.query(`SELECT name FROM mission.missions WHERE id = $1`, [id]),
    );
    expect(aResult.rows).toHaveLength(1);
    expect(aResult.rows[0].name).toBe('Mission A');

    const bResult = await client.withTenant(ctx(tenantB), async (db) =>
      db.query(`SELECT name FROM mission.missions WHERE id = $1`, [id]),
    );
    expect(bResult.rows).toHaveLength(0);
  });
});
