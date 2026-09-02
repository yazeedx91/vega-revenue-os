import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import { PostgresClient } from '@projectx/infrastructure';
import { PostgresIdentityRepository } from '../infrastructure/postgres-identity-repository';

const APP_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://projectx_app:projectx_app@127.0.0.1:5433/projectx';
const ADMIN_DATABASE_URL =
  process.env.ADMIN_DATABASE_URL ??
  (process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/projectx_app/g, 'projectx') : undefined) ??
  'postgresql://projectx:projectx@127.0.0.1:5433/projectx';

async function isReachable(connectionString: string): Promise<boolean> {
  let pool: Pool | undefined;
  try {
    pool = new Pool({
      ...parseConnectionString(connectionString),
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

function parseConnectionString(connectionString: string) {
  const parsed = new URL(connectionString);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    database: (parsed.pathname || '/').slice(1) || 'projectx',
  };
}

describe('PostgreSQL identity RLS and SECURITY DEFINER proof', () => {
  let pool: Pool;
  let client: PostgresClient;
  let repository: PostgresIdentityRepository;
  let adminPool: Pool;

  beforeAll(async () => {
    if (!(await isReachable(APP_DATABASE_URL))) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping identity RLS proof: ${APP_DATABASE_URL} is unreachable`);
      return;
    }

    adminPool = new Pool(parseConnectionString(ADMIN_DATABASE_URL));
    pool = new Pool({
      ...parseConnectionString(APP_DATABASE_URL),
      connectionTimeoutMillis: 2000,
    });
    client = new PostgresClient(pool);
    repository = new PostgresIdentityRepository({ pool });

    // Clean slate for this proof; only the admin can truncate identity tables.
    await adminPool.query('TRUNCATE identity.workspaces, identity.memberships, identity.users CASCADE');
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await adminPool?.end();
  });

  it('projectx_app is NOSUPERUSER and NOBYPASSRLS', async () => {
    if (!adminPool) return;
    const result = await adminPool.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'projectx_app'`,
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].rolsuper).toBe(false);
    expect(result.rows[0].rolbypassrls).toBe(false);
  });

  it('identity workspaces and memberships have FORCE ROW LEVEL SECURITY', async () => {
    if (!adminPool) return;
    const result = await adminPool.query(
      `SELECT relname, relforcerowsecurity, relrowsecurity
       FROM pg_class
       WHERE relnamespace = 'identity'::regnamespace
         AND relname IN ('workspaces', 'memberships')`,
    );
    const workspaces = result.rows.find((r) => r.relname === 'workspaces');
    const memberships = result.rows.find((r) => r.relname === 'memberships');
    expect(workspaces).toBeDefined();
    expect(workspaces.relrowsecurity).toBe(true);
    expect(workspaces.relforcerowsecurity).toBe(true);
    expect(memberships).toBeDefined();
    expect(memberships.relrowsecurity).toBe(true);
    expect(memberships.relforcerowsecurity).toBe(true);
  });

  it('SECURITY DEFINER workspace-listing function is hardened', async () => {
    if (!adminPool) return;
    const proc = await adminPool.query(
      `SELECT
         n.nspname || '.' || p.proname AS name,
         p.prosecdef,
         p.proconfig,
         pg_get_functiondef(p.oid) AS def,
         rol.rolname AS owner
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_roles rol ON rol.oid = p.proowner
       WHERE n.nspname = 'identity' AND p.proname = 'list_workspaces_for_user'`,
    );
    expect(proc.rows.length).toBe(1);
    expect(proc.rows[0].prosecdef).toBe(true);
    expect(proc.rows[0].owner).toBe('projectx_security_owner');
    expect(proc.rows[0].def).toContain("SET search_path");

    const grants = await adminPool.query(
      `SELECT grantee, privilege_type
       FROM information_schema.routine_privileges
       WHERE routine_schema = 'identity' AND routine_name = 'list_workspaces_for_user'`,
    );
    const publicGrant = grants.rows.find((r) => r.grantee === 'PUBLIC');
    const appGrant = grants.rows.find((r) => r.grantee === 'projectx_app');
    expect(publicGrant).toBeUndefined();
    expect(appGrant).toBeDefined();
    expect(appGrant.privilege_type).toBe('EXECUTE');
  });

  it('tenant A cannot read or mutate tenant B records', async () => {
    if (!repository) return;
    const aId = randomUUID();
    const bId = randomUUID();
    const userA = await repository.upsertUser({ id: aId, email: 'a@tenant-a.test', name: 'A' });
    const userB = await repository.upsertUser({ id: bId, email: 'b@tenant-b.test', name: 'B' });

    const workspaceA = await repository.createWorkspace('Workspace A', userA.id);
    const workspaceB = await repository.createWorkspace('Workspace B', userB.id);
    const tenantA = asTenantId(aId);
    const tenantB = asTenantId(bId);

    // A cannot see B's workspace.
    const aSeesB = await repository.findWorkspaceById(workspaceB.id, tenantB);
    expect(aSeesB).not.toBeNull(); // sanity: B can see B

    const aCannotSeeB = await repository.findWorkspaceById(workspaceB.id, tenantA);
    expect(aCannotSeeB).toBeNull();

    // A cannot list B's members.
    const aMembersOfB = await repository.listMembers(workspaceB.id, tenantA);
    expect(aMembersOfB.members.length).toBe(0);

    // A cannot update B's workspace.
    await client.withTenant(
      { tenantId: tenantA, correlationId: asCorrelationId('rls-proof') },
      async (db) => {
        const update = await db.query(
          `UPDATE identity.workspaces SET name = 'hacked' WHERE id = $1::UUID`,
          [workspaceB.id],
        );
        expect(update.rowCount).toBe(0);
      },
    );

    const bStillIntact = await repository.findWorkspaceById(workspaceB.id, tenantB);
    expect(bStillIntact?.name).toBe('Workspace B');

    // A cannot delete B's workspace.
    await client.withTenant(
      { tenantId: tenantA, correlationId: asCorrelationId('rls-proof') },
      async (db) => {
        const del = await db.query(`DELETE FROM identity.workspaces WHERE id = $1::UUID`, [workspaceB.id]);
        expect(del.rowCount).toBe(0);
      },
    );

    const bStillThere = await repository.findWorkspaceById(workspaceB.id, tenantB);
    expect(bStillThere).not.toBeNull();
  });

  it('unauthenticated queries without tenant context see no tenant records', async () => {
    if (!pool) return;
    // The pool may have a tenant context set from the previous test; clear it explicitly.
    await pool.query(`SELECT set_config('app.current_tenant', '', false)`);

    const ws = await pool.query(`SELECT id FROM identity.workspaces`);
    const ms = await pool.query(`SELECT workspace_id FROM identity.memberships`);
    expect(ws.rowCount).toBe(0);
    expect(ms.rowCount).toBe(0);

    // After restoring the tenant context, the previous rows are visible again.
    const sample = await adminPool.query(`SELECT tenant_id FROM identity.workspaces LIMIT 1`);
    const aTenantId = sample.rows[0]?.tenant_id ?? '';
    await pool.query(`SELECT set_config('app.current_tenant', $1, false)`, [aTenantId]);
    const wsA = await pool.query(`SELECT id FROM identity.workspaces`);
    expect(wsA.rowCount).toBeGreaterThan(0);
  });

  it('listWorkspacesForUser returns only workspaces owned by the caller user', async () => {
    if (!repository) return;
    const aId = randomUUID();
    const bId = randomUUID();
    await repository.upsertUser({ id: aId, email: 'alice-list@example.com', name: 'Alice List' });
    await repository.upsertUser({ id: bId, email: 'bob-list@example.com', name: 'Bob List' });
    const wsA = await repository.createWorkspace('List Workspace A', aId);
    const wsB = await repository.createWorkspace('List Workspace B', bId);

    const userAWorkspaces = await repository.listWorkspacesForUser(aId);
    const userBWorkspaces = await repository.listWorkspacesForUser(bId);

    expect(userAWorkspaces.map((w) => w.name)).toEqual([wsA.name]);
    expect(userBWorkspaces.map((w) => w.name)).toEqual([wsB.name]);
  });
});
