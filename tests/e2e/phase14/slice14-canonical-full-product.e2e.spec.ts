import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { Client, Pool } from 'pg';
import { Actor, Mission, OutreachCampaign, OutreachMessageExecution, OutreachSequence } from '@projectx/domain';
import { asCampaignId, asCorrelationId, asEventId, asIdempotencyKey, asMissionId, asOutreachExecutionId, asSequenceId, asTenantId, asUserId } from '@projectx/shared';
import { PostgresIdempotencyStore } from '@projectx/infrastructure';
import { ApprovalApplicationService, PostgresApprovalRepository, PostgresMissionRepository } from '@projectx/mission-orchestrator';
import { ConversationHandlingService, NoOpPIIScrubber, PostgresConversationRepository } from '@projectx/conversation';
import { GraphInboundIngressService, GraphMessageNormalizer, GraphReplyCorrelator, GraphTenantResolver, GraphWebhookValidator, PostgresCampaignRepository, PostgresGraphSubscriptionRepository, PostgresMessageExecutionRepository, PostgresSequenceRepository, PostgresTenantEmailConfigRepository, StubGraphInboundMessageFetcher, GraphCalendarProvider, StaticWorkspaceCalendarAuthorityResolver } from '@projectx/outreach';
import { DynamicsIntelligenceAdapter, StaticWorkspaceDynamicsAuthorityResolver } from '@projectx/intelligence';
import { applyMigration } from '../../../infra/database/migrations/run';

const rootUrl = process.env.ADMIN_DATABASE_URL ?? 'postgresql://projectx:projectx@127.0.0.1:5433/postgres';
const migrationDir = resolve(__dirname, '../../../infra/database/migrations');
const tenant = 'slice14-tenant';
const workspace = '80000000-0000-4000-8000-000000000001';
const otherWorkspace = '80000000-0000-4000-8000-000000000002';
const userId = randomUUID();
const missionId = randomUUID();
const fingerprint = `h1.v1.${randomUUID()}`;
const ciphertext = `e1.v1.${randomUUID()}`;
const mailbox = 'revenue@example.test';
const clientState = randomUUID();
const ctx = { tenantId: asTenantId(tenant), workspaceId: workspace, userId, correlationId: asCorrelationId('slice14') };
let database: string;
let admin: Pool;
let app: Pool;
let missions: PostgresMissionRepository;
let campaigns: PostgresCampaignRepository;
let sequences: PostgresSequenceRepository;
let executions: PostgresMessageExecutionRepository;
let conversations: PostgresConversationRepository;

beforeAll(async () => {
  database = `projectx_slice14_${randomUUID().replace(/-/g, '')}`;
  const root = new Client({ connectionString: rootUrl }); await root.connect(); await root.query(`CREATE DATABASE ${database}`); await root.end();
  const url = new URL(rootUrl); url.pathname = `/${database}`;
  const migrator = new Client({ connectionString: url.toString() }); await migrator.connect(); await migrator.query('CREATE TABLE schema_migrations(filename TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  for (const file of readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()) await applyMigration(migrator, file, readFileSync(resolve(migrationDir, file), 'utf8'));
  await migrator.end(); admin = new Pool({ connectionString: url.toString() });
  const appUrl = new URL(url.toString()); appUrl.username = 'projectx_app'; appUrl.password = 'projectx_app'; app = new Pool({ connectionString: appUrl.toString() });
  await admin.query("SELECT set_config('app.current_tenant',$1,false)", [tenant]);
  await admin.query('INSERT INTO identity.users(id,email,tenant_id) VALUES($1,$2,$3)', [userId, 'operator@example.test', tenant]);
  await admin.query('INSERT INTO identity.workspaces(id,tenant_id,name,owner_user_id) VALUES($1,$2,$3,$4),($5,$2,$6,$4)', [workspace, tenant, 'Revenue A', userId, otherWorkspace, 'Revenue B']);
  await admin.query("INSERT INTO identity.memberships(workspace_id,tenant_id,user_id,role) VALUES($1,$2,$3,'OPERATOR'),($4,$2,$3,'MEMBER')", [workspace, tenant, userId, otherWorkspace]);
  await admin.query("INSERT INTO intelligence.accounts(account_id,tenant_id,workspace_id,name,industry,status) VALUES('account-1',$1,$2,'Acme','Manufacturing','QUALIFIED')", [tenant, workspace]);
  await admin.query("INSERT INTO intelligence.contacts(contact_id,tenant_id,workspace_id,account_id,email_fingerprint,encrypted_email,status,verification_state) VALUES('contact-1',$1,$2,'account-1',$3,$4,'VALIDATED','VERIFIED')", [tenant, workspace, fingerprint, ciphertext]);
  await admin.query("INSERT INTO intelligence.leads(tenant_id,id,payload,workspace_id,account_id,contact_id,status,scores,qualification_snapshot) VALUES($1,'lead-1',$2,$3,'account-1','contact-1','QUALIFIED',$4,$5)", [tenant, JSON.stringify({ workspaceId: workspace }), workspace, JSON.stringify({ fit: 0.9 }), JSON.stringify({ reasonCodes: ['ICP_MATCH'] })]);
  await admin.query("INSERT INTO outreach.tenant_email_config(tenant_id,provider_id,channel,from_address,allowed_domains,webhook_secret_reference) VALUES($1,'graph-email','email',$2,$3,'slice14-secret')", [tenant, mailbox, ['example.test']]);
  await admin.query("INSERT INTO outreach.inbound_mailbox_registry(normalized_mailbox,tenant_id,provider_id,channel) VALUES($1,$2,'graph-email','email')", [mailbox, tenant]);
  missions = new PostgresMissionRepository({ pool: app }); campaigns = new PostgresCampaignRepository({ pool: app }); sequences = new PostgresSequenceRepository({ pool: app }); executions = new PostgresMessageExecutionRepository({ pool: app }); conversations = new PostgresConversationRepository({ pool: app });
}, 180_000);

afterAll(async () => {
  await app?.end(); await admin?.end(); const root = new Client({ connectionString: rootUrl }); await root.connect(); await root.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]); await root.query(`DROP DATABASE IF EXISTS ${database}`); await root.end();
}, 60_000);

function campaign() { return OutreachCampaign.create({ id: asCampaignId('campaign-1'), tenantId: ctx.tenantId, workspaceId: workspace, leadId: 'lead-1' as never, contactId: 'contact-1', recipientFingerprint: fingerprint, recipientProtectionState: 'PROTECTED', channel: 'email', missionId, steps: [{ stepNumber: 1, channel: 'email', delayMs: 0, requiresApproval: true, objective: 'contact' }] }, ctx.correlationId, asEventId('campaign')); }
function sequence() { return OutreachSequence.create({ id: asSequenceId('sequence-1'), tenantId: ctx.tenantId, workspaceId: workspace, campaignId: asCampaignId('campaign-1'), leadId: 'lead-1' as never, contactId: 'contact-1', recipientFingerprint: fingerprint, recipientCiphertext: ciphertext, recipientProtectionState: 'PROTECTED', steps: [{ stepNumber: 1, channel: 'email', delayMs: 0, requiresApproval: true, objective: 'contact' }] }, ctx.correlationId, asEventId('sequence')); }

describe('Slice 14 canonical integrated product E2E', () => {
  it('runs authenticated workspace Mission through intelligence, outreach, inbound Conversation, and durable continuation', async () => {
    const principal = await admin.query('SELECT role FROM identity.memberships WHERE tenant_id=$1 AND workspace_id=$2 AND user_id=$3', [tenant, workspace, userId]);
    expect(principal.rows[0].role).toBe('OPERATOR');
    const created = Mission.create({ id: asMissionId(missionId), tenantId: ctx.tenantId, workspaceId: workspace, workspaceBindingState: 'WORKSPACE_BOUND', name: 'Autonomous pipeline', objective: 'Create qualified pipeline', icpId: 'icp-1', territory: ['US'], channels: ['email'], budget: { maxAiCostUsd: 100 }, autonomyLevel: 1, constraints: {}, successCriteria: { targetMeetings: 1 }, ownerUserId: asUserId(userId), plan: { planId: 'plan-1', version: 1, objectives: [], phases: [], approvalGates: [], fallbackBranches: [] } }, ctx.correlationId, asEventId('mission'));
    if (!created.success) throw created.error;
    await missions.save(ctx, created.value);
    const plannedCampaign = campaign(); const plannedSequence = sequence(); await campaigns.save(ctx, plannedCampaign); await sequences.save(ctx, plannedSequence);
    plannedSequence.linkWorkflow('workflow-1', ctx.correlationId, asEventId('workflow')); await sequences.save(ctx, plannedSequence);
    const approvalService = new ApprovalApplicationService({ approvalRepository: new PostgresApprovalRepository({ pool: app }), missionRepository: missions, workflowClient: { start: async () => ({} as never), signal: async () => undefined, query: async () => undefined as never, cancel: async () => undefined }, notificationPort: { notifyApprovalRequested: async () => undefined }, generateApprovalId: () => '83000000-0000-4000-8000-000000000001', generateEventId: () => randomUUID() as never, generateCorrelationId: () => asCorrelationId(randomUUID()) });
    const approvalId = await approvalService.requestApproval(ctx, { missionId, sequenceId: plannedSequence.id, actionType: 'OUTREACH_EMAIL_SEND', riskCategory: 'HIGH', proposedAction: {}, evidence: [], reasoning: 'Policy evidence summary', confidence: 0.9, requestedBy: userId, approverRole: 'OPERATOR', timeoutSeconds: 3600, idempotencyKey: asIdempotencyKey('send-1') });
    await approvalService.approve(ctx, { approvalId, actorId: userId, reason: 'Approved', decision: 'APPROVED' });
    const approvalPayload = await admin.query('SELECT payload FROM mission.approvals WHERE id=$1', [approvalId]);
    expect(approvalPayload.rows[0].payload).not.toHaveProperty('chainOfThought');
    const send = OutreachMessageExecution.create({ id: asOutreachExecutionId('execution-1'), tenantId: ctx.tenantId, workspaceId: workspace, campaignId: plannedCampaign.id, sequenceId: plannedSequence.id, stepNumber: 1, leadId: 'lead-1', contactId: 'contact-1', recipientFingerprint: fingerprint, recipientCiphertext: ciphertext, recipientProtectionState: 'PROTECTED', channel: 'email', idempotencyKey: asIdempotencyKey('send-1') }, ctx.correlationId, asEventId('execution'));
    send.startDrafting(ctx.correlationId, asEventId('draft')); send.setDraft('message-1' as never, { subject: 'Hello', body: 'Evidence-backed message', claims: [], evidenceReferences: [], unsupportedClaimsRemoved: [] }, ctx.correlationId, asEventId('drafted')); send.approve(approvalId as never, ctx.correlationId, asEventId('approved')); send.markSending(ctx.correlationId, asEventId('sending')); send.markProviderAttempt('deterministic-provider'); send.markProviderAccepted('<provider@example.test>', '<provider@example.test>', undefined, ctx.correlationId, asEventId('accepted')); send.markDeliveryPending(ctx.correlationId, asEventId('pending')); await executions.save(ctx, send);
    const subscriptions = new PostgresGraphSubscriptionRepository({ pool: app }); await subscriptions.save(ctx, { tenantId: tenant, workspaceId: workspace, subscriptionScope: 'WORKSPACE_BOUND', subscriptionId: 'sub-1', resource: `Users/${mailbox}/Messages`, notificationUrl: 'https://example.test/hook', clientState: clientState, expirationDateTime: new Date('2030-01-01') });
    const fetcher = new StubGraphInboundMessageFetcher(); fetcher.seed(mailbox, { id: 'reply-1', from: { emailAddress: { address: 'prospect@example.test' } }, toRecipients: [{ emailAddress: { address: mailbox } }], subject: 'Re: Hello', body: { contentType: 'text', content: 'Interested in meeting' }, receivedDateTime: '2026-01-01T00:00:00Z', internetMessageHeaders: [{ name: 'In-Reply-To', value: '<provider@example.test>' }] });
    const ingress = new GraphInboundIngressService({ validator: new GraphWebhookValidator({ secretsProvider: { getSecret: async () => clientState, getCertificate: async () => Buffer.alloc(0) } }), tenantResolver: new GraphTenantResolver(new PostgresTenantEmailConfigRepository({ pool: app })), subscriptionRepository: subscriptions, messageFetcher: fetcher, normalizer: new GraphMessageNormalizer(), correlator: new GraphReplyCorrelator({ messageExecutionRepository: executions, historicalRecipientFingerprint: { fingerprintEmailForVersion: async () => fingerprint } }), idempotencyStore: new PostgresIdempotencyStore({ pool: app }) });
    const inbound = await ingress.ingest({ subscriptionId: 'sub-1', changeType: 'created', resource: `Users/${mailbox}/Messages/reply-1`, clientState: clientState, resourceData: { id: 'reply-1' } });
    expect(inbound.status).toBe('PROCESSED'); if (inbound.status !== 'PROCESSED') return;
    const handler = new ConversationHandlingService({ conversationRepository: conversations, leadRepository: { load: async () => null, save: async () => undefined } as never, intentClassifier: { classify: async () => ({ intent: 'POSITIVE', confidence: 0.95, reason: 'positive reply' }) }, nextBestActionPolicy: { decide: () => ({ actionType: 'FOLLOW_UP', requiresApproval: false, reason: 'continue mission' }) }, piiScrubber: new NoOpPIIScrubber(), generateConversationId: () => 'conversation-1', generateReplyMessageId: () => 'reply-message-1', generateEventId: () => randomUUID() });
    const handled = await handler.handleReply(ctx, inbound.event); const reloaded = await conversations.load(ctx, handled.conversationId as never); await handler.classifyAndAct(ctx, reloaded!, 1);
    expect((await conversations.load(ctx, handled.conversationId as never))?.latestIntent).toBe('POSITIVE'); expect((await missions.findById(ctx, missionId))?.workspaceId).toBe(workspace);
    const durable = JSON.stringify((await admin.query("SELECT c.payload campaign,s.payload sequence,e.payload execution,v.payload conversation FROM outreach.campaigns c JOIN outreach.sequences s ON s.campaign_id=c.id JOIN outreach.message_executions e ON e.sequence_id=s.id JOIN conversation.conversations v ON v.execution_id=e.id WHERE c.id='campaign-1'")).rows[0]);
    expect(durable).not.toContain('prospect@example.test'); expect(durable).not.toMatch(/chain.?of.?thought/i);
  });

  it('denies wrong workspace across durable resources', async () => { const wrong = { ...ctx, workspaceId: otherWorkspace }; expect(await missions.findById(wrong, missionId)).toBeNull(); expect(await campaigns.load(wrong, asCampaignId('campaign-1'))).toBeNull(); expect(await sequences.load(wrong, asSequenceId('sequence-1'))).toBeNull(); expect(await executions.load(wrong, asOutreachExecutionId('execution-1'))).toBeNull(); expect(await conversations.load(wrong, 'conversation-1' as never)).toBeNull(); });
  it('denies forged approval actor and duplicate execution side effects', async () => { const approvals = new PostgresApprovalRepository({ pool: app }); const stored = await approvals.load(ctx, '83000000-0000-4000-8000-000000000001'); expect(stored?.decidedBy).toBe(userId); await expect(executions.save(ctx, OutreachMessageExecution.create({ id: asOutreachExecutionId('execution-duplicate'), tenantId: ctx.tenantId, workspaceId: workspace, campaignId: asCampaignId('campaign-1'), sequenceId: asSequenceId('sequence-1'), stepNumber: 1, leadId: 'lead-1', contactId: 'contact-1', recipientFingerprint: fingerprint, recipientCiphertext: ciphertext, recipientProtectionState: 'PROTECTED', channel: 'email', idempotencyKey: asIdempotencyKey('send-1') }, ctx.correlationId, asEventId('duplicate')))).rejects.toThrow(); });
  it('routes ambiguous submission to reconciliation without resend', async () => { const ambiguous = OutreachMessageExecution.create({ id: asOutreachExecutionId('execution-ambiguous'), tenantId: ctx.tenantId, workspaceId: workspace, campaignId: asCampaignId('campaign-1'), sequenceId: asSequenceId('sequence-1'), stepNumber: 2, leadId: 'lead-1', contactId: 'contact-1', recipientFingerprint: fingerprint, recipientCiphertext: ciphertext, recipientProtectionState: 'PROTECTED', channel: 'email', idempotencyKey: asIdempotencyKey('send-ambiguous') }, ctx.correlationId, asEventId('ambiguous')); ambiguous.startDrafting(ctx.correlationId, asEventId('a1')); ambiguous.setDraft('message-a' as never, { subject: 'x', body: 'x', claims: [], evidenceReferences: [], unsupportedClaimsRemoved: [] }, ctx.correlationId, asEventId('a2')); ambiguous.approve('83000000-0000-4000-8000-000000000001' as never, ctx.correlationId, asEventId('a3')); ambiguous.markSending(ctx.correlationId, asEventId('a4')); ambiguous.markProviderAttempt('deterministic-provider'); ambiguous.markDeliveryUnknown('ambiguous outcome', ctx.correlationId, asEventId('a5')); await executions.save(ctx, ambiguous); expect((await executions.load(ctx, ambiguous.id))?.status).toBe('DELIVERY_UNKNOWN'); });
  it('rejects forged Graph clientState before mutation', async () => {
    const before = await admin.query('SELECT count(*)::int count FROM conversation.conversations');
    const subscriptions = new PostgresGraphSubscriptionRepository({ pool: app });
    const fetcher = new StubGraphInboundMessageFetcher();
    fetcher.seed(mailbox, { id: 'forged-reply', from: { emailAddress: { address: 'prospect@example.test' } }, toRecipients: [{ emailAddress: { address: mailbox } }], body: { contentType: 'text', content: 'forged' }, internetMessageHeaders: [{ name: 'In-Reply-To', value: '<provider@example.test>' }] });
    const ingress = new GraphInboundIngressService({ validator: new GraphWebhookValidator({ secretsProvider: { getSecret: async () => clientState, getCertificate: async () => Buffer.alloc(0) } }), tenantResolver: new GraphTenantResolver(new PostgresTenantEmailConfigRepository({ pool: app })), subscriptionRepository: subscriptions, messageFetcher: fetcher, normalizer: new GraphMessageNormalizer(), correlator: new GraphReplyCorrelator({ messageExecutionRepository: executions, historicalRecipientFingerprint: { fingerprintEmailForVersion: async () => fingerprint } }), idempotencyStore: new PostgresIdempotencyStore({ pool: app }) });
    const result = await ingress.ingest({ subscriptionId: 'sub-1', changeType: 'created', resource: `Users/${mailbox}/Messages/forged-reply`, clientState: 'forged', resourceData: { id: 'forged-reply' } });
    expect(result.status).toBe('REJECTED');
    const after = await admin.query('SELECT count(*)::int count FROM conversation.conversations');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
  it('denies Dynamics and Calendar workspace mismatches', async () => { const dynamics = new DynamicsIntelligenceAdapter({ authorityResolver: new StaticWorkspaceDynamicsAuthorityResolver([]), secretsProvider: { getSecret: async () => '', getCertificate: async () => Buffer.alloc(0) }, tokenProviderFactory: { create: () => ({ getAccessToken: async () => '' }) }, httpClient: { get: async () => ({ value: [] }) } }); const calendar = new GraphCalendarProvider({ authorityResolver: new StaticWorkspaceCalendarAuthorityResolver([]), secretsProvider: { getSecret: async () => '', getCertificate: async () => Buffer.alloc(0) }, tokenProviderFactory: { create: () => ({ getAccessToken: async () => '' }) }, httpClient: {} as never }); await expect(dynamics.findAccounts({ ...ctx, workspaceId: otherWorkspace }, { limit: 1 })).rejects.toThrow('Dynamics access denied'); await expect(calendar.getEvent({ ...ctx, workspaceId: otherWorkspace }, 'event-1')).rejects.toThrow('Calendar access denied'); });
});
