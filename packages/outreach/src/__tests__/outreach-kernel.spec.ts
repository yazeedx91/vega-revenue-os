import type { IReasoningEngine, IOutputValidator, ReasoningOutput, ValidationResult } from '@projectx/ai-runtime';
import type { Lead, OutreachPlan, TenantContext } from '@projectx/domain';
import { ResearchEvidence } from '@projectx/domain';
import type { IOutboundRecipientSource } from '../ports/outbound-recipient-source.interface';
import type {
  IHistoricalRecipientFingerprint,
  IOutboundRecipientRecovery,
} from '../ports/outbound-recipient-recovery.interface';
import {
  asAccountId,
  asCampaignId,
  asContactId,
  asCorrelationId,
  asEvidenceId,
  asICPProfileId,
  asIdempotencyKey,
  asLeadId,
  asOutreachMessageId,
  asSequenceId,
  asResearchRequestId,
  asResearchRunId,
  asTenantId,
} from '@projectx/shared';
import { InMemoryAuditLog, InMemoryIdempotencyStore, InMemoryRateLimiter } from '@projectx/infrastructure';
import {
  InMemoryApprovalVerificationPort,
  InMemoryCampaignRepository,
  InMemoryMessageExecutionRepository,
  InMemoryOutreachProviderRegistry,
  InMemoryRecipientAllowlistRepository,
  InMemorySequenceRepository,
  InMemorySequenceSchedulePolicy,
  InMemorySuppressionRepository,
  OutreachAgentExecutor,
  OutreachExecutionService,
  OutreachPersonalizationService,
  OutreachPlanningService,
  SendSafetyGate,
  StubCalendarProvider,
  StubEmailProvider,
} from '../index';

describe('Outreach Execution Kernel', () => {
  const tenantA = asTenantId('tenant-a');
  const tenantB = asTenantId('tenant-b');
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  let ctx: TenantContext & { workspaceId: string };

  beforeEach(() => {
    ctx = { tenantId: tenantA,
          workspaceId, workspaceId, correlationId: asCorrelationId('corr-1') };
  });

  const makeLead = (tenantId = tenantA, contactSuffix = '1'): Lead =>
    ({
      id: asLeadId(`lead-${contactSuffix}`),
      tenantId,
      workspaceId,
      accountId: asAccountId(`acc-${contactSuffix}`),
      contactId: asContactId(`contact-${contactSuffix}`),
      icpProfileId: asICPProfileId('icp-1'),
      scores: {
        icpMatch: 0.9,
        signalScore: 0.8,
        intentScore: 0.7,
        evidenceConfidence: 0.9,
        overall: 0.85,
      },
      status: 'QUALIFIED',
      evidenceReferences: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Lead);

  const makeEvidence = (id: string, tenantId = tenantA): ResearchEvidence =>
    new ResearchEvidence({
      evidenceId: asEvidenceId(id),
      tenantId,
      workspaceId: '00000000-0000-4000-8000-000000000001',
      requestId: asResearchRequestId(`request-${id}`),
      runId: asResearchRunId(`run-${id}`),
      claimType: 'funding-round',
      normalizedValue: 'raised Series B',
      source: 'test',
      reliabilityTier: 'PUBLIC_RECORD',
      observedAt: new Date().toISOString(),
      freshnessExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      confidence: 0.9,
      confidenceBreakdown: { sourceReliability: 0.9, extractionConfidence: 0.9, corroboration: 0.9 },
      provenance: [],
      evidenceFingerprint: `fingerprint-${id}`,
    });

  const fakeReasoningEngine: IReasoningEngine = {
    async reason(): Promise<ReasoningOutput> {
      return {
        rationale: 'Evidence-backed draft',
        conclusion: JSON.stringify({
          subject: 'Exciting update',
          body: 'I saw you raised Series B. Congrats!',
          cta: 'Book a call',
          tone: 'professional',
          claims: [{ text: 'raised Series B', evidenceId: 'ev-1', confidence: 0.9 }],
        }),
        confidence: 0.9,
        evidence: [],
      };
    },
  };

  const reasoningWithUnsupportedClaim: IReasoningEngine = {
    async reason(): Promise<ReasoningOutput> {
      return {
        rationale: 'Mixed evidence',
        conclusion: JSON.stringify({
          subject: 'Update',
          body: 'I saw you raised Series B and you have 500 employees.',
          cta: 'Reply',
          tone: 'professional',
          claims: [
            { text: 'raised Series B', evidenceId: 'ev-1', confidence: 0.9 },
            { text: 'has 500 employees', evidenceId: 'ev-missing', confidence: 0.5 },
          ],
        }),
        confidence: 0.7,
        evidence: [],
      };
    },
  };

  const fakeValidator: IOutputValidator = {
    async validate(): Promise<ValidationResult> {
      return { valid: true, safeOutput: 'I saw you raised Series B. Congrats!', piiCheck: 'PASSED' };
    },
  };

  const strictValidator: IOutputValidator = {
    async validate(): Promise<ValidationResult> {
      return {
        valid: false,
        safeOutput: '',
        piiCheck: 'FAILED',
        policyViolations: ['PII detected'],
      };
    },
  };

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

  function buildServices(tenantId = tenantA) {
    const campaignRepo = new InMemoryCampaignRepository();
    const sequenceRepo = new InMemorySequenceRepository();
    const executionRepo = new InMemoryMessageExecutionRepository();
    const registry = new InMemoryOutreachProviderRegistry();
    const schedulePolicy = new InMemorySequenceSchedulePolicy();
    let seed = 0;
    const planningService = new OutreachPlanningService({
      generateSequenceId: () => asSequenceId(`seq-${++seed}`),
      recipientSource: new TestRecipientSource(),
    });

    const personalizationService = new OutreachPersonalizationService({
      reasoningEngine: fakeReasoningEngine,
      outputValidator: fakeValidator,
      generateMessageId: () => asOutreachMessageId(`msg-${++seed}`),
      generateExecutionId: () => `exec-${++seed}`,
      generateIdempotencyKey: (hint) => asIdempotencyKey(`idmp-${hint}-${++seed}`),
    });

    const allowlistRepo = new InMemoryRecipientAllowlistRepository();
    const suppressionRepo = new InMemorySuppressionRepository();
    const approvalPort = new InMemoryApprovalVerificationPort();
    const auditLog = new InMemoryAuditLog();
    const idempotencyStore = new InMemoryIdempotencyStore();
    const rateLimiter = new InMemoryRateLimiter();

    const safetyGate = new SendSafetyGate({
      allowlistRepository: allowlistRepo,
      suppressionRepository: suppressionRepo,
      approvalVerificationPort: approvalPort,
      rateLimiter,
      idempotencyStore,
      auditLog,
      // No rate-limit windows configured for these behavior tests — rate
      // limiting itself is covered by dedicated send-safety-gate.spec.ts tests.
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
      idempotencyStore,
      generateExecutionId: () => `exec-${++seed}`,
      generateEventId: () => `evt-${++seed}` as any,
      channelCostEstimate: () => 0.1,
    });

    const agentExecutor = new OutreachAgentExecutor({
      planningService,
      executionService,
      campaignRepository: campaignRepo,
      sequenceRepository: sequenceRepo,
      generateEventId: () => `evt-${++seed}`,
    });

    return {
      campaignRepo,
      sequenceRepo,
      executionRepo,
      registry,
      planningService,
      executionService,
      schedulePolicy,
      agentExecutor,
      allowlistRepo,
      suppressionRepo,
      approvalPort,
      auditLog,
    };
  }

  /** Seeds the allowlist + an APPROVED approval record so `executeApprovedSend` passes the safety gate in these behavior tests. */
  async function authorizeSend(
    deps: ReturnType<typeof buildServices>,
    params: { tenantId: typeof tenantA; campaignId: string; sequenceId: string; executionId: string; recipientFingerprint: string; actionType?: string },
  ): Promise<void> {
    await deps.allowlistRepo.add(
      { tenantId: params.tenantId, correlationId: asCorrelationId('corr-authorize') },
      { channel: 'email', address: 'test@example.com', approvedBy: 'test-harness' },
    );
    deps.approvalPort.seed({
      approvalId: 'approval-1',
      tenantId: params.tenantId as string,
      campaignId: params.campaignId,
      sequenceId: params.sequenceId,
      executionId: params.executionId,
      recipientFingerprint: params.recipientFingerprint,
      actionType: params.actionType ?? 'OUTREACH_EMAIL_SEND',
      outcome: 'APPROVED',
    });
  }

  describe('domain aggregates', () => {
    it('campaign lifecycle enforces status transitions and budgets', () => {
      const { OutreachCampaign } = require('@projectx/domain');
      const campaign = OutreachCampaign.create(
        {
          id: asCampaignId('camp-1'),
          tenantId: tenantA,
          workspaceId,
          leadId: 'lead-1',
          contactId: 'c1',
          recipientFingerprint: 'h1.1.fingerprint123',
          recipientProtectionState: 'PROTECTED',
          channel: 'email',
          steps: [{ stepNumber: 1, channel: 'email', delayMs: 0, requiresApproval: true, objective: 'first-touch' }],
          missionId: 'm-1',
        },
        asCorrelationId('corr-1'),
        'evt-1' as any,
      );

      expect(campaign.status).toBe('DRAFT');
      expect(campaign.recordSpend(1, 0.1)).toBe(true);
      expect(campaign.sentCount).toBe(1);

      campaign.submitForApproval(asCorrelationId('corr-2'), 'evt-2' as any);
      expect(campaign.status).toBe('PENDING_APPROVAL');
      campaign.approve('approver-1' as any, 'approved', asCorrelationId('corr-3'), 'evt-3' as any);
      expect(campaign.status).toBe('APPROVED');
      campaign.start(asCorrelationId('corr-4'), 'evt-4' as any);
      expect(campaign.status).toBe('RUNNING');
      campaign.complete(asCorrelationId('corr-5'), 'evt-5' as any);
      expect(campaign.status).toBe('COMPLETED');
    });

    it('rejects cross-tenant loads', async () => {
      const repo = new InMemoryCampaignRepository();
      const { OutreachCampaign } = require('@projectx/domain');
      const campaign = OutreachCampaign.create(
        {
          id: asCampaignId('camp-1'),
          tenantId: tenantA,
          workspaceId,
          leadId: 'lead-1',
          contactId: 'c1',
          recipientFingerprint: 'h1.1.fingerprint123',
          recipientProtectionState: 'PROTECTED',
          channel: 'email',
          steps: [{ stepNumber: 1, channel: 'email', delayMs: 0, requiresApproval: true, objective: 'first-touch' }],
          missionId: 'm-1',
        },
        asCorrelationId('corr-1'),
        'evt-1' as any,
      );
      await repo.save(ctx, campaign);
      await expect(repo.load({ tenantId: tenantB, workspaceId, correlationId: asCorrelationId('x') }, campaign.id)).resolves.toBeNull();
    });
  });

  describe('planning service', () => {
    it('creates an email outreach plan with business hours', async () => {
      const svc = new OutreachPlanningService({
        generateSequenceId: () => asSequenceId('seq-1'),
        recipientSource: new TestRecipientSource(),
      });
      const lead = makeLead();
      const evidence = [makeEvidence('ev-1')];
      const plan = await svc.plan(ctx, { campaignId: asCampaignId('camp-1'), lead, evidence, channels: ['email'] });

      expect(plan.channel).toBe('email');
      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
      expect(plan.recipient.recipientFingerprint).toBe('h1.1.fingerprint123');
      expect(plan.businessHours.timezone).toBe('UTC');
      expect(plan.requiresApproval).toBe(true);
    });
  });

  describe('personalization service', () => {
    it('produces an evidence-backed draft and removes unsupported claims', async () => {
      const svc = new OutreachPersonalizationService({
        reasoningEngine: fakeReasoningEngine,
        outputValidator: fakeValidator,
        generateMessageId: () => asOutreachMessageId('msg-1'),
        generateExecutionId: () => 'exec-1',
        generateIdempotencyKey: (hint) => asIdempotencyKey(`idmp-${hint}`),
      });
      const lead = makeLead();
      const evidence = [makeEvidence('ev-1')];
      const plan = await new OutreachPlanningService({
        generateSequenceId: () => asSequenceId('seq-1'),
        recipientSource: new TestRecipientSource(),
      }).plan(ctx, {
        campaignId: asCampaignId('camp-1'),
        lead,
        evidence,
      });

      const result = await svc.personalize(ctx, plan, lead, evidence);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.value.draft.claims.length).toBe(1);
      expect(result.value.draft.evidenceReferences).toContain(asEvidenceId('ev-1'));
    });

    it('rejects drafts that fail output validation', async () => {
      const svc = new OutreachPersonalizationService({
        reasoningEngine: fakeReasoningEngine,
        outputValidator: strictValidator,
        generateMessageId: () => asOutreachMessageId('msg-1'),
        generateExecutionId: () => 'exec-1',
        generateIdempotencyKey: (hint) => asIdempotencyKey(`idmp-${hint}`),
      });
      const lead = makeLead();
      const evidence = [makeEvidence('ev-1')];
      const plan = await new OutreachPlanningService({
        generateSequenceId: () => asSequenceId('seq-1'),
        recipientSource: new TestRecipientSource(),
      }).plan(ctx, {
        campaignId: asCampaignId('camp-1'),
        lead,
        evidence,
      });
      const result = await svc.personalize(ctx, plan, lead, evidence);
      expect(result.success).toBe(false);
    });

    it('removes unsupported claims and keeps evidence-backed ones', async () => {
      const svc = new OutreachPersonalizationService({
        reasoningEngine: reasoningWithUnsupportedClaim,
        outputValidator: fakeValidator,
        generateMessageId: () => asOutreachMessageId('msg-1'),
        generateExecutionId: () => 'exec-1',
        generateIdempotencyKey: (hint) => asIdempotencyKey(`idmp-${hint}`),
      });
      const lead = makeLead();
      const evidence = [makeEvidence('ev-1')];
      const plan = await new OutreachPlanningService({
        generateSequenceId: () => asSequenceId('seq-1'),
        recipientSource: new TestRecipientSource(),
      }).plan(ctx, {
        campaignId: asCampaignId('camp-1'),
        lead,
        evidence,
      });
      const result = await svc.personalize(ctx, plan, lead, evidence);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.value.draft.claims.map((c: { text: string }) => c.text)).toContain('raised Series B');
      expect(result.value.draft.claims.map((c: { text: string }) => c.text)).not.toContain('has 500 employees');
      expect(result.value.draft.unsupportedClaimsRemoved).toContain('has 500 employees');
    });
  });

  describe('provider stubs', () => {
    it('email provider succeeds and deduplicates by idempotency key', async () => {
      const provider = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
      const req = {
        idempotencyKey: asIdempotencyKey('key-1'),
        correlationId: asCorrelationId('c1'),
        executionId: 'exec-1' as any,
        tenantId: tenantA,
          workspaceId,
        campaignId: asCampaignId('camp-1'),
        sequenceId: asSequenceId('seq-1'),
        messageId: asOutreachMessageId('msg-1'),
        recipientAddress: 'a@b.com',
        body: 'hi',
        channel: 'email' as const,
      };
      const r1 = await provider.send(ctx, req);
      expect(r1.status).toBe('PROVIDER_ACCEPTED');
      const r2 = await provider.send(ctx, req);
      expect(r2.status).toBe('PROVIDER_ACCEPTED');
    });

    it('timeout-after-accept returns AMBIGUOUS and deduplicates safe retry', async () => {
      const provider = new StubEmailProvider({ type: 'timeout-after-accept', costUsd: 0.05 });
      const req = {
        idempotencyKey: asIdempotencyKey('key-1'),
        correlationId: asCorrelationId('c1'),
        executionId: 'exec-1' as any,
        tenantId: tenantA,
          workspaceId,
        campaignId: asCampaignId('camp-1'),
        sequenceId: asSequenceId('seq-1'),
        messageId: asOutreachMessageId('msg-1'),
        recipientAddress: 'a@b.com',
        body: 'hi',
        channel: 'email' as const,
      };
      const first = await provider.send(ctx, req);
      expect(first.status).toBe('AMBIGUOUS');
      const retry = await provider.send(ctx, req);
      expect(retry.status).toBe('PROVIDER_ACCEPTED');
    });

    it('calendar provider is unsupported', async () => {
      const provider = new StubCalendarProvider();
      const result = await provider.send(ctx, {
        idempotencyKey: asIdempotencyKey('key-1'),
        correlationId: asCorrelationId('c1'),
        executionId: 'exec-1' as any,
        tenantId: tenantA,
          workspaceId,
        campaignId: asCampaignId('camp-1'),
        sequenceId: asSequenceId('seq-1'),
        messageId: asOutreachMessageId('msg-1'),
        recipientAddress: 'a@b.com',
        body: 'hi',
        channel: 'calendar' as const,
      });
      expect(result.status).toBe('FAILED');
      expect(result.retryClassification).toBe('NON_RETRYABLE');
    });
  });

  describe('execution service', () => {
    it('prepares a draft and awaits approval', async () => {
      const deps = buildServices();
      const lead = makeLead();
      const evidence = [makeEvidence('ev-1')];
      const plan = await deps.planningService.plan(ctx, { campaignId: asCampaignId('camp-1'), lead, evidence });
      const { OutreachCampaign, OutreachSequence } = require('@projectx/domain');

      const campaign = OutreachCampaign.create(
        {
          id: plan.campaignId,
          tenantId: tenantA,
          workspaceId,
          leadId: lead.contactId as string,
          contactId: lead.contactId as string,
          recipientFingerprint: plan.recipient.recipientFingerprint,
          recipientProtectionState: plan.recipient.recipientProtectionState,
          channel: plan.channel,
          steps: plan.steps,
          missionId: 'm-1',
        },
        ctx.correlationId,
        'evt-1' as any,
      );
      campaign.submitForApproval(ctx.correlationId, 'evt-2' as any);
      campaign.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-3' as any);
      campaign.start(ctx.correlationId, 'evt-4' as any);
      await deps.campaignRepo.save(ctx, campaign);

      const sequence = OutreachSequence.create(
        {
          id: plan.sequenceId,
          tenantId: tenantA,
          workspaceId,
          campaignId: campaign.id,
          leadId: lead.contactId as string,
          contactId: lead.contactId as string,
          recipientFingerprint: plan.recipient.recipientFingerprint,
          recipientCiphertext: plan.recipient.recipientCiphertext,
          recipientProtectionState: plan.recipient.recipientProtectionState,
          steps: plan.steps,
        },
        ctx.correlationId,
        'evt-5' as any,
      );
      sequence.submitForApproval(ctx.correlationId, 'evt-seq-pending' as any);
      sequence.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-seq-approved' as any);
      sequence.start(ctx.correlationId, 'evt-seq-start' as any);
      await deps.sequenceRepo.save(ctx, sequence);

      const draftResult = await deps.executionService.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
      expect(draftResult.status).toBe('AWAITING_APPROVAL');
    });

    it('executes an approved send and advances sequence', async () => {
      const deps = buildServices();
      const emailProvider = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
      deps.registry.register(emailProvider);
      deps.registry.setTenantProvider(tenantA as string, 'email', 'stub-email');

      const lead = makeLead();
      const evidence = [makeEvidence('ev-1')];
      const plan = await deps.planningService.plan(ctx, { campaignId: asCampaignId('camp-1'), lead, evidence });
      const { OutreachCampaign, OutreachSequence } = require('@projectx/domain');

      const campaign = OutreachCampaign.create(
        {
          id: plan.campaignId,
          tenantId: tenantA,
          workspaceId,
          leadId: lead.contactId as string,
          contactId: lead.contactId as string,
          recipientFingerprint: plan.recipient.recipientFingerprint,
          recipientProtectionState: plan.recipient.recipientProtectionState,
          channel: plan.channel,
          steps: plan.steps,
          missionId: 'm-1',
        },
        ctx.correlationId,
        'evt-1' as any,
      );
      campaign.submitForApproval(ctx.correlationId, 'evt-2' as any);
      campaign.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-3' as any);
      campaign.start(ctx.correlationId, 'evt-4' as any);
      await deps.campaignRepo.save(ctx, campaign);

      const sequence = OutreachSequence.create(
        {
          id: plan.sequenceId,
          tenantId: tenantA,
          workspaceId,
          campaignId: campaign.id,
          leadId: lead.contactId as string,
          contactId: lead.contactId as string,
          recipientFingerprint: plan.recipient.recipientFingerprint,
          recipientCiphertext: plan.recipient.recipientCiphertext,
          recipientProtectionState: plan.recipient.recipientProtectionState,
          steps: plan.steps,
        },
        ctx.correlationId,
        'evt-5' as any,
      );
      sequence.submitForApproval(ctx.correlationId, 'evt-seq-pending' as any);
      sequence.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-seq-approved' as any);
      sequence.start(ctx.correlationId, 'evt-seq-start' as any);
      await deps.sequenceRepo.save(ctx, sequence);

      const draft = await deps.executionService.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
      expect(draft.status).toBe('AWAITING_APPROVAL');
      if (draft.status !== 'AWAITING_APPROVAL') return;

      await authorizeSend(deps, {
        tenantId: tenantA,
          workspaceId,
        campaignId: campaign.id as string,
        sequenceId: sequence.id as string,
        executionId: draft.executionId as string,
        recipientFingerprint: plan.recipient.recipientFingerprint,
      });
      const send = await deps.executionService.executeApprovedSend(ctx, draft.executionId, 'approval-1' as any);
      expect(send.status).toBe('COMPLETED');

      const reloaded = await deps.executionRepo.load(ctx, draft.executionId);
      expect(reloaded?.status).toBe('DELIVERY_PENDING');
    });

    it('enforces budget limits before provider send', async () => {
      const deps = buildServices();
      const emailProvider = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
      deps.registry.register(emailProvider);
      deps.registry.setTenantProvider(tenantA as string, 'email', 'stub-email');

      const lead = makeLead();
      const evidence = [makeEvidence('ev-1')];
      const plan = await deps.planningService.plan(ctx, { campaignId: asCampaignId('camp-1'), lead, evidence });
      const { OutreachCampaign, OutreachSequence } = require('@projectx/domain');

      const campaign = OutreachCampaign.create(
        {
          id: plan.campaignId,
          tenantId: tenantA,
          workspaceId,
          leadId: lead.contactId as string,
          ...plan.recipient,
          channel: plan.channel,
          steps: plan.steps,
          missionId: 'm-1',
          budget: { maxSendCount: 0, maxCostUsd: 0 },
        },
        ctx.correlationId,
        'evt-1' as any,
      );
      campaign.submitForApproval(ctx.correlationId, 'evt-2' as any);
      campaign.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-3' as any);
      campaign.start(ctx.correlationId, 'evt-4' as any);
      await deps.campaignRepo.save(ctx, campaign);

      const sequence = OutreachSequence.create(
        {
          id: plan.sequenceId,
          tenantId: tenantA,
          workspaceId,
          campaignId: campaign.id,
          leadId: lead.contactId as string,
          contactId: lead.contactId as string,
          recipientFingerprint: plan.recipient.recipientFingerprint,
          recipientCiphertext: plan.recipient.recipientCiphertext,
          recipientProtectionState: plan.recipient.recipientProtectionState,
          steps: plan.steps,
        },
        ctx.correlationId,
        'evt-5' as any,
      );
      sequence.submitForApproval(ctx.correlationId, 'evt-seq-pending' as any);
      sequence.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-seq-approved' as any);
      sequence.start(ctx.correlationId, 'evt-seq-start' as any);
      await deps.sequenceRepo.save(ctx, sequence);

      const draft = await deps.executionService.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
      expect(draft.status).toBe('AWAITING_APPROVAL');
      if (draft.status !== 'AWAITING_APPROVAL') return;

      await authorizeSend(deps, {
        tenantId: tenantA,
          workspaceId,
        campaignId: campaign.id as string,
        sequenceId: sequence.id as string,
        executionId: draft.executionId as string,
        recipientFingerprint: plan.recipient.recipientFingerprint,
      });
      const send = await deps.executionService.executeApprovedSend(ctx, draft.executionId, 'approval-1' as any);
      expect(send.status).toBe('FAILED');
      expect(send.reason).toContain('Budget');
    });

    it('returns RETRYABLE when the provider reports a retryable failure', async () => {
      const deps = buildServices();
      const emailProvider = new StubEmailProvider({
        type: 'failure',
        classification: 'RETRYABLE',
        errorMessage: 'provider rate limited',
        retryAfterMs: 30_000,
      });
      deps.registry.register(emailProvider);
      deps.registry.setTenantProvider(tenantA as string, 'email', 'stub-email');

      const lead = makeLead();
      const evidence = [makeEvidence('ev-1')];
      const plan = await deps.planningService.plan(ctx, { campaignId: asCampaignId('camp-1'), lead, evidence });
      const { OutreachCampaign, OutreachSequence } = require('@projectx/domain');

      const campaign = OutreachCampaign.create(
        {
          id: plan.campaignId,
          tenantId: tenantA,
          workspaceId,
          leadId: lead.contactId as string,
          contactId: lead.contactId as string,
          recipientFingerprint: plan.recipient.recipientFingerprint,
          recipientProtectionState: plan.recipient.recipientProtectionState,
          channel: plan.channel,
          steps: plan.steps,
          missionId: 'm-1',
        },
        ctx.correlationId,
        'evt-1' as any,
      );
      campaign.submitForApproval(ctx.correlationId, 'evt-2' as any);
      campaign.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-3' as any);
      campaign.start(ctx.correlationId, 'evt-4' as any);
      await deps.campaignRepo.save(ctx, campaign);

      const sequence = OutreachSequence.create(
        {
          id: plan.sequenceId,
          tenantId: tenantA,
          workspaceId,
          campaignId: campaign.id,
          leadId: lead.contactId as string,
          contactId: lead.contactId as string,
          recipientFingerprint: plan.recipient.recipientFingerprint,
          recipientCiphertext: plan.recipient.recipientCiphertext,
          recipientProtectionState: plan.recipient.recipientProtectionState,
          steps: plan.steps,
        },
        ctx.correlationId,
        'evt-5' as any,
      );
      sequence.submitForApproval(ctx.correlationId, 'evt-seq-pending' as any);
      sequence.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-seq-approved' as any);
      sequence.start(ctx.correlationId, 'evt-seq-start' as any);
      await deps.sequenceRepo.save(ctx, sequence);

      const draft = await deps.executionService.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
      expect(draft.status).toBe('AWAITING_APPROVAL');
      if (draft.status !== 'AWAITING_APPROVAL') return;

      await authorizeSend(deps, {
        tenantId: tenantA,
          workspaceId,
        campaignId: campaign.id as string,
        sequenceId: sequence.id as string,
        executionId: draft.executionId as string,
        recipientFingerprint: plan.recipient.recipientFingerprint,
      });
      const send = await deps.executionService.executeApprovedSend(ctx, draft.executionId, 'approval-1' as any);
      expect(send.status).toBe('RETRYABLE');
      if (send.status !== 'RETRYABLE') return;
      expect(send.retryAfterMs).toBeGreaterThan(0);

      const reloaded = await deps.executionRepo.load(ctx, draft.executionId);
      expect(reloaded?.status).toBe('SENDING');
    });

    it('records simulated OPENED and REPLIED responses', async () => {
      const deps = buildServices();
      const emailProvider = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
      deps.registry.register(emailProvider);
      deps.registry.setTenantProvider(tenantA as string, 'email', 'stub-email');

      const lead = makeLead();
      const evidence = [makeEvidence('ev-1')];
      const plan = await deps.planningService.plan(ctx, { campaignId: asCampaignId('camp-1'), lead, evidence });
      const { OutreachCampaign, OutreachSequence } = require('@projectx/domain');

      const campaign = OutreachCampaign.create(
        {
          id: plan.campaignId,
          tenantId: tenantA,
          workspaceId,
          leadId: lead.contactId as string,
          contactId: lead.contactId as string,
          recipientFingerprint: plan.recipient.recipientFingerprint,
          recipientProtectionState: plan.recipient.recipientProtectionState,
          channel: plan.channel,
          steps: plan.steps,
          missionId: 'm-1',
        },
        ctx.correlationId,
        'evt-1' as any,
      );
      campaign.submitForApproval(ctx.correlationId, 'evt-2' as any);
      campaign.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-3' as any);
      campaign.start(ctx.correlationId, 'evt-4' as any);
      await deps.campaignRepo.save(ctx, campaign);

      const sequence = OutreachSequence.create(
        {
          id: plan.sequenceId,
          tenantId: tenantA,
          workspaceId,
          campaignId: campaign.id,
          leadId: lead.contactId as string,
          contactId: lead.contactId as string,
          recipientFingerprint: plan.recipient.recipientFingerprint,
          recipientCiphertext: plan.recipient.recipientCiphertext,
          recipientProtectionState: plan.recipient.recipientProtectionState,
          steps: plan.steps,
        },
        ctx.correlationId,
        'evt-5' as any,
      );
      sequence.submitForApproval(ctx.correlationId, 'evt-seq-pending' as any);
      sequence.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-seq-approved' as any);
      sequence.start(ctx.correlationId, 'evt-seq-start' as any);
      await deps.sequenceRepo.save(ctx, sequence);

      const draft = await deps.executionService.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
      if (draft.status !== 'AWAITING_APPROVAL') return;
      await authorizeSend(deps, {
        tenantId: tenantA,
          workspaceId,
        campaignId: campaign.id as string,
        sequenceId: sequence.id as string,
        executionId: draft.executionId as string,
        recipientFingerprint: plan.recipient.recipientFingerprint,
      });
      await deps.executionService.executeApprovedSend(ctx, draft.executionId, 'approval-1' as any);

      await deps.executionService.recordResponse(ctx, draft.executionId, 'OPENED');
      const opened = await deps.executionRepo.load(ctx, draft.executionId);
      expect(opened?.status).toBe('OPENED');

      await deps.executionService.recordResponse(ctx, draft.executionId, 'REPLIED');
      const replied = await deps.executionRepo.load(ctx, draft.executionId);
      expect(replied?.status).toBe('REPLIED');
    });
  });

  describe('agent executor integration', () => {
    it('plans, drafts, sends and records a response end-to-end', async () => {
      const deps = buildServices();
      deps.registry.register(new StubEmailProvider({ type: 'success', costUsd: 0.05 }));
      deps.registry.setTenantProvider(tenantA as string, 'email', 'stub-email');

      const lead = makeLead();
      const evidence = [makeEvidence('ev-1')];
      const planResult = await deps.agentExecutor.execute({
        executionId: 'agent-exec-1',
        tenantId: tenantA,
          workspaceId,
        missionId: 'm-1',
        taskType: 'plan-outreach',
        context: { authorization: { workspaceId }, plan: { lead, evidence, mission: { channels: ['email'] } } },
        policy: {},
      } as any);
      expect(planResult.status).toBe('COMPLETED');
      const { sequenceId, plan } = planResult.outcome as Record<string, any>;

      const sequence = await deps.sequenceRepo.load(ctx, sequenceId);
      expect(sequence).not.toBeNull();
      sequence!.submitForApproval(ctx.correlationId, 'evt-seq-pending' as any);
      sequence!.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-seq-approved' as any);
      sequence!.start(ctx.correlationId, 'evt-seq-start' as any);
      await deps.sequenceRepo.save(ctx, sequence!);

      const draftResult = await deps.agentExecutor.execute({
        executionId: 'agent-exec-2',
        tenantId: tenantA,
          workspaceId,
        missionId: 'm-1',
        taskType: 'draft-message',
        context: { authorization: { workspaceId }, plan: { sequenceId, plan, lead, evidence } },
        policy: {},
      } as any);
      expect(draftResult.status).toBe('AWAITING_APPROVAL');
      const executionId = (draftResult.outcome as Record<string, any>).executionId;

      await authorizeSend(deps, {
        tenantId: tenantA,
          workspaceId,
        campaignId: sequence!.campaignId as string,
        sequenceId: sequenceId as string,
        executionId: executionId as string,
        recipientFingerprint: plan.recipient.recipientFingerprint,
      });
      const sendResult = await deps.agentExecutor.execute({
        executionId: 'agent-exec-3',
        tenantId: tenantA,
          workspaceId,
        missionId: 'm-1',
        taskType: 'execute-send',
        context: { authorization: { workspaceId }, target: { executionId, approvalId: 'approval-1' } },
        policy: {},
      } as any);
      expect(sendResult.status).toBe('COMPLETED');

      const responseResult = await deps.agentExecutor.execute({
        executionId: 'agent-exec-4',
        tenantId: tenantA,
          workspaceId,
        missionId: 'm-1',
        taskType: 'record-response',
        context: { authorization: { workspaceId }, target: { executionId, responseType: 'REPLIED' } },
        policy: {},
      } as any);
      expect(responseResult.status).toBe('COMPLETED');

      const execution = await deps.executionRepo.load(ctx, executionId);
      expect(execution?.status).toBe('REPLIED');
    });
  });

  describe('agent registry', () => {
    it('exposes the outreach orchestrator agent', async () => {
      const { OutreachAgentRegistry } = require('../index');
      const registry = new OutreachAgentRegistry();
      const agent = await registry.getAgent(ctx, 'outreach-orchestrator');
      expect(agent).not.toBeNull();
      expect(agent?.capabilities).toContain('plan-outreach');
      expect(agent?.capabilities).toContain('execute-send');
    });

    it('returns null for unknown agents', async () => {
      const { OutreachAgentRegistry } = require('../index');
      const registry = new OutreachAgentRegistry();
      const agent = await registry.getAgent(ctx, 'unknown-agent');
      expect(agent).toBeNull();
    });
  });
});
