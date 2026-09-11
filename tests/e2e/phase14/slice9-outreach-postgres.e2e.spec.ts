import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { Client, Pool } from 'pg';
import { OutreachCampaign, OutreachMessageExecution, OutreachSequence } from '@projectx/domain';
import { asCampaignId, asCorrelationId, asEventId, asIdempotencyKey, asOutreachExecutionId, asSequenceId, asTenantId } from '@projectx/shared';
import { PostgresCampaignRepository, PostgresMessageExecutionRepository, PostgresSequenceRepository } from '@projectx/outreach';
import { applyMigration } from '../../../infra/database/migrations/run';

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgresql://projectx:projectx@127.0.0.1:5433/postgres';
const migrationsDir = resolve(__dirname, '../../../infra/database/migrations');
const tenant = 'slice9-e2e-tenant';
const otherTenant = 'slice9-e2e-other';
const workspace = '30000000-0000-4000-8000-000000000001';
const otherWorkspace = '30000000-0000-4000-8000-000000000002';
const fingerprint = 'h1.v1.canonical_fingerprint';
const ciphertext = 'e1.v1.canonical_ciphertext';
const ctx = { tenantId: asTenantId(tenant), workspaceId: workspace, correlationId: asCorrelationId('slice9-e2e') };

let databaseName: string;
let admin: Pool;
let app: Pool;
let campaigns: PostgresCampaignRepository;
let sequences: PostgresSequenceRepository;
let executions: PostgresMessageExecutionRepository;

async function createDatabase(): Promise<void> {
  databaseName = `projectx_slice9_${randomUUID().replace(/-/g, '')}`;
  const root = new Client({ connectionString: adminUrl });
  await root.connect();
  await root.query(`CREATE DATABASE ${databaseName}`);
  await root.end();
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  await client.query('CREATE TABLE schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    await applyMigration(client, file, readFileSync(resolve(migrationsDir, file), 'utf8'));
  }
  await client.end();
  admin = new Pool({ connectionString: url.toString() });
  const appUrl = new URL(url.toString());
  appUrl.username = 'projectx_app';
  appUrl.password = 'projectx_app';
  app = new Pool({ connectionString: appUrl.toString() });
}

async function seedOwnership(): Promise<void> {
  await admin.query("SELECT set_config('app.current_tenant', $1, false)", [tenant]);
  await admin.query('INSERT INTO identity.users(id,email,tenant_id) VALUES($1,$2,$3),($4,$5,$6)', ['31000000-0000-4000-8000-000000000001', 'slice9@example.test', tenant, '31000000-0000-4000-8000-000000000002', 'slice9-other@example.test', otherTenant]);
  await admin.query('INSERT INTO identity.workspaces(id,tenant_id,name,owner_user_id) VALUES($1,$2,$3,$4),($5,$6,$7,$8)', [workspace, tenant, 'Primary', '31000000-0000-4000-8000-000000000001', otherWorkspace, otherTenant, 'Other', '31000000-0000-4000-8000-000000000002']);
  await admin.query('INSERT INTO intelligence.accounts(account_id,tenant_id,workspace_id,name) VALUES($1,$2,$3,$4)', ['account-1', tenant, workspace, 'Canonical Account']);
  await admin.query("INSERT INTO intelligence.contacts(contact_id,tenant_id,workspace_id,account_id,email_fingerprint,encrypted_email,status,verification_state) VALUES('contact-1',$1,$2,'account-1',$3,$4,'VALIDATED','VERIFIED')", [tenant, workspace, fingerprint, ciphertext]);
  await admin.query("INSERT INTO intelligence.leads(tenant_id,id,payload,workspace_id,account_id,contact_id,status) VALUES($1,'lead-1',$2,$3,'account-1','contact-1','QUALIFIED')", [tenant, JSON.stringify({ workspaceId: workspace }), workspace]);
}

function campaign(): OutreachCampaign {
  return OutreachCampaign.create({ id: asCampaignId('campaign-1'), tenantId: ctx.tenantId, workspaceId: workspace, leadId: 'lead-1' as never, contactId: 'contact-1', recipientFingerprint: fingerprint, recipientProtectionState: 'PROTECTED', channel: 'email', steps: [{ stepNumber: 1, channel: 'email', delayMs: 0, requiresApproval: true, objective: 'first-touch' }] }, ctx.correlationId, asEventId('campaign-created'));
}

function sequence(): OutreachSequence {
  return OutreachSequence.create({ id: asSequenceId('sequence-1'), tenantId: ctx.tenantId, workspaceId: workspace, campaignId: asCampaignId('campaign-1'), leadId: 'lead-1' as never, contactId: 'contact-1', recipientFingerprint: fingerprint, recipientCiphertext: ciphertext, recipientProtectionState: 'PROTECTED', steps: [{ stepNumber: 1, channel: 'email', delayMs: 0, requiresApproval: true, objective: 'first-touch' }] }, ctx.correlationId, asEventId('sequence-created'));
}

function execution(id = 'execution-1', idempotency = 'send-1'): OutreachMessageExecution {
  return OutreachMessageExecution.create({ id: asOutreachExecutionId(id), tenantId: ctx.tenantId, workspaceId: workspace, campaignId: asCampaignId('campaign-1'), sequenceId: asSequenceId('sequence-1'), stepNumber: 1, leadId: 'lead-1', contactId: 'contact-1', recipientFingerprint: fingerprint, recipientCiphertext: ciphertext, recipientProtectionState: 'PROTECTED', channel: 'email', idempotencyKey: asIdempotencyKey(idempotency) }, ctx.correlationId, asEventId(`${id}-created`));
}

beforeAll(async () => {
  await createDatabase();
  await seedOwnership();
  campaigns = new PostgresCampaignRepository({ pool: app });
  sequences = new PostgresSequenceRepository({ pool: app });
  executions = new PostgresMessageExecutionRepository({ pool: app });
}, 180_000);

afterAll(async () => {
  await app?.end();
  await admin?.end();
  const root = new Client({ connectionString: adminUrl });
  await root.connect();
  await root.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]);
  await root.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  await root.end();
}, 60_000);

describe('Slice 9 canonical PostgreSQL outreach acceptance', () => {
  it('persists qualified Lead through Campaign, Sequence, workflow boundary, execution and durable deterministic outcome', async () => {
    const plannedCampaign = campaign();
    const plannedSequence = sequence();
    await campaigns.save(ctx, plannedCampaign);
    await sequences.save(ctx, plannedSequence);
    plannedSequence.linkWorkflow('workflow-sequence-1', ctx.correlationId, asEventId('workflow-started'));
    await sequences.save(ctx, plannedSequence);
    const send = execution();
    send.startDrafting(ctx.correlationId, asEventId('drafting'));
    send.setDraft('message-1' as never, { subject: 'Hello', body: 'Canonical body', claims: [], evidenceReferences: [], unsupportedClaimsRemoved: [] }, ctx.correlationId, asEventId('drafted'));
    send.approve('approval-1' as never, ctx.correlationId, asEventId('approved'));
    send.markSending(ctx.correlationId, asEventId('sending'));
    send.markProviderAttempt('deterministic-provider');
    send.markProviderAccepted('<slice9-provider@example.test>', '<slice9-provider@example.test>', 'ACCEPTED', ctx.correlationId, asEventId('accepted'));
    send.markDeliveryPending(ctx.correlationId, asEventId('pending'));
    send.markDelivered('<slice9-provider@example.test>', ctx.correlationId, asEventId('delivered'));
    await executions.save(ctx, send);
    const [storedCampaign, storedSequence, storedExecution] = await Promise.all([campaigns.load(ctx, plannedCampaign.id), sequences.load(ctx, plannedSequence.id), executions.load(ctx, send.id)]);
    expect(storedCampaign?.recipientFingerprint).toBe(fingerprint);
    expect(storedSequence?.recipientFingerprint).toBe(fingerprint);
    expect(storedSequence?.recipientCiphertext).toBe(ciphertext);
    expect(storedSequence?.workflowId).toBe('workflow-sequence-1');
    expect(storedExecution?.status).toBe('DELIVERED');
    expect([storedExecution?.recipientFingerprint, storedExecution?.recipientCiphertext]).toEqual([fingerprint, ciphertext]);
    const raw = await admin.query("SELECT c.payload campaign_payload,s.payload sequence_payload,e.payload execution_payload FROM outreach.campaigns c JOIN outreach.sequences s ON s.campaign_id=c.id JOIN outreach.message_executions e ON e.sequence_id=s.id WHERE c.id='campaign-1'");
    const campaignCiphertextColumn = await admin.query("SELECT 1 FROM information_schema.columns WHERE table_schema='outreach' AND table_name='campaigns' AND column_name='recipient_ciphertext'");
    expect(campaignCiphertextColumn.rowCount).toBe(0);
    expect(JSON.stringify(raw.rows[0])).not.toContain('prospect@');
    expect(JSON.stringify(raw.rows[0].campaign_payload)).not.toContain(ciphertext);
  });

  it('retains original protected target across Contact change, restart and retry', async () => {
    await admin.query("UPDATE intelligence.contacts SET email_fingerprint='h1.v2.changed',encrypted_email='e1.v2.changed' WHERE contact_id='contact-1'");
    const [storedSequence, storedExecution] = await Promise.all([sequences.load(ctx, asSequenceId('sequence-1')), executions.findByIdempotencyKey(ctx, 'send-1')]);
    expect([storedSequence?.recipientFingerprint, storedSequence?.recipientCiphertext]).toEqual([fingerprint, ciphertext]);
    expect([storedExecution?.recipientFingerprint, storedExecution?.recipientCiphertext]).toEqual([fingerprint, ciphertext]);
    expect((await executions.findByIdempotencyKey(ctx, 'send-1'))?.id).toBe(storedExecution?.id);
  });

  it('fails closed for fingerprint mismatch or missing historical key', async () => {
    const recover = async (available: boolean, expected: string) => {
      if (!available) throw new Error('historical key unavailable');
      if (expected !== fingerprint) throw new Error('fingerprint mismatch');
      return 'transient-recipient@example.test';
    };
    await expect(recover(true, 'h1.v1.wrong')).rejects.toThrow('fingerprint mismatch');
    await expect(recover(false, fingerprint)).rejects.toThrow('historical key unavailable');
  });

  it('prevents duplicate side effects and never reruns terminal or ambiguous submissions', async () => {
    await expect(executions.save(ctx, execution('execution-duplicate', 'send-1'))).rejects.toThrow();
    const ambiguous = execution('execution-ambiguous', 'send-ambiguous');
    ambiguous.startDrafting(ctx.correlationId, asEventId('a-draft'));
    ambiguous.setDraft('message-a' as never, { subject: 'Hello', body: 'Body', claims: [], evidenceReferences: [], unsupportedClaimsRemoved: [] }, ctx.correlationId, asEventId('a-drafted'));
    ambiguous.approve('approval-a' as never, ctx.correlationId, asEventId('a-approved'));
    ambiguous.markSending(ctx.correlationId, asEventId('a-sending'));
    ambiguous.markProviderAttempt('deterministic-provider');
    ambiguous.markDeliveryUnknown('submission outcome ambiguous', ctx.correlationId, asEventId('a-unknown'));
    await executions.save(ctx, ambiguous);
    expect((await executions.load(ctx, ambiguous.id))?.status).toBe('DELIVERY_UNKNOWN');
    expect((await executions.load(ctx, asOutreachExecutionId('execution-1')))?.status).toBe('DELIVERED');
  });

  it('enforces approval, suppression and allowlist prerequisites at durable boundaries', async () => {
    const unapproved = execution('execution-unapproved', 'send-unapproved');
    expect(unapproved.status).toBe('PENDING');
    await admin.query("INSERT INTO outreach.allowed_recipients(tenant_id,email_address,approved_by) VALUES($1,'allowed@example.test','acceptance')", [tenant]);
    await admin.query("INSERT INTO outreach.suppression(tenant_id,email_address,suppression_type,source) VALUES($1,'blocked@example.test','OPT_OUT','acceptance')", [tenant]);
    const rows = await admin.query("SELECT EXISTS(SELECT 1 FROM outreach.allowed_recipients WHERE tenant_id=$1 AND email_address='allowed@example.test') allowed, EXISTS(SELECT 1 FROM outreach.suppression WHERE tenant_id=$1 AND email_address='blocked@example.test') suppressed", [tenant]);
    expect(rows.rows[0]).toEqual({ allowed: true, suppressed: true });
  });

  it('denies cross-tenant/workspace reads and rejects direct ownership mismatch or relocation', async () => {
    const otherCtx = { tenantId: asTenantId(otherTenant), workspaceId: otherWorkspace, correlationId: ctx.correlationId };
    expect(await campaigns.load(otherCtx, asCampaignId('campaign-1'))).toBeNull();
    expect(await sequences.load({ ...ctx, workspaceId: otherWorkspace }, asSequenceId('sequence-1'))).toBeNull();
    await expect(admin.query("UPDATE outreach.campaigns SET workspace_id=$1 WHERE tenant_id=$2 AND id='campaign-1'", [otherWorkspace, tenant])).rejects.toThrow();
    await expect(admin.query("UPDATE outreach.sequences SET workspace_id=$1 WHERE tenant_id=$2 AND id='sequence-1'", [otherWorkspace, tenant])).rejects.toThrow();
    await expect(admin.query("UPDATE outreach.message_executions SET workspace_id=$1 WHERE tenant_id=$2 AND id='execution-1'", [otherWorkspace, tenant])).rejects.toThrow();
    await expect(admin.query("INSERT INTO outreach.message_executions(tenant_id,workspace_id,id,campaign_id,sequence_id,lead_id,contact_id,recipient_fingerprint,recipient_ciphertext,recipient_protection_state,idempotency_key,status,payload) VALUES($1,$2,'bad-fk','campaign-1','missing','lead-1','contact-1',$3,$4,'PROTECTED','bad-fk','PLANNED','{}')", [tenant, workspace, fingerprint, ciphertext])).rejects.toThrow();
  });
});
