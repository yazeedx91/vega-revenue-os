import { createHash } from 'crypto';
import { Pool } from 'pg';
import { createClient, type RedisClientType } from 'redis';
import { Connection } from '@temporalio/client';
import type { IReasoningEngine, IOutputValidator, ReasoningOutput, OutputValidationResult } from '@projectx/ai-runtime';
import type { OutreachPlan, Recipient, ResearchEvidence, SequenceStep, Lead } from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import { ConsoleTelemetry, RedisRateLimiter } from '@projectx/infrastructure';
import {
  ApprovalVerificationAdapter,
  InMemoryApprovalRepository,
} from '@projectx/mission-orchestrator';
import {
  InMemoryOutreachProviderRegistry,
  InMemorySequenceSchedulePolicy,
  OutreachExecutionService,
  OutreachPersonalizationService,
  PostgresCampaignRepository,
  PostgresMessageExecutionRepository,
  PostgresRecipientAllowlistRepository,
  PostgresSequenceRepository,
  PostgresSuppressionRepository,
  SendSafetyGate,
  type IEmailProvider,
} from '@projectx/outreach';
import { PostgresAuditLog, PostgresIdempotencyStore } from '@projectx/infrastructure';
import { Approval } from '@projectx/mission-orchestrator';
import {
  asAccountId,
  asCampaignId,
  asContactId,
  asCorrelationId,
  asEventId,
  asEvidenceId,
  asICPProfileId,
  asIdempotencyKey,
  asLeadId,
  asOutreachExecutionId,
  asOutreachMessageId,
  asResearchRequestId,
  asResearchRunId,
  asSequenceId,
  asTenantId,
  asUserId,
} from '@projectx/shared';
import type { CorrelationId } from '@projectx/shared';
import { OutreachCampaign, OutreachSequence } from '@projectx/domain';
import {
  DEFAULT_ADMIN_DATABASE_URL,
  DEFAULT_APP_DATABASE_URL,
  DEFAULT_REDIS_URL,
  DEFAULT_TEMPORAL_ADDRESS,
  getAdminDatabaseUrl,
  getAppDatabaseUrl,
  getRedisUrl,
  getTemporalAddress,
} from './integration-config';

export {
  DEFAULT_ADMIN_DATABASE_URL,
  DEFAULT_APP_DATABASE_URL,
  DEFAULT_REDIS_URL,
  DEFAULT_TEMPORAL_ADDRESS,
} from './integration-config';

export interface DurableAdapters {
  pool: Pool;
  redis: RedisClientType;
  campaignRepository: PostgresCampaignRepository;
  sequenceRepository: PostgresSequenceRepository;
  executionRepository: PostgresMessageExecutionRepository;
  allowlistRepository: PostgresRecipientAllowlistRepository;
  suppressionRepository: PostgresSuppressionRepository;
  auditLog: PostgresAuditLog;
  idempotencyStore: PostgresIdempotencyStore;
  rateLimiter: RedisRateLimiter;
  dispose(): Promise<void>;
}

export async function connectPostgres(url = getAppDatabaseUrl()): Promise<Pool> {
  const parsed = new URL(url);
  const pool = new Pool({
    host: '127.0.0.1',
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username || 'projectx'),
    password: decodeURIComponent(parsed.password || 'projectx'),
    database: (parsed.pathname || '/projectx').slice(1) || 'projectx',
    connectionTimeoutMillis: 2000,
  });
  await pool.query('SELECT 1');
  return pool;
}

export async function connectRedis(url = getRedisUrl()): Promise<RedisClientType> {
  const parsed = new URL(url);
  const client = createClient({
    url,
    socket: { family: 4 },
  });
  await client.connect();
  return client as unknown as RedisClientType;
}

export async function connectTemporal(address = getTemporalAddress()): Promise<Connection> {
  const host = address.includes(':') ? address.slice(0, address.lastIndexOf(':')) : address;
  const port = address.includes(':') ? address.slice(address.lastIndexOf(':') + 1) : '7233';
  return Connection.connect({ address: `127.0.0.1:${port}` });
}

function tenantSuffix(tenantId: string): string { return createHash('sha256').update(tenantId).digest('hex').slice(0, 12); }
export function workspaceForTenant(tenantId: string): string {
  const hex = createHash('sha256').update(`workspace:${tenantId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function accountForTenant(tenantId: string): string { return `account-e2e-${tenantSuffix(tenantId)}`; }
function contactForTenant(tenantId: string): string { return `contact-e2e-${tenantSuffix(tenantId)}`; }
function protectedTestRecipient(address: string) {
  const canonical = address.trim().toLowerCase();
  const encoded = Buffer.from(canonical).toString('base64url');
  return { fingerprint: `h1.v1.${encoded}`, ciphertext: `e1.v1.${encoded}` };
}

export async function seedOutreachOwnership(admin: Pool, tenantId: string, leadId: string, contactId: string, fingerprint?: string, ciphertext?: string): Promise<void> {
  const workspaceId = workspaceForTenant(tenantId);
  const ownerHex = createHash('sha256').update(`owner:${tenantId}`).digest('hex');
  const ownerId = `${ownerHex.slice(0, 8)}-${ownerHex.slice(8, 12)}-4${ownerHex.slice(13, 16)}-8${ownerHex.slice(17, 20)}-${ownerHex.slice(20, 32)}`;
  const accountId = accountForTenant(tenantId);
  await admin.query('INSERT INTO identity.users(id,email,tenant_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [ownerId, `${ownerId}@example.test`, tenantId]);
  await admin.query('INSERT INTO identity.workspaces(id,tenant_id,name,owner_user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [workspaceId, tenantId, 'E2E workspace', ownerId]);
  await admin.query('INSERT INTO intelligence.accounts(account_id,tenant_id,workspace_id,name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [accountId, tenantId, workspaceId, 'E2E account']);
  await admin.query("INSERT INTO intelligence.contacts(contact_id,tenant_id,workspace_id,account_id,email_fingerprint,encrypted_email,status,verification_state) VALUES($1,$2,$3,$4,$5,$6,'VALIDATED','VERIFIED') ON CONFLICT DO NOTHING", [contactId, tenantId, workspaceId, accountId, fingerprint ?? null, ciphertext ?? null]);
  await admin.query("INSERT INTO intelligence.leads(tenant_id,id,payload,workspace_id,account_id,contact_id,status) VALUES($1,$2,$3,$4,$5,$6,'QUALIFIED') ON CONFLICT DO NOTHING", [tenantId, leadId, JSON.stringify({ workspaceId }), workspaceId, accountId, contactId]);
}

class E2ECampaignRepository extends PostgresCampaignRepository {
  constructor(config: { pool: Pool }, private readonly admin: Pool) { super(config); }
  async save(ctx: any, entity: OutreachCampaign): Promise<void> { await seedOutreachOwnership(this.admin, String(ctx.tenantId), String(entity.leadId), String(entity.contactId), entity.recipientFingerprint); return super.save(ctx, entity); }
}
class E2ESequenceRepository extends PostgresSequenceRepository {
  constructor(config: { pool: Pool }, private readonly admin: Pool) { super(config); }
  async save(ctx: any, entity: OutreachSequence): Promise<void> { await seedOutreachOwnership(this.admin, String(ctx.tenantId), String(entity.leadId), String(entity.contactId), entity.recipientFingerprint, entity.recipientCiphertext); return super.save(ctx, entity); }
}

export async function createDurableAdapters(): Promise<DurableAdapters> {
  const [pool, adminPool, redis] = await Promise.all([connectPostgres(), connectPostgres(getAdminDatabaseUrl()), connectRedis()]);
  const auditLog = new PostgresAuditLog({ pool });
  const idempotencyStore = new PostgresIdempotencyStore({ pool });
  const rateLimiter = new RedisRateLimiter(redis);
  return {
    pool,
    redis,
    campaignRepository: new E2ECampaignRepository({ pool }, adminPool),
    sequenceRepository: new E2ESequenceRepository({ pool }, adminPool),
    executionRepository: new PostgresMessageExecutionRepository({ pool }),
    allowlistRepository: new PostgresRecipientAllowlistRepository({ pool }),
    suppressionRepository: new PostgresSuppressionRepository({ pool }),
    auditLog,
    idempotencyStore,
    rateLimiter,
    async dispose() {
      await pool.end();
      await adminPool.end();
      await redis.disconnect();
    },
  };
}

export function createTenantContext(tenantId: string, actor?: { id: string; role: string }): TenantContext {
  return {
    tenantId: asTenantId(tenantId),
    workspaceId: workspaceForTenant(tenantId),
    correlationId: asCorrelationId(`e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    ...(actor ? { actor } : {}),
  } as TenantContext;
}

export function createStubReasoningEngine(): IReasoningEngine {
  return {
    async reason(): Promise<ReasoningOutput> {
      return {
        rationale: 'E2E stub reasoning',
        conclusion: JSON.stringify({
          subject: 'Hello from ProjectX',
          body: '<p>This is a deterministic E2E outreach message.</p>',
          cta: 'Reply to this email',
          tone: 'professional',
          claims: [{ text: 'Generated by E2E stub', evidenceId: 'evidence-e2e', confidence: 0.9 }],
        }),
        confidence: 0.9,
        evidence: [],
      };
    },
  };
}

export function createStubOutputValidator(): IOutputValidator {
  return {
    async validate(): Promise<OutputValidationResult> {
      return { valid: true, safeOutput: '<p>This is a deterministic E2E outreach message.</p>', piiCheck: 'PASSED' };
    },
  };
}

export function createExecutionService(
  adapters: DurableAdapters,
  tenantId: string,
  emailProvider: IEmailProvider,
  approvalRepo?: InMemoryApprovalRepository,
) {
  const sharedApprovalRepo = approvalRepo ?? new InMemoryApprovalRepository();
  const approvalVerification = new ApprovalVerificationAdapter(sharedApprovalRepo);
  const registry = new InMemoryOutreachProviderRegistry();
  registry.register(emailProvider);
  registry.setTenantProvider(tenantId, 'email', emailProvider.providerId);

  const personalizationService = new OutreachPersonalizationService({
    reasoningEngine: createStubReasoningEngine(),
    outputValidator: createStubOutputValidator(),
    generateMessageId: () => asOutreachMessageId(`msg-e2e-${Date.now()}`),
    generateExecutionId: () => `exec-e2e-${Date.now()}`,
    generateIdempotencyKey: (hint: string) => asIdempotencyKey(`idmp-e2e-${hint}-${Date.now()}`),
  });

  const safetyGate = new SendSafetyGate({
    allowlistRepository: adapters.allowlistRepository,
    suppressionRepository: adapters.suppressionRepository,
    approvalVerificationPort: approvalVerification,
    rateLimiter: adapters.rateLimiter,
    idempotencyStore: adapters.idempotencyStore,
    auditLog: adapters.auditLog,
  });

  return {
    service: new OutreachExecutionService({
      campaignRepository: adapters.campaignRepository,
      sequenceRepository: adapters.sequenceRepository,
      executionRepository: adapters.executionRepository,
      providerRegistry: registry,
      schedulePolicy: new InMemorySequenceSchedulePolicy(),
      personalizationService,
      safetyGate,
      recipientRecovery: { recoverEmailForSend: async (_tenantId: string, value: string) => Buffer.from(value.split('.')[2] ?? '', 'base64url').toString('utf8') },
      historicalRecipientFingerprint: { fingerprintEmailForVersion: async (_tenantId: string, address: string, version: string) => `h1.${version}.${Buffer.from(address.trim().toLowerCase()).toString('base64url')}` },
      idempotencyStore: adapters.idempotencyStore,
      generateExecutionId: () => `exec-e2e-${Date.now()}`,
      generateEventId: () => asEventId(`evt-e2e-${Date.now()}`),
      channelCostEstimate: () => 0.05,
    }),
    approvalRepo: sharedApprovalRepo,
  };
}

export function buildCampaign(tenantId: string, campaignId?: string, recipientAddress?: string): OutreachCampaign {
  const id = campaignId ?? `campaign-e2e-${Date.now()}`;
  const recipient: Recipient = {
    contactId: asContactId(contactForTenant(tenantId)),
    channel: 'email',
    address: recipientAddress ?? 'lead@example.com',
    name: 'E2E Lead',
  };
  const protectedRecipient = protectedTestRecipient(recipient.address);
  const step: SequenceStep = {
    stepNumber: 1,
    channel: 'email',
    delayMs: 0,
    requiresApproval: true,
    objective: 'first-touch',
  };
  const campaign = OutreachCampaign.create(
    {
      tenantId: asTenantId(tenantId),
      workspaceId: workspaceForTenant(tenantId),
      id: asCampaignId(id),
      leadId: asLeadId('lead-e2e'),
      contactId: recipient.contactId,
      recipientFingerprint: protectedRecipient.fingerprint,
      recipientProtectionState: 'PROTECTED',
      channel: 'email',
      steps: [step],
      budget: { maxSendCount: 10, maxCostUsd: 5 },
    },
    asCorrelationId('corr-e2e'),
    asEventId('evt-campaign-create'),
  );
  const submitResult = campaign.submitForApproval(asCorrelationId('corr-e2e'), asEventId('evt-campaign-submit'));
  if (!submitResult.success) throw new Error(submitResult.error.message);
  const approveResult = campaign.approve(
    asUserId('e2e-operator'),
    'Auto-approved for E2E setup',
    asCorrelationId('corr-e2e'),
    asEventId('evt-campaign-approve'),
  );
  if (!approveResult.success) throw new Error(approveResult.error.message);
  const startResult = campaign.start(asCorrelationId('corr-e2e'), asEventId('evt-campaign-start'));
  if (!startResult.success) throw new Error(startResult.error.message);
  return campaign;
}

export function buildSequence(tenantId: string, campaignId: string, sequenceId?: string, recipientAddress?: string): OutreachSequence {
  const id = sequenceId ?? `sequence-e2e-${Date.now()}`;
  const recipient: Recipient = {
    contactId: asContactId(contactForTenant(tenantId)),
    channel: 'email',
    address: recipientAddress ?? 'lead@example.com',
    name: 'E2E Lead',
  };
  const protectedRecipient = protectedTestRecipient(recipient.address);
  const step: SequenceStep = {
    stepNumber: 1,
    channel: 'email',
    delayMs: 0,
    requiresApproval: true,
    objective: 'first-touch',
  };
  const sequence = OutreachSequence.create(
    {
      tenantId: asTenantId(tenantId),
      workspaceId: workspaceForTenant(tenantId),
      id: asSequenceId(id),
      campaignId: asCampaignId(campaignId),
      leadId: asLeadId('lead-e2e'),
      contactId: recipient.contactId,
      recipientFingerprint: protectedRecipient.fingerprint,
      recipientCiphertext: protectedRecipient.ciphertext,
      recipientProtectionState: 'PROTECTED',
      steps: [step],
    },
    asCorrelationId('corr-e2e'),
    asEventId('evt-sequence-create'),
  );
  const submitResult = sequence.submitForApproval(asCorrelationId('corr-e2e'), asEventId('evt-sequence-submit'));
  if (!submitResult.success) throw new Error(submitResult.error.message);
  const approveResult = sequence.approve(
    asUserId('e2e-operator'),
    'Auto-approved for E2E setup',
    asCorrelationId('corr-e2e'),
    asEventId('evt-sequence-approve'),
  );
  if (!approveResult.success) throw new Error(approveResult.error.message);
  const startResult = sequence.start(asCorrelationId('corr-e2e'), asEventId('evt-sequence-start'));
  if (!startResult.success) throw new Error(startResult.error.message);
  return sequence;
}

export function buildLead(tenantId: string): Lead {
  return {
    id: asLeadId('lead-e2e'),
    tenantId: asTenantId(tenantId),
    accountId: asAccountId(accountForTenant(tenantId)),
    contactId: asContactId(contactForTenant(tenantId)),
    icpProfileId: asICPProfileId('icp-e2e'),
    scores: { icpMatch: 0.9, signalScore: 0.8, intentScore: 0.7, evidenceConfidence: 0.9, overall: 0.85 },
    status: 'QUALIFIED',
    decisionReason: 'E2E lead',
    evidenceReferences: [asEvidenceId('evidence-e2e')],
  } as unknown as Lead;
}

export function recipientFromSequence(sequence: OutreachSequence): Recipient {
  const address = Buffer.from((sequence.recipientCiphertext ?? '').split('.')[2] ?? '', 'base64url').toString('utf8');
  return { contactId: asContactId(sequence.contactId), channel: 'email', address, name: 'E2E Lead' };
}

export function buildPlan(campaignId: string, sequenceId: string, recipient: Recipient): OutreachPlan {
  const step: SequenceStep = {
    stepNumber: 1,
    channel: 'email',
    delayMs: 0,
    requiresApproval: true,
    objective: 'first-touch',
  };
  return {
    campaignId: asCampaignId(campaignId),
    sequenceId: asSequenceId(sequenceId),
    leadId: asLeadId('lead-e2e'),
    recipient,
    channel: 'email',
    steps: [step],
    firstDueAt: new Date(),
    evidenceReferences: [asEvidenceId('evidence-e2e')],
    requiresApproval: true,
  };
}

export function buildEvidence(tenantId: string): ResearchEvidence {
  const now = new Date();
  return new (require('@projectx/domain').ResearchEvidence)({
    evidenceId: asEvidenceId('evidence-e2e'),
    tenantId: asTenantId(tenantId),
    workspaceId: workspaceForTenant(tenantId),
    requestId: asResearchRequestId('request-e2e'),
    runId: asResearchRunId('run-e2e'),
    claimType: 'stub',
    normalizedValue: 'E2E evidence',
    source: 'e2e-stub',
    reliabilityTier: 'USER_PROVIDED',
    observedAt: now.toISOString(),
    freshnessExpiry: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    confidence: 0.9,
    confidenceBreakdown: { sourceReliability: 0.9, extractionConfidence: 0.9, corroboration: 0.9 },
    provenance: [],
    evidenceFingerprint: 'evidence_e2e_fingerprint',
  });
}

export async function seedTenantAllowlist(
  adapters: DurableAdapters,
  ctx: TenantContext,
  address: string,
): Promise<void> {
  await adapters.allowlistRepository.add(ctx, {
    channel: 'email',
    address,
    displayName: 'E2E Test Lead',
    approvedBy: 'e2e-operator',
    reason: 'Allowlisted for deterministic E2E lifecycle',
  });
}

export async function runMigrations(url = getAdminDatabaseUrl()): Promise<void> {
  process.env.DATABASE_URL = url;
  const { main } = await import('../../../infra/database/migrations/run');
  await main();
}

export function requireEnv(): void {
  if (!process.env.APP_DATABASE_URL) {
    process.env.APP_DATABASE_URL = DEFAULT_APP_DATABASE_URL;
  }
  if (!process.env.ADMIN_DATABASE_URL) {
    process.env.ADMIN_DATABASE_URL = DEFAULT_ADMIN_DATABASE_URL;
  }
  if (!process.env.REDIS_URL) process.env.REDIS_URL = DEFAULT_REDIS_URL;
  if (!process.env.TEMPORAL_ADDRESS) process.env.TEMPORAL_ADDRESS = DEFAULT_TEMPORAL_ADDRESS;
}

export const telemetry = new ConsoleTelemetry({ serviceName: 'projectx-e2e' });
