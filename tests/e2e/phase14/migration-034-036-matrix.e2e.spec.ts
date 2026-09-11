import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { applyMigration } from '../../../infra/database/migrations/run';

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgresql://projectx:projectx@127.0.0.1:5433/postgres';
const migrationsDir = resolve(__dirname, '../../../infra/database/migrations');
const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();

function databaseUrl(name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function createDatabase(name: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(name: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
    await client.query(`DROP DATABASE IF EXISTS ${name}`);
  } finally {
    await client.end();
  }
}

async function migrate(client: Client, through: string): Promise<void> {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  for (const file of files.filter((candidate) => candidate.localeCompare(through) <= 0)) {
    await applyMigration(client, file, readFileSync(resolve(migrationsDir, file), 'utf8'));
  }
}

const tenantA = 'matrix-tenant-a';
const tenantB = 'matrix-tenant-b';
const workspaceA = '10000000-0000-4000-8000-000000000001';
const workspaceB = '10000000-0000-4000-8000-000000000002';
const ownerA = '20000000-0000-4000-8000-000000000001';
const ownerB = '20000000-0000-4000-8000-000000000002';

async function seedIdentity(client: Client): Promise<void> {
  await client.query("SELECT set_config('app.current_tenant', $1, false)", [tenantA]);
  await client.query('INSERT INTO identity.users(id,email,tenant_id) VALUES($1,$2,$3),($4,$5,$6)', [ownerA, 'matrix-a@example.test', tenantA, ownerB, 'matrix-b@example.test', tenantB]);
  await client.query('INSERT INTO identity.workspaces(id,tenant_id,name,owner_user_id) VALUES($1,$2,$3,$4),($5,$6,$7,$8)', [workspaceA, tenantA, 'A', ownerA, workspaceB, tenantB, 'B', ownerB]);
  await client.query('INSERT INTO intelligence.accounts(account_id,tenant_id,workspace_id,name) VALUES($1,$2,$3,$4),($5,$6,$7,$8)', ['account-a', tenantA, workspaceA, 'A', 'account-b', tenantB, workspaceB, 'B']);
  await client.query("INSERT INTO intelligence.contacts(contact_id,tenant_id,workspace_id,account_id,status,verification_state) VALUES($1,$2,$3,$4,'VALIDATED','VERIFIED'),($5,$6,$7,$8,'VALIDATED','VERIFIED')", ['contact-a', tenantA, workspaceA, 'account-a', 'contact-b', tenantB, workspaceB, 'account-b']);
}

async function assertFailedMigrationRolledBack(client: Client): Promise<void> {
  const bookkeeping = await client.query("SELECT 1 FROM schema_migrations WHERE filename IN ('034_slice9_outreach_workspace.sql','035_slice10_conversation_workspace.sql','036_graph_subscriptions_workspace_scope.sql')");
  expect(bookkeeping.rowCount).toBe(0);
  const columns = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='outreach' AND table_name='campaigns' AND column_name='workspace_id'");
  expect(columns.rowCount).toBe(0);
  const constraints = await client.query("SELECT 1 FROM pg_constraint WHERE conname LIKE 'campaigns_workspace_%' OR conname LIKE 'campaigns_protection_%'");
  expect(constraints.rowCount).toBe(0);
  const indexes = await client.query("SELECT 1 FROM pg_indexes WHERE indexname='outreach_campaigns_workspace'");
  expect(indexes.rowCount).toBe(0);
}

async function runCase(body: (client: Client) => Promise<void>): Promise<void> {
  const name = `projectx_matrix_${randomUUID().replace(/-/g, '')}`;
  await createDatabase(name);
  const client = new Client({ connectionString: databaseUrl(name) });
  await client.connect();
  try {
    await body(client);
  } finally {
    await client.end();
    await dropDatabase(name);
  }
}

describe('isolated migration acceptance matrix 034-037', () => {
  jest.setTimeout(180_000);

  it('A fresh 001-037 passes exactly once', async () => runCase(async (client) => {
    await migrate(client, '037_mission_approval_workspace_ownership.sql');
    const count = await client.query('SELECT count(*)::int AS count FROM schema_migrations');
    expect(count.rows[0].count).toBe(files.length);
    await migrate(client, '037_mission_approval_workspace_ownership.sql').catch(() => undefined);
    const distinct = await client.query('SELECT count(*)::int AS count, count(DISTINCT filename)::int AS distinct_count FROM schema_migrations');
    expect(distinct.rows[0]).toEqual({ count: files.length, distinct_count: files.length });
  }));

  it('B canonical legacy normalization passes', async () => runCase(async (client) => {
    await migrate(client, '033_slice8_intelligence_cache.sql');
    await seedIdentity(client);
    await client.query("INSERT INTO intelligence.leads(tenant_id,id,payload,workspace_id,account_id,contact_id,status) VALUES($1,'lead-a',$2,$3,'account-a','contact-a','QUALIFIED')", [tenantA, JSON.stringify({ workspaceId: workspaceA }), workspaceA]);
    await client.query("INSERT INTO outreach.campaigns(tenant_id,id,payload) VALUES($1,'campaign-a',$2)", [tenantA, JSON.stringify({ leadId: 'lead-a', contactId: 'contact-a', recipientAddress: 'synthetic@example.test' })]);
    await client.query("INSERT INTO outreach.sequences(tenant_id,id,payload) VALUES($1,'sequence-a',$2)", [tenantA, JSON.stringify({ campaignId: 'campaign-a', leadId: 'lead-a', contactId: 'contact-a', recipientAddress: 'synthetic@example.test' })]);
    await client.query("INSERT INTO outreach.message_executions(tenant_id,id,payload) VALUES($1,'execution-a',$2)", [tenantA, JSON.stringify({ campaignId: 'campaign-a', sequenceId: 'sequence-a', leadId: 'lead-a', contactId: 'contact-a', idempotencyKey: 'idem-a', status: 'DELIVERED', recipientAddress: 'synthetic@example.test' })]);
    await client.query("INSERT INTO conversation.conversations(tenant_id,id,payload) VALUES($1,'conversation-standalone',$2),($1,'conversation-linked',$3)", [tenantA, JSON.stringify({ leadId: 'lead-a', channel: 'email' }), JSON.stringify({ leadId: 'lead-a', executionId: 'execution-a', channel: 'email' })]);
    await client.query("INSERT INTO outreach.graph_subscriptions(tenant_id,subscription_id,resource,notification_url,client_state,expiration_date_time) VALUES($1,'legacy-sub','Users/mailbox/Messages','https://example.test/hook','state',NOW()+interval '1 day')", [tenantA]);
    for (const file of files.filter((candidate) => candidate.localeCompare('034_slice9_outreach_workspace.sql') >= 0)) {
      await applyMigration(client, file, readFileSync(resolve(migrationsDir, file), 'utf8'));
    }
    const campaign = await client.query("SELECT recipient_protection_state,recipient_fingerprint FROM outreach.campaigns WHERE id='campaign-a'");
    expect(campaign.rows[0]).toEqual({ recipient_protection_state: 'LEGACY_UNAVAILABLE', recipient_fingerprint: null });
    const snapshots = await client.query("SELECT recipient_protection_state,recipient_fingerprint,recipient_ciphertext FROM outreach.sequences WHERE id='sequence-a'");
    expect(snapshots.rows[0]).toEqual({ recipient_protection_state: 'LEGACY_UNAVAILABLE', recipient_fingerprint: null, recipient_ciphertext: null });
    const conversations = await client.query('SELECT id,execution_id,workspace_id FROM conversation.conversations ORDER BY id');
    expect(conversations.rows).toEqual([
      { id: 'conversation-linked', execution_id: 'execution-a', workspace_id: workspaceA },
      { id: 'conversation-standalone', execution_id: null, workspace_id: workspaceA },
    ]);
    const subscription = await client.query("SELECT subscription_scope,workspace_id FROM outreach.graph_subscriptions WHERE subscription_id='legacy-sub'");
    expect(subscription.rows[0]).toEqual({ subscription_scope: 'LEGACY_UNBOUND', workspace_id: null });
  }));

  it.each([
    ['C missing durable reference', async (client: Client) => {
      await seedIdentity(client);
      await client.query("INSERT INTO outreach.campaigns(tenant_id,id,payload) VALUES($1,'campaign-missing',$2)", [tenantA, JSON.stringify({ leadId: 'missing', contactId: 'contact-a' })]);
    }],
    ['D cross-tenant ownership', async (client: Client) => {
      await seedIdentity(client);
      await client.query("INSERT INTO intelligence.leads(tenant_id,id,payload,workspace_id) VALUES($1,'lead-b',$2,$3)", [tenantB, JSON.stringify({ workspaceId: workspaceB }), workspaceB]);
      await client.query("INSERT INTO outreach.campaigns(tenant_id,id,payload) VALUES($1,'campaign-cross',$2)", [tenantA, JSON.stringify({ leadId: 'lead-b', contactId: 'contact-a' })]);
    }],
    ['E conflicting ownership paths', async (client: Client) => {
      await seedIdentity(client);
      await client.query("INSERT INTO intelligence.leads(tenant_id,id,payload,workspace_id) VALUES($1,'lead-a',$2,$3)", [tenantA, JSON.stringify({ workspaceId: workspaceA }), workspaceA]);
      await client.query("INSERT INTO outreach.campaigns(tenant_id,id,payload) VALUES($1,'campaign-conflict',$2)", [tenantA, JSON.stringify({ leadId: 'lead-a', contactId: 'contact-b' })]);
    }],
    ['F malformed/noncanonical IDs', async (client: Client) => {
      await seedIdentity(client);
      await client.query("INSERT INTO outreach.campaigns(tenant_id,id,payload) VALUES($1,'campaign-malformed',$2)", [tenantA, JSON.stringify({ leadId: '', contactId: 'contact-a' })]);
    }],
  ])('%s fails with complete rollback', async (_name, seed) => runCase(async (client) => {
    await migrate(client, '033_slice8_intelligence_cache.sql');
    await seed(client);
    await expect(applyMigration(client, '034_slice9_outreach_workspace.sql', readFileSync(resolve(migrationsDir, '034_slice9_outreach_workspace.sql'), 'utf8'))).rejects.toThrow();
    await assertFailedMigrationRolledBack(client);
  }));
});
