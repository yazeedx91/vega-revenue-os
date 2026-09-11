import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { applyMigration } from '../../../infra/database/migrations/run';

const rootUrl = process.env.ADMIN_DATABASE_URL ?? 'postgresql://projectx:projectx@127.0.0.1:5433/postgres';
const migrations = resolve(__dirname, '../../../infra/database/migrations');
const tenant = 'migration-037-tenant';
const workspaceA = '50000000-0000-4000-8000-000000000001';
const workspaceB = '50000000-0000-4000-8000-000000000002';
const missionA = '51000000-0000-4000-8000-000000000001';
let database: string;
let client: Client;

async function mission(id: string, workspaceId: string | null, binding: string | null): Promise<void> {
  await client.query(
    'INSERT INTO mission.missions(id,tenant_id,workspace_id,workspace_binding_state,owner_user_id,name,objective,icp_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, tenant, workspaceId, binding, '52000000-0000-4000-8000-000000000001', 'Mission', 'Objective', 'icp', 'DRAFT'],
  );
}

beforeAll(async () => {
  database = `projectx_037_${randomUUID().replace(/-/g, '')}`;
  const root = new Client({ connectionString: rootUrl }); await root.connect(); await root.query(`CREATE DATABASE ${database}`); await root.end();
  const url = new URL(rootUrl); url.pathname = `/${database}`; client = new Client({ connectionString: url.toString() }); await client.connect();
  await client.query('CREATE TABLE schema_migrations(filename TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const files = readdirSync(migrations).filter((file) => file.endsWith('.sql')).sort().filter((file) => file < '037_mission_approval_workspace_ownership.sql');
  for (const file of files) await applyMigration(client, file, readFileSync(resolve(migrations, file), 'utf8'));
  await client.query('INSERT INTO identity.users(id,email,tenant_id) VALUES($1,$2,$3)', ['52000000-0000-4000-8000-000000000001', 'migration-037@example.test', tenant]);
  await client.query('INSERT INTO identity.workspaces(id,tenant_id,name,owner_user_id) VALUES($1,$2,$3,$4),($5,$2,$6,$4)', [workspaceA, tenant, 'A', '52000000-0000-4000-8000-000000000001', workspaceB, 'B']);
  await client.query("INSERT INTO mission.missions(id,tenant_id,owner_user_id,name,objective,icp_id,status) VALUES('53000000-0000-4000-8000-000000000001',$1,$2,'Legacy','Objective','icp','DRAFT')", [tenant, '52000000-0000-4000-8000-000000000001']);
  await client.query("INSERT INTO mission.approvals(tenant_id,id,payload) VALUES($1,'legacy-approval',$2)", [tenant, JSON.stringify({ missionId: '53000000-0000-4000-8000-000000000001' })]);
  await applyMigration(client, '037_mission_approval_workspace_ownership.sql', readFileSync(resolve(migrations, '037_mission_approval_workspace_ownership.sql'), 'utf8'));
}, 180_000);

afterAll(async () => {
  await client?.end(); const root = new Client({ connectionString: rootUrl }); await root.connect();
  await root.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]); await root.query(`DROP DATABASE IF EXISTS ${database}`); await root.end();
}, 60_000);

describe('migration 037 Mission and Approval workspace ownership', () => {
  it('normalizes ambiguous legacy Mission and its Approval to LEGACY_UNBOUND without guessing', async () => {
    expect((await client.query("SELECT workspace_id,workspace_binding_state FROM mission.missions WHERE name='Legacy'")).rows[0]).toEqual({ workspace_id: null, workspace_binding_state: 'LEGACY_UNBOUND' });
    expect((await client.query("SELECT workspace_id,workspace_binding_state FROM mission.approvals WHERE id='legacy-approval'")).rows[0]).toEqual({ workspace_id: null, workspace_binding_state: 'LEGACY_UNBOUND' });
  });

  it('rejects a new Mission without workspace ownership', async () => {
    await expect(mission('51000000-0000-4000-8000-000000000010', null, 'LEGACY_UNBOUND')).rejects.toThrow();
  });

  it('rejects invalid tenant/workspace ownership', async () => {
    await expect(mission('51000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000099', 'WORKSPACE_BOUND')).rejects.toThrow();
  });

  it('rejects Mission workspace relocation', async () => {
    await mission(missionA, workspaceA, 'WORKSPACE_BOUND');
    await expect(client.query('UPDATE mission.missions SET workspace_id=$1 WHERE id=$2', [workspaceB, missionA])).rejects.toThrow();
  });

  it('accepts Approval only in its parent Mission workspace', async () => {
    await expect(client.query("INSERT INTO mission.approvals(tenant_id,workspace_id,workspace_binding_state,mission_id,id,payload) VALUES($1,$2,'WORKSPACE_BOUND',$3,'approval-a',$4)", [tenant, workspaceA, missionA, JSON.stringify({ missionId: missionA })])).resolves.not.toThrow();
  });

  it('rejects Approval workspace different from parent Mission', async () => {
    await expect(client.query("INSERT INTO mission.approvals(tenant_id,workspace_id,workspace_binding_state,mission_id,id,payload) VALUES($1,$2,'WORKSPACE_BOUND',$3,'approval-wrong',$4)", [tenant, workspaceB, missionA, JSON.stringify({ missionId: missionA })])).rejects.toThrow();
  });

  it('rejects Approval workspace relocation', async () => {
    await expect(client.query("UPDATE mission.approvals SET workspace_id=$1 WHERE id='approval-a'", [workspaceB])).rejects.toThrow();
  });

  it('records migration bookkeeping atomically', async () => {
    expect((await client.query("SELECT count(*)::int count FROM schema_migrations WHERE filename='037_mission_approval_workspace_ownership.sql'")).rows[0].count).toBe(1);
  });

  it('rolls back all 037 schema and bookkeeping when legacy ownership is invalid', async () => {
    const failedDatabase = `projectx_037_fail_${randomUUID().replace(/-/g, '')}`;
    const root = new Client({ connectionString: rootUrl });
    await root.connect();
    await root.query(`CREATE DATABASE ${failedDatabase}`);
    const url = new URL(rootUrl); url.pathname = `/${failedDatabase}`;
    const failed = new Client({ connectionString: url.toString() });
    await failed.connect();
    try {
      await failed.query('CREATE TABLE schema_migrations(filename TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
      const files = readdirSync(migrations).filter((file) => file.endsWith('.sql')).sort().filter((file) => file < '037_mission_approval_workspace_ownership.sql');
      for (const file of files) await applyMigration(failed, file, readFileSync(resolve(migrations, file), 'utf8'));
      await failed.query("INSERT INTO mission.approvals(tenant_id,id,payload) VALUES('orphan-tenant','orphan-approval',$1)", [JSON.stringify({ missionId: randomUUID() })]);
      await expect(applyMigration(failed, '037_mission_approval_workspace_ownership.sql', readFileSync(resolve(migrations, '037_mission_approval_workspace_ownership.sql'), 'utf8'))).rejects.toThrow();
      expect((await failed.query("SELECT 1 FROM schema_migrations WHERE filename='037_mission_approval_workspace_ownership.sql'")).rowCount).toBe(0);
      expect((await failed.query("SELECT 1 FROM information_schema.columns WHERE table_schema='mission' AND table_name='missions' AND column_name='workspace_id'")).rowCount).toBe(0);
      expect((await failed.query("SELECT 1 FROM pg_constraint WHERE conname='missions_workspace_binding_check'")).rowCount).toBe(0);
    } finally {
      await failed.end();
      await root.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [failedDatabase]);
      await root.query(`DROP DATABASE IF EXISTS ${failedDatabase}`);
      await root.end();
    }
  }, 180_000);
});
