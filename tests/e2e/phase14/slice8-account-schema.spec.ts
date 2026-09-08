/**
 * Slice 8B1a — Account schema migration proof.
 *
 * Proves:
 * - table created with correct columns
 * - FORCE RLS enabled
 * - account_version rejects 0/negative
 * - invalid bounded enum/status rejected
 * - duplicate normalized_domain rejected in same tenant+workspace
 * - same domain allowed in different workspaces
 * - null normalized_domain does not incorrectly collide
 * - cross-tenant ownership rejected by RLS
 *
 * Does NOT test AccountRepository CRUD (that is 8B1b/8B1c).
 */
import { Pool, type PoolClient } from 'pg';
import {
  DEFAULT_ADMIN_DATABASE_URL,
  DEFAULT_APP_DATABASE_URL,
} from './integration-config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getAdminUrl(): string {
  return process.env.ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
}
function getAppUrl(): string {
  return process.env.APP_DATABASE_URL ?? DEFAULT_APP_DATABASE_URL;
}

function parsePgUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: '127.0.0.1',
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username || 'projectx'),
    password: decodeURIComponent(parsed.password || 'projectx'),
    database: (parsed.pathname || '/projectx').slice(1) || 'projectx',
    connectionTimeoutMillis: 5000,
  };
}

let adminPool: Pool;
let appPool: Pool;

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeAll(async () => {
  adminPool = new Pool(parsePgUrl(getAdminUrl()));
  appPool = new Pool(parsePgUrl(getAppUrl()));
  await adminPool.query('SELECT 1');
  await appPool.query('SELECT 1');

  // Ensure test workspace rows exist in identity schema using admin pool
  // (identity tables have RLS but admin role can bypass)
  await adminPool.query(`
    INSERT INTO identity.users (id, email, name, tenant_id)
    VALUES
      ('a0000000-0000-0000-0000-000000000001', 'owner-t1@test.dev', 'Owner T1', 'tenant-s8'),
      ('a0000000-0000-0000-0000-000000000002', 'owner-t2@test.dev', 'Owner T2', 'tenant-s8b')
    ON CONFLICT (id) DO NOTHING;
  `);
  await adminPool.query(`
    INSERT INTO identity.workspaces (id, tenant_id, name, owner_user_id)
    VALUES
      ('b0000000-0000-0000-0000-000000000001', 'tenant-s8',  'WS Alpha', 'a0000000-0000-0000-0000-000000000001'),
      ('b0000000-0000-0000-0000-000000000002', 'tenant-s8',  'WS Beta',  'a0000000-0000-0000-0000-000000000001'),
      ('b0000000-0000-0000-0000-000000000003', 'tenant-s8b', 'WS Gamma', 'a0000000-0000-0000-0000-000000000002')
    ON CONFLICT (id) DO NOTHING;
  `);
});

afterAll(async () => {
  // Clean up test data using admin pool
  await adminPool.query(`DELETE FROM intelligence.accounts WHERE tenant_id IN ('tenant-s8', 'tenant-s8b')`);
  await adminPool.query(`DELETE FROM identity.workspaces WHERE tenant_id IN ('tenant-s8', 'tenant-s8b')`);
  await adminPool.query(`DELETE FROM identity.users WHERE email IN ('owner-t1@test.dev', 'owner-t2@test.dev')`);
  await adminPool.end();
  await appPool.end();
});

/** Execute a query as `projectx_app` with RLS tenant context set. */
async function appQuery(tenantId: string, sql: string, params?: unknown[]) {
  const client = await appPool.connect();
  try {
    await client.query(`SET app.current_tenant = '${tenantId}'`);
    return await client.query(sql, params);
  } finally {
    await client.query(`RESET app.current_tenant`);
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Slice 8B1a — Account schema', () => {
  it('table intelligence.accounts exists with expected columns', async () => {
    const result = await adminPool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'intelligence' AND table_name = 'accounts'
      ORDER BY ordinal_position;
    `);
    const cols = result.rows.map((r: any) => r.column_name);
    expect(cols).toContain('account_id');
    expect(cols).toContain('tenant_id');
    expect(cols).toContain('workspace_id');
    expect(cols).toContain('name');
    expect(cols).toContain('normalized_domain');
    expect(cols).toContain('geography');
    expect(cols).toContain('company_size_band');
    expect(cols).toContain('enrichment_state');
    expect(cols).toContain('status');
    expect(cols).toContain('account_version');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  it('FORCE RLS is enabled on intelligence.accounts', async () => {
    const result = await adminPool.query(`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE oid = 'intelligence.accounts'::regclass;
    `);
    expect(result.rows[0].relrowsecurity).toBe(true);
    expect(result.rows[0].relforcerowsecurity).toBe(true);
  });

  it('rejects account_version = 0', async () => {
    await expect(
      appQuery(
        'tenant-s8',
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, account_version)
         VALUES ('acc-v0', 'tenant-s8', 'b0000000-0000-0000-0000-000000000001', 'Bad Version', 0)`,
      ),
    ).rejects.toThrow(/accounts_version_positive/);
  });

  it('rejects negative account_version', async () => {
    await expect(
      appQuery(
        'tenant-s8',
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, account_version)
         VALUES ('acc-vneg', 'tenant-s8', 'b0000000-0000-0000-0000-000000000001', 'Negative Version', -1)`,
      ),
    ).rejects.toThrow(/accounts_version_positive/);
  });

  it('rejects invalid status', async () => {
    await expect(
      appQuery(
        'tenant-s8',
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, status)
         VALUES ('acc-bad-status', 'tenant-s8', 'b0000000-0000-0000-0000-000000000001', 'Bad Status', 'INVALID')`,
      ),
    ).rejects.toThrow(/accounts_status_check/);
  });

  it('rejects invalid enrichment_state', async () => {
    await expect(
      appQuery(
        'tenant-s8',
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, enrichment_state)
         VALUES ('acc-bad-enrich', 'tenant-s8', 'b0000000-0000-0000-0000-000000000001', 'Bad Enrich', 'MAGIC')`,
      ),
    ).rejects.toThrow(/accounts_enrichment_state_check/);
  });

  it('rejects invalid company_size_band', async () => {
    await expect(
      appQuery(
        'tenant-s8',
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, company_size_band)
         VALUES ('acc-bad-csb', 'tenant-s8', 'b0000000-0000-0000-0000-000000000001', 'Bad Size', 'HUGE')`,
      ),
    ).rejects.toThrow(/accounts_company_size_band_check/);
  });

  it('rejects duplicate normalized_domain in same tenant+workspace', async () => {
    await appQuery(
      'tenant-s8',
      `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain)
       VALUES ('acc-dup1', 'tenant-s8', 'b0000000-0000-0000-0000-000000000001', 'Acme 1', 'acme.com')`,
    );

    await expect(
      appQuery(
        'tenant-s8',
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain)
         VALUES ('acc-dup2', 'tenant-s8', 'b0000000-0000-0000-0000-000000000001', 'Acme 2', 'acme.com')`,
      ),
    ).rejects.toThrow(/accounts_workspace_domain_dedup/);

    // Clean up
    await appQuery('tenant-s8', `DELETE FROM intelligence.accounts WHERE account_id = 'acc-dup1'`);
  });

  it('allows same domain in different workspaces of same tenant', async () => {
    await appQuery(
      'tenant-s8',
      `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain)
       VALUES ('acc-ws1', 'tenant-s8', 'b0000000-0000-0000-0000-000000000001', 'Acme WS1', 'shared.com')`,
    );
    await appQuery(
      'tenant-s8',
      `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain)
       VALUES ('acc-ws2', 'tenant-s8', 'b0000000-0000-0000-0000-000000000002', 'Acme WS2', 'shared.com')`,
    );

    const r = await appQuery(
      'tenant-s8',
      `SELECT account_id FROM intelligence.accounts WHERE normalized_domain = 'shared.com' ORDER BY account_id`,
    );
    expect(r.rows).toHaveLength(2);

    // Clean up
    await appQuery('tenant-s8', `DELETE FROM intelligence.accounts WHERE account_id IN ('acc-ws1', 'acc-ws2')`);
  });

  it('allows multiple NULL normalized_domain accounts in same workspace', async () => {
    await appQuery(
      'tenant-s8',
      `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain)
       VALUES ('acc-null1', 'tenant-s8', 'b0000000-0000-0000-0000-000000000001', 'No Domain 1', NULL)`,
    );
    await appQuery(
      'tenant-s8',
      `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name, normalized_domain)
       VALUES ('acc-null2', 'tenant-s8', 'b0000000-0000-0000-0000-000000000001', 'No Domain 2', NULL)`,
    );

    const r = await appQuery(
      'tenant-s8',
      `SELECT account_id FROM intelligence.accounts WHERE normalized_domain IS NULL ORDER BY account_id`,
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(2);

    // Clean up
    await appQuery('tenant-s8', `DELETE FROM intelligence.accounts WHERE account_id IN ('acc-null1', 'acc-null2')`);
  });

  it('RLS prevents cross-tenant reads', async () => {
    // Insert via tenant-s8
    await appQuery(
      'tenant-s8',
      `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name)
       VALUES ('acc-rls-t1', 'tenant-s8', 'b0000000-0000-0000-0000-000000000001', 'Tenant S8 Account')`,
    );

    // Query as tenant-s8b should not see tenant-s8 rows
    const r = await appQuery(
      'tenant-s8b',
      `SELECT account_id FROM intelligence.accounts WHERE account_id = 'acc-rls-t1'`,
    );
    expect(r.rows).toHaveLength(0);

    // Clean up
    await appQuery('tenant-s8', `DELETE FROM intelligence.accounts WHERE account_id = 'acc-rls-t1'`);
  });

  it('RLS prevents cross-tenant inserts (WITH CHECK)', async () => {
    await expect(
      appQuery(
        'tenant-s8',
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name)
         VALUES ('acc-rls-xins', 'tenant-s8b', 'b0000000-0000-0000-0000-000000000003', 'Wrong Tenant Insert')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('workspace FK rejects non-existent workspace', async () => {
    await expect(
      appQuery(
        'tenant-s8',
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name)
         VALUES ('acc-no-ws', 'tenant-s8', 'c0000000-0000-0000-0000-000000000099', 'No Such Workspace')`,
      ),
    ).rejects.toThrow(/accounts_tenant_workspace_fk|accounts_workspace_id_fkey|violates foreign key/i);
  });

  it('composite FK rejects tenant/workspace ownership mismatch', async () => {
    // Workspace b0000000-...-000000000003 belongs to tenant-s8b.
    // Inserting an account as tenant-s8 with that workspace must fail
    // at the composite FK level, even though the workspace genuinely exists
    // and tenant-s8 is the active RLS tenant.
    //
    // We use the admin pool to bypass RLS for this insert so we can
    // isolate the FK constraint from the RLS WITH CHECK rejection.
    await expect(
      adminPool.query(
        `INSERT INTO intelligence.accounts (account_id, tenant_id, workspace_id, name)
         VALUES ('acc-ownership-bad', 'tenant-s8', 'b0000000-0000-0000-0000-000000000003', 'Mismatched Ownership')`,
      ),
    ).rejects.toThrow(/accounts_tenant_workspace_fk|violates foreign key/i);
  });
});
