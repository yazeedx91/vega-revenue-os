import type { IReasoningEngine, IOutputValidator, ReasoningOutput, ValidationResult } from '@projectx/ai-runtime';
import type { Lead, OutreachPlan, ProviderSendRequest, ProviderSendResult, TenantContext } from '@projectx/domain';
import type { IOutboundRecipientSource } from '../ports/outbound-recipient-source.interface';
import type {
  IHistoricalRecipientFingerprint,
  IOutboundRecipientRecovery,
} from '../ports/outbound-recipient-recovery.interface';
import { InMemoryAuditLog, InMemoryIdempotencyStore, InMemoryRateLimiter } from '@projectx/infrastructure';
import {
  asAccountId,
  asCampaignId,
  asContactId,
  asCorrelationId,
  asICPProfileId,
  asIdempotencyKey,
  asLeadId,
  asOutreachExecutionId,
  asOutreachMessageId,
  asSequenceId,
  asTenantId,
} from '@projectx/shared';
import { GraphEmailProvider } from '../infrastructure/graph/graph-email-provider';
import type { GraphHttpResponse, GraphSendMailRequest, GraphSentMessage, IGraphHttpClient } from '../infrastructure/graph/graph-http-client.interface';
import type { ITokenProvider } from '@projectx/infrastructure';
import {
  InMemoryApprovalVerificationPort,
  InMemoryCampaignRepository,
  InMemoryMessageExecutionRepository,
  InMemoryOutreachProviderRegistry,
  InMemoryRecipientAllowlistRepository,
  InMemorySequenceRepository,
  InMemorySequenceSchedulePolicy,
  InMemorySuppressionRepository,
  OutreachExecutionService,
  OutreachPersonalizationService,
  OutreachPlanningService,
  SendSafetyGate,
} from '../index';

const tenantA = asTenantId('tenant-a');
const ctx: TenantContext = { tenantId: tenantA, workspaceId: 'workspace-1', correlationId: asCorrelationId('corr-smoke') };

const fakeReasoningEngine: IReasoningEngine = {
  async reason(): Promise<ReasoningOutput> {
    return {
      rationale: 'Smoke-test draft',
      conclusion: JSON.stringify({
        subject: 'Hello from Phase 14.8',
        body: '<p>This is a validated smoke-test body.</p>',
        cta: 'Reply',
        tone: 'professional',
        claims: [],
      }),
      confidence: 0.9,
      evidence: [],
    };
  },
};

const fakeValidator: IOutputValidator = {
  async validate(): Promise<ValidationResult> {
    return { valid: true, safeOutput: '<p>This is a validated smoke-test body.</p>', piiCheck: 'PASSED' };
  },
};

class FakeTokenProvider implements ITokenProvider {
  callCount = 0;
  async getAccessToken(_scopes: string[]): Promise<string> {
    this.callCount += 1;
    return 'fake-graph-access-token';
  }
}

class FakeGraphHttpClient implements IGraphHttpClient {
  sendMailCalls: { accessToken: string; request: GraphSendMailRequest }[] = [];
  sentMessageId = '<smoke-msg-id@example.com>';

  async sendMail(accessToken: string, request: GraphSendMailRequest): Promise<GraphHttpResponse> {
    this.sendMailCalls.push({ accessToken, request });
    return { status: 202, headers: {}, body: '' };
  }

  async getSentMessage(
    _accessToken: string,
    options: { senderAddress: string; subject: string; recipientAddress: string; sentAfter: Date },
  ): Promise<GraphSentMessage | null> {
    return {
      id: 'graph-smoke-msg-id',
      internetMessageId: this.sentMessageId,
    };
  }
}

function makeLead(): Lead {
  return {
    id: asLeadId('lead-smoke'),
    tenantId: tenantA,
    workspaceId: 'workspace-1',
    accountId: asAccountId('acc-smoke'),
    contactId: asContactId('contact-smoke'),
    icpProfileId: asICPProfileId('icp-smoke'),
    icpProfileVersionId: asICPProfileId('icp-version-smoke'),
    scores: { icpMatch: 0.9, signalScore: 0.8, intentScore: 0.7, evidenceConfidence: 0.9, overall: 0.85 },
    status: 'QUALIFIED',
    evidenceReferences: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Lead;
}

class TestRecipientSource implements IOutboundRecipientSource {
  async resolveProtectedEmailRecipient(input: {
    tenantId: string;
    workspaceId: string;
    leadId: string;
    contactId: string;
  }) {
    return {
      contactId: input.contactId,
      recipientFingerprint: 'h1.1.fingerprint123',
      recipientCiphertext: 'e1.1.ciphertext456',
    };
  }
}

class TestRecipientRecovery implements IOutboundRecipientRecovery {
  async recoverEmailForSend(): Promise<string> {
    return 'test@example.com';
  }
}

class TestHistoricalRecipientFingerprint implements IHistoricalRecipientFingerprint {
  async fingerprintEmailForVersion(): Promise<string> {
    return 'h1.1.fingerprint123';
  }
}

function buildSmokeHarness(options?: { liveMode?: boolean }) {
  const liveMode = options?.liveMode ?? true;
  const campaignRepo = new InMemoryCampaignRepository();
  const sequenceRepo = new InMemorySequenceRepository();
  const executionRepo = new InMemoryMessageExecutionRepository();
  const registry = new InMemoryOutreachProviderRegistry();
  const tokenProvider = new FakeTokenProvider();
  const httpClient = new FakeGraphHttpClient();
  const provider = new GraphEmailProvider({
    tokenProvider,
    httpClient,
    senderAddress: 'smoke-sender@example.com',
    isLiveEmailEnabled: () => liveMode,
  });
  registry.register(provider as any);
  registry.setTenantProvider(tenantA as string, 'email', 'graph-email');

  const allowlistRepo = new InMemoryRecipientAllowlistRepository();
  const suppressionRepo = new InMemorySuppressionRepository();
  const approvalPort = new InMemoryApprovalVerificationPort();
  const auditLog = new InMemoryAuditLog();
  const idempotencyStore = new InMemoryIdempotencyStore();
  const rateLimiter = new InMemoryRateLimiter();
  const schedulePolicy = new InMemorySequenceSchedulePolicy();

  let seed = 0;
  const personalizationService = new OutreachPersonalizationService({
    reasoningEngine: fakeReasoningEngine,
    outputValidator: fakeValidator,
    generateMessageId: () => asOutreachMessageId(`msg-${++seed}`),
    generateExecutionId: () => `exec-${++seed}`,
    generateIdempotencyKey: (hint) => asIdempotencyKey(`idmp-${hint}-${++seed}`),
  });

  const safetyGate = new SendSafetyGate({
    allowlistRepository: allowlistRepo,
    suppressionRepository: suppressionRepo,
    approvalVerificationPort: approvalPort,
    rateLimiter,
    idempotencyStore,
    auditLog,
  });

  const executionService = new OutreachExecutionService({
    campaignRepository: campaignRepo,
    sequenceRepository: sequenceRepo,
    executionRepository: executionRepo,
    providerRegistry: registry,
    schedulePolicy,
    personalizationService,
    safetyGate,
    recipientRecovery: new TestRecipientRecovery(),
    historicalRecipientFingerprint: new TestHistoricalRecipientFingerprint(),
    generateExecutionId: () => `exec-${++seed}`,
    generateEventId: () => `evt-${++seed}` as any,
    channelCostEstimate: () => 0.1,
  });

  const planningService = new OutreachPlanningService({
    generateSequenceId: () => asSequenceId(`seq-${++seed}`),
    recipientSource: new TestRecipientSource(),
  });

  return {
    campaignRepo,
    sequenceRepo,
    executionRepo,
    executionService,
    allowlistRepo,
    approvalPort,
    auditLog,
    tokenProvider,
    httpClient,
    planningService,
  };
}

async function setupDraftedExecution(harness: ReturnType<typeof buildSmokeHarness>) {
  const { OutreachCampaign, OutreachSequence } = require('@projectx/domain');
  const lead = makeLead();
  const plan: OutreachPlan = await harness.planningService.plan(ctx, {
    campaignId: asCampaignId('camp-smoke'),
    lead,
    evidence: [],
  });

  const campaign = OutreachCampaign.create(
    {
      id: plan.campaignId,
      tenantId: tenantA,
      workspaceId: 'workspace-1',
      leadId: lead.contactId as string,
      contactId: lead.contactId as string,
      recipientFingerprint: plan.recipient.recipientFingerprint,
      recipientProtectionState: plan.recipient.recipientProtectionState,
      channel: plan.channel,
      steps: plan.steps,
      missionId: 'm-smoke',
    },
    ctx.correlationId,
    'evt-camp' as any,
  );
  await harness.campaignRepo.save(ctx, campaign);

  const sequence = OutreachSequence.create(
    {
      id: plan.sequenceId,
      tenantId: tenantA,
      workspaceId: 'workspace-1',
      campaignId: campaign.id,
      leadId: lead.contactId as string,
      contactId: lead.contactId as string,
      recipientFingerprint: plan.recipient.recipientFingerprint,
      recipientCiphertext: plan.recipient.recipientCiphertext,
      recipientProtectionState: plan.recipient.recipientProtectionState,
      steps: plan.steps,
    },
    ctx.correlationId,
    'evt-seq' as any,
  );
  sequence.submitForApproval(ctx.correlationId, 'evt-submit' as any);
  sequence.approve('approver-smoke' as any, 'approved', ctx.correlationId, 'evt-approve' as any);
  sequence.start(ctx.correlationId, 'evt-start' as any);
  await harness.sequenceRepo.save(ctx, sequence);

  const draft = await harness.executionService.prepareDraft(ctx, sequence.id as string, plan, lead, []);
  if (draft.status !== 'AWAITING_APPROVAL') {
    throw new Error(`Expected AWAITING_APPROVAL, got ${draft.status}`);
  }

  harness.approvalPort.seed({
    approvalId: 'approval-smoke',
    tenantId: tenantA as string,
    campaignId: campaign.id as string,
    sequenceId: sequence.id as string,
    executionId: draft.executionId as string,
    recipientFingerprint: plan.recipient.recipientFingerprint,
    actionType: 'OUTREACH_EMAIL_SEND',
    outcome: 'APPROVED',
  });

  return { campaign, sequence, executionId: draft.executionId as string };
}

describe('Phase 14.8 live-boundary smoke tests', () => {
  const originalEnv = process.env.OUTREACH_LIVE_EMAIL_ENABLED;

  beforeEach(() => {
    process.env.OUTREACH_LIVE_EMAIL_ENABLED = 'true';
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OUTREACH_LIVE_EMAIL_ENABLED;
    } else {
      process.env.OUTREACH_LIVE_EMAIL_ENABLED = originalEnv;
    }
  });

  it('live mode enabled + empty allowlist → NOT_ALLOWLISTED denial, no Graph token or HTTP call', async () => {
    const harness = buildSmokeHarness({ liveMode: true });
    const { executionId } = await setupDraftedExecution(harness);

    const result = await harness.executionService.executeApprovedSend(ctx, executionId as any, 'approval-smoke' as any);

    expect(result.status).toBe('FAILED');
    expect((result as any).reason).toContain('not on the tenant allowlist');
    expect(harness.tokenProvider.callCount).toBe(0);
    expect(harness.httpClient.sendMailCalls).toHaveLength(0);
  });

  it('live mode enabled + one allowlisted recipient → reaches Graph sendMail and returns ACCEPTED with real Message-ID', async () => {
    const harness = buildSmokeHarness({ liveMode: true });
    const recipient = 'test@example.com';
    await harness.allowlistRepo.add(ctx, { channel: 'email', address: recipient, approvedBy: 'smoke-test' });
    const { executionId } = await setupDraftedExecution(harness);

    const result = await harness.executionService.executeApprovedSend(ctx, executionId as any, 'approval-smoke' as any);

    expect(result.status).toBe('COMPLETED');
    expect(harness.tokenProvider.callCount).toBeGreaterThanOrEqual(1);
    expect(harness.httpClient.sendMailCalls).toHaveLength(1);
    expect(harness.httpClient.sendMailCalls[0].request.toRecipients).toContain(recipient);

    const execution = await harness.executionRepo.load(ctx, executionId as any);
    expect(execution?.providerMessageId).toBe(harness.httpClient.sentMessageId);

    const auditAllow = harness.auditLog.entries.find((e) => e.result === 'success');
    expect(auditAllow).toBeDefined();
  });

  it('live mode disabled → GraphEmailProvider returns LIVE_EMAIL_DISABLED even with allowlisted recipient', async () => {
    process.env.OUTREACH_LIVE_EMAIL_ENABLED = 'false';
    const harness = buildSmokeHarness({ liveMode: false });
    const recipient = 'allowed2@example.com';
    await harness.allowlistRepo.add(ctx, { channel: 'email', address: recipient, approvedBy: 'smoke-test' });
    const { executionId } = await setupDraftedExecution(harness);

    const result = await harness.executionService.executeApprovedSend(ctx, executionId as any, 'approval-smoke' as any);

    expect(result.status).toBe('FAILED');
    expect(harness.httpClient.sendMailCalls).toHaveLength(0);
  });
});
