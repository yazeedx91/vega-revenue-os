import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import {
  DEFAULT_ADMIN_DATABASE_URL,
  DEFAULT_APP_DATABASE_URL,
} from '../../../../tests/e2e/phase14/integration-config';

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

function databaseUrlForName(baseUrl: string, databaseName: string): string {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

describe('004/005 projectx_security_owner regression', () => {
  const baseAdminUrl = process.env.ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
  const baseAppUrl = process.env.APP_DATABASE_URL ?? DEFAULT_APP_DATABASE_URL;
  const testDbName = `projectx_004_test_${randomUUID().replace(/-/g, '_')}`;
  const adminUrl = databaseUrlForName(baseAdminUrl, testDbName);
  const appUrl = databaseUrlForName(baseAppUrl, testDbName);

  let setupPool: Pool | undefined;
  let adminPool: Pool | undefined;
  let appPool: Pool | undefined;
  let reachable = false;

  beforeAll(async () => {
    reachable = await isReachable(baseAdminUrl);
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping migration 004 regression tests: ${baseAdminUrl} unreachable`);
      return;
    }

    setupPool = new Pool({
      host: '127.0.0.1',
      port: Number(new URL(baseAdminUrl).port || 5432),
      user: decodeURIComponent(new URL(baseAdminUrl).username || 'projectx'),
      password: decodeURIComponent(new URL(baseAdminUrl).password || 'projectx'),
      database: (new URL(baseAdminUrl).pathname || '/projectx').slice(1) || 'projectx',
    });

    await setupPool.query(`DROP DATABASE IF EXISTS ${testDbName}`);
    await setupPool.query(`CREATE DATABASE ${testDbName}`);

    await runMigrations(adminUrl);

    adminPool = new Pool({
      host: '127.0.0.1',
      port: Number(new URL(adminUrl).port || 5432),
      user: decodeURIComponent(new URL(adminUrl).username || 'projectx'),
      password: decodeURIComponent(new URL(adminUrl).password || 'projectx'),
      database: testDbName,
    });

    appPool = new Pool({
      host: '127.0.0.1',
      port: Number(new URL(appUrl).port || 5432),
      user: decodeURIComponent(new URL(appUrl).username || 'projectx_app'),
      password: decodeURIComponent(new URL(appUrl).password || 'projectx_app'),
      database: testDbName,
    });
  }, 120_000);

  afterAll(async () => {
    await appPool?.end();
    await adminPool?.end();
    if (setupPool && reachable) {
      await setupPool.query(`DROP DATABASE IF EXISTS ${testDbName}`);
      await setupPool.end();
    }
  });

  it('projectx_security_owner owns outreach.resolve_inbound_mailbox and does not retain CREATE on outreach', async () => {
    if (!adminPool) return;

    const ownerResult = await adminPool.query<{ owner: string }>(`
      SELECT r.rolname AS owner
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN pg_roles r ON p.proowner = r.oid
      WHERE n.nspname = 'outreach' AND p.proname = 'resolve_inbound_mailbox'
    `);
    expect(ownerResult.rows).toHaveLength(1);
    expect(ownerResult.rows[0].owner).toBe('projectx_security_owner');

    const createPrivResult = await adminPool.query<{ has_create: boolean }>(`
      SELECT has_schema_privilege('projectx_security_owner', 'outreach', 'CREATE') AS has_create
    `);
    expect(createPrivResult.rows[0].has_create).toBe(false);
  });

  it('projectx_app cannot directly read outreach.inbound_mailbox_registry', async () => {
    if (!appPool) return;
    await expect(appPool.query('SELECT * FROM outreach.inbound_mailbox_registry')).rejects.toThrow();
  });

  it('projectx_app can execute the resolver', async () => {
    if (!appPool) return;
    const result = await appPool.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM outreach.resolve_inbound_mailbox($1)',
      ['nonexistent@example.com'],
    );
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it('projectx_security_owner owns identity.list_workspaces_for_user and does not retain CREATE on identity', async () => {
    if (!adminPool) return;

    const ownerResult = await adminPool.query<{ owner: string }>(`
      SELECT r.rolname AS owner
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN pg_roles r ON p.proowner = r.oid
      WHERE n.nspname = 'identity' AND p.proname = 'list_workspaces_for_user'
    `);
    expect(ownerResult.rows).toHaveLength(1);
    expect(ownerResult.rows[0].owner).toBe('projectx_security_owner');

    const createPrivResult = await adminPool.query<{ has_create: boolean }>(`
      SELECT has_schema_privilege('projectx_security_owner', 'identity', 'CREATE') AS has_create
    `);
    expect(createPrivResult.rows[0].has_create).toBe(false);
  });

  it('projectx_app can execute identity.list_workspaces_for_user', async () => {
    if (!appPool) return;
    const result = await appPool.query<{ id: string }>(
      'SELECT id FROM identity.list_workspaces_for_user($1)',
      [randomUUID()],
    );
    expect(Array.isArray(result.rows)).toBe(true);
  });
});
