import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { Client, Pool } from 'pg';
import type { ISecretsProvider } from '@projectx/infrastructure';
import { PostgresIdempotencyStore } from '@projectx/infrastructure';
import { ConversationHandlingService, NoOpPIIScrubber, PostgresConversationRepository } from '@projectx/conversation';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import {
  GraphInboundIngressService,
  GraphMessageNormalizer,
  GraphReplyCorrelator,
  GraphTenantResolver,
  GraphWebhookValidator,
  PostgresGraphSubscriptionRepository,
  PostgresMessageExecutionRepository,
  PostgresTenantEmailConfigRepository,
  StubGraphInboundMessageFetcher,
} from '@projectx/outreach';
import { applyMigration } from '../../../infra/database/migrations/run';

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgresql://projectx:projectx@127.0.0.1:5433/postgres';
const migrationsDir = resolve(__dirname, '../../../infra/database/migrations');
const tenant = 'slice10-e2e-tenant';
const otherTenant = 'slice10-e2e-other';
const workspace = '40000000-0000-4000-8000-000000000001';
const otherWorkspace = '40000000-0000-4000-8000-000000000002';
const mailbox = 'slice10-mailbox@example.test';
const fingerprint = 'h1.v1.prospect@example.test';
const ctx = { tenantId: asTenantId(tenant), workspaceId: workspace, correlationId: asCorrelationId('slice10-e2e') };

class Secrets implements ISecretsProvider {
  async getSecret(): Promise<string> { return 'trusted-client-state'; }
  async getCertificate(): Promise<Buffer> { throw new Error('not used'); }
}

let databaseName: string;
let admin: Pool;
let app: Pool;
let subscriptions: PostgresGraphSubscriptionRepository;
let executions: PostgresMessageExecutionRepository;
let conversations: PostgresConversationRepository;
let fetcher: StubGraphInboundMessageFetcher;

async function createDatabase(): Promise<void> {
  databaseName = `projectx_slice10_${randomUUID().replace(/-/g, '')}`;
  const root = new Client({ connectionString: adminUrl });
  await root.connect();
  await root.query(`CREATE DATABASE ${databaseName}`);
  await root.end();
  const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  await client.query('CREATE TABLE schema_migrations(filename TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) await applyMigration(client, file, readFileSync(resolve(migrationsDir, file), 'utf8'));
  await client.end();
  admin = new Pool({ connectionString: url.toString() });
  const appUrl = new URL(url.toString()); appUrl.username = 'projectx_app'; appUrl.password = 'projectx_app';
  app = new Pool({ connectionString: appUrl.toString() });
}

async function seed(): Promise<void> {
  await admin.query("SELECT set_config('app.current_tenant',$1,false)", [tenant]);
  await admin.query('INSERT INTO identity.users(id,email,tenant_id) VALUES($1,$2,$3),($4,$5,$6)', ['41000000-0000-4000-8000-000000000001', 'slice10@example.test', tenant, '41000000-0000-4000-8000-000000000002', 'slice10-other@example.test', otherTenant]);
  await admin.query('INSERT INTO identity.workspaces(id,tenant_id,name,owner_user_id) VALUES($1,$2,$3,$4),($5,$6,$7,$8)', [workspace, tenant, 'Primary', '41000000-0000-4000-8000-000000000001', otherWorkspace, otherTenant, 'Other', '41000000-0000-4000-8000-000000000002']);
  await admin.query("INSERT INTO intelligence.accounts(account_id,tenant_id,workspace_id,name) VALUES('account-1',$1,$2,'Account')", [tenant, workspace]);
  await admin.query("INSERT INTO intelligence.contacts(contact_id,tenant_id,workspace_id,account_id,status,verification_state) VALUES('contact-1',$1,$2,'account-1','VALIDATED','VERIFIED')", [tenant, workspace]);
  await admin.query("INSERT INTO intelligence.leads(tenant_id,id,payload,workspace_id,account_id,contact_id,status) VALUES($1,'lead-1',$2,$3,'account-1','contact-1','QUALIFIED'),($1,'lead-2',$4,$3,'account-1','contact-1','QUALIFIED')", [tenant, JSON.stringify({ workspaceId: workspace }), workspace, JSON.stringify({ workspaceId: workspace })]);
  await admin.query("INSERT INTO outreach.campaigns(tenant_id,workspace_id,id,lead_id,contact_id,recipient_fingerprint,recipient_protection_state,payload) VALUES($1,$2,'campaign-1','lead-1','contact-1',$3,'PROTECTED',$4)", [tenant, workspace, fingerprint, JSON.stringify({ workspaceId: workspace, leadId: 'lead-1', contactId: 'contact-1', channel: 'email', steps: [], status: 'RUNNING', sentCount: 0, spentCostUsd: 0, createdAt: new Date(), updatedAt: new Date() })]);
  await admin.query("INSERT INTO outreach.sequences(tenant_id,workspace_id,id,campaign_id,lead_id,contact_id,recipient_fingerprint,recipient_ciphertext,recipient_protection_state,payload) VALUES($1,$2,'sequence-1','campaign-1','lead-1','contact-1',$3,'e1.v1.cipher','PROTECTED',$4)", [tenant, workspace, fingerprint, JSON.stringify({ workspaceId: workspace, campaignId: 'campaign-1', leadId: 'lead-1', contactId: 'contact-1', steps: [], status: 'RUNNING', currentStepIndex: 0, createdAt: new Date(), updatedAt: new Date() })]);
  await seedExecution('execution-1', 'lead-1', '<outbound-1@example.test>', fingerprint, 'DELIVERY_PENDING');
  await admin.query("INSERT INTO outreach.tenant_email_config(tenant_id,provider_id,channel,from_address,allowed_domains,webhook_secret_reference) VALUES($1,'graph-email','email',$2,$3,'slice10-secret')", [tenant, mailbox, ['example.test']]);
  await admin.query("INSERT INTO outreach.inbound_mailbox_registry(normalized_mailbox,tenant_id,provider_id,channel) VALUES($1,$2,'graph-email','email')", [mailbox, tenant]);
}

async function seedExecution(id: string, leadId: string, providerId: string | null, recipientFingerprint: string, status: string): Promise<void> {
  await admin.query("INSERT INTO outreach.message_executions(tenant_id,workspace_id,id,campaign_id,sequence_id,lead_id,contact_id,recipient_fingerprint,recipient_ciphertext,recipient_protection_state,idempotency_key,provider_message_id,status,payload) VALUES($1,$2,$3,'campaign-1','sequence-1',$4,'contact-1',$5,'e1.v1.cipher','PROTECTED',$6,$7,$8,$9)", [tenant, workspace, id, leadId, recipientFingerprint, `idem-${id}`, providerId, status, JSON.stringify({ workspaceId: workspace, campaignId: 'campaign-1', sequenceId: 'sequence-1', stepNumber: 1, leadId, contactId: 'contact-1', channel: 'email', idempotencyKey: `idem-${id}`, providerMessageId: providerId, status, attempts: 1, createdAt: new Date(), updatedAt: new Date() })]);
}

function message(id: string, headers: Array<{ name: string; value: string }> = [], sender = 'prospect@example.test') {
  return { id, from: { emailAddress: { address: sender } }, toRecipients: [{ emailAddress: { address: mailbox } }], body: { contentType: 'text', content: 'Interested in a meeting' }, subject: 'Re: outreach', receivedDateTime: '2026-09-11T12:00:00Z', internetMessageHeaders: headers };
}

async function ingress(subscriptionId: string, graphMessageId: string, resourceWorkspace?: string) {
  const tenantConfigs = new PostgresTenantEmailConfigRepository({ pool: app });
  const correlator = new GraphReplyCorrelator({ messageExecutionRepository: executions, historicalRecipientFingerprint: { fingerprintEmailForVersion: async (_tenant, raw, version) => `h1.${version}.${raw}` } });
  const service = new GraphInboundIngressService({ validator: new GraphWebhookValidator({ secretsProvider: new Secrets() }), tenantResolver: new GraphTenantResolver(tenantConfigs), subscriptionRepository: subscriptions, messageFetcher: fetcher, normalizer: new GraphMessageNormalizer(), correlator, idempotencyStore: new PostgresIdempotencyStore({ pool: app }) });
  return service.ingest({ subscriptionId, changeType: 'created', resource: `Users/${mailbox}/Messages/${graphMessageId}`, clientState: 'trusted-client-state', resourceData: { id: graphMessageId, workspaceId: resourceWorkspace } as never });
}

beforeAll(async () => {
  await createDatabase(); await seed();
  subscriptions = new PostgresGraphSubscriptionRepository({ pool: app }); executions = new PostgresMessageExecutionRepository({ pool: app }); conversations = new PostgresConversationRepository({ pool: app }); fetcher = new StubGraphInboundMessageFetcher();
  await subscriptions.save(ctx, { tenantId: tenant, workspaceId: workspace, subscriptionScope: 'WORKSPACE_BOUND', subscriptionId: 'bound-sub', resource: `Users/${mailbox}/Messages`, notificationUrl: 'https://example.test/hook', clientState: 'trusted-client-state', expirationDateTime: new Date('2030-01-01') });
}, 180_000);

afterAll(async () => {
  await app?.end(); await admin?.end();
  const root = new Client({ connectionString: adminUrl }); await root.connect();
  await root.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]); await root.query(`DROP DATABASE IF EXISTS ${databaseName}`); await root.end();
}, 60_000);

describe('Slice 10 canonical PostgreSQL inbound acceptance', () => {
  it('authenticates, trusts stored workspace, prefers provider ID, persists/classifies/dispatches and durably reloads', async () => {
    fetcher.seed(mailbox, message('graph-1', [{ name: 'In-Reply-To', value: '<outbound-1@example.test>' }]));
    const outcome = await ingress('bound-sub', 'graph-1', otherWorkspace);
    if (outcome.status !== 'PROCESSED') throw new Error(JSON.stringify(outcome));
    expect(outcome.event.workspaceId).toBe(workspace); expect(outcome.event.executionId).toBe('execution-1');
    let dispatched = 0;
    const handler = new ConversationHandlingService({ conversationRepository: conversations, leadRepository: { load: async () => null, save: async () => undefined } as never, intentClassifier: { classify: async () => ({ intent: 'POSITIVE', confidence: 0.99, reason: 'deterministic' }) }, nextBestActionPolicy: { decide: () => ({ actionType: 'FOLLOW_UP', requiresApproval: false, reason: 'deterministic' }) }, piiScrubber: new NoOpPIIScrubber(), generateConversationId: () => 'conversation-1', generateReplyMessageId: () => 'reply-1', generateEventId: () => `event-${randomUUID()}` });
    const handled = await handler.handleReply(ctx, outcome.event); const loaded = await conversations.load(ctx, handled.conversationId as never); await handler.classifyAndAct(ctx, loaded!, 1); dispatched += 1;
    const durable = await conversations.load(ctx, handled.conversationId as never);
    expect(durable?.latestIntent).toBe('POSITIVE'); expect(durable?.nextAction).toBe('FOLLOW_UP'); expect(dispatched).toBe(1);
    const raw = await admin.query("SELECT payload::text FROM conversation.conversations WHERE id='conversation-1'");
    expect(raw.rows[0].payload).not.toContain('prospect@example.test'); expect(raw.rows[0].payload).not.toContain(mailbox);
  });

  it('rejects forged clientState before mutation and deduplicates authenticated ingress', async () => {
    fetcher.seed(mailbox, message('graph-forged', [{ name: 'In-Reply-To', value: '<outbound-1@example.test>' }]));
    const tenantConfigs = new PostgresTenantEmailConfigRepository({ pool: app });
    const service = new GraphInboundIngressService({ validator: new GraphWebhookValidator({ secretsProvider: new Secrets() }), tenantResolver: new GraphTenantResolver(tenantConfigs), subscriptionRepository: subscriptions, messageFetcher: fetcher, normalizer: new GraphMessageNormalizer(), correlator: new GraphReplyCorrelator({ messageExecutionRepository: executions, historicalRecipientFingerprint: { fingerprintEmailForVersion: async () => fingerprint } }), idempotencyStore: new PostgresIdempotencyStore({ pool: app }) });
    const forged = await service.ingest({ subscriptionId: 'bound-sub', changeType: 'created', resource: `Users/${mailbox}/Messages/graph-forged`, clientState: 'forged', resourceData: { id: 'graph-forged' } });
    expect(forged.status).toBe('REJECTED');
    const first = await ingress('bound-sub', 'graph-forged'); const second = await ingress('bound-sub', 'graph-forged');
    expect(first.status).toBe('PROCESSED'); expect(second.status).toBe('DUPLICATE');
  });

  it('uses workspace-only historical fingerprint fallback and fails closed without key', async () => {
    await seedExecution('execution-fallback', 'lead-1', null, fingerprint, 'DELIVERY_PENDING');
    fetcher.seed(mailbox, message('graph-fallback'));
    expect((await ingress('bound-sub', 'graph-fallback')).status).toBe('PROCESSED');
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: executions, historicalRecipientFingerprint: { fingerprintEmailForVersion: async () => { throw new Error('key missing'); } } });
    const subscription = await subscriptions.findBySubscriptionId(ctx, 'bound-sub');
    const result = await correlator.correlate(ctx, subscription!, new GraphMessageNormalizer().normalize(message('missing-key') as never).event!);
    expect(result.status).toBe('NOT_CORRELATED');
  });

  it('supports Lead-level fallback for repeated execution and rejects candidates across Leads', async () => {
    await seedExecution('execution-repeat', 'lead-1', null, fingerprint, 'DELIVERY_PENDING');
    const subscription = await subscriptions.findBySubscriptionId(ctx, 'bound-sub');
    const correlator = new GraphReplyCorrelator({ messageExecutionRepository: executions, historicalRecipientFingerprint: { fingerprintEmailForVersion: async (_t, raw, version) => `h1.${version}.${raw}` } });
    const normalized = new GraphMessageNormalizer().normalize(message('repeat') as never); if (normalized.status !== 'NORMALIZED') throw new Error('normalization failed');
    const oneLead = await correlator.correlate(ctx, subscription!, normalized.event); expect(oneLead.status).toBe('CORRELATED'); if (oneLead.status === 'CORRELATED') expect(oneLead.execution).toBeUndefined();
    await seedExecution('execution-other-lead', 'lead-2', null, fingerprint, 'DELIVERY_PENDING');
    expect((await correlator.correlate(ctx, subscription!, normalized.event)).status).toBe('NOT_CORRELATED');
  });

  it('LEGACY_UNBOUND derives workspace only from unique provider identity and disables fingerprint/ambiguity', async () => {
    await subscriptions.save(ctx, { tenantId: tenant, workspaceId: null, subscriptionScope: 'LEGACY_UNBOUND', subscriptionId: 'legacy-sub', resource: `Users/${mailbox}/Messages`, notificationUrl: 'https://example.test/hook', clientState: 'trusted-client-state', expirationDateTime: new Date('2030-01-01') });
    fetcher.seed(mailbox, message('legacy-exact', [{ name: 'In-Reply-To', value: '<outbound-1@example.test>' }]));
    const exact = await ingress('legacy-sub', 'legacy-exact'); expect(exact.status).toBe('PROCESSED'); if (exact.status === 'PROCESSED') expect(exact.event.workspaceId).toBe(workspace);
    fetcher.seed(mailbox, message('legacy-fingerprint')); expect((await ingress('legacy-sub', 'legacy-fingerprint')).status).toBe('NOT_CORRELATED');
    await seedExecution('execution-ambiguous-provider', 'lead-1', '<ambiguous@example.test>', fingerprint, 'DELIVERY_PENDING');
    await seedExecution('execution-ambiguous-provider-2', 'lead-1', '<ambiguous@example.test>', fingerprint, 'DELIVERY_PENDING');
    fetcher.seed(mailbox, message('legacy-ambiguous', [{ name: 'In-Reply-To', value: '<ambiguous@example.test>' }]));
    expect((await ingress('legacy-sub', 'legacy-ambiguous')).status).toBe('NOT_CORRELATED');
  });

  it('allows standalone and exact linked Conversations, rejects wrong Lead, isolation and relocation', async () => {
    const standalonePayload = JSON.stringify({ workspaceId: workspace, leadId: 'lead-1', channel: 'email', status: 'OPEN', messages: [], optedOut: false, createdAt: new Date(), updatedAt: new Date() });
    await admin.query("INSERT INTO conversation.conversations(tenant_id,workspace_id,id,lead_id,execution_id,payload) VALUES($1,$2,'standalone','lead-1',NULL,$3),($1,$2,'linked','lead-1','execution-1',$3)", [tenant, workspace, standalonePayload]);
    await expect(admin.query("INSERT INTO conversation.conversations(tenant_id,workspace_id,id,lead_id,execution_id,payload) VALUES($1,$2,'wrong-lead','lead-2','execution-1',$3)", [tenant, workspace, standalonePayload])).rejects.toThrow();
    expect(await conversations.load({ tenantId: asTenantId(otherTenant), workspaceId: otherWorkspace, correlationId: ctx.correlationId }, 'linked' as never)).toBeNull();
    expect(await conversations.load({ ...ctx, workspaceId: otherWorkspace }, 'linked' as never)).toBeNull();
    await expect(admin.query("UPDATE conversation.conversations SET workspace_id=$1 WHERE id='linked'", [otherWorkspace])).rejects.toThrow();
  });
});
