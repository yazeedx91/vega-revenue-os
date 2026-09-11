import type { IReasoningEngine, IOutputValidator, ReasoningOutput, ValidationResult } from '@projectx/ai-runtime';
import type { Lead, OutreachChannel, OutreachPlan, ProviderHealth, ProviderSendRequest, ProviderSendResult, TenantContext } from '@projectx/domain';
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
  asOutreachMessageId,
  asSequenceId,
  asTenantId,
} from '@projectx/shared';
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

describe('SendSafetyGate — Phase 14 Milestone 5 safety boundary', () => {
  const tenantA = asTenantId('tenant-a');
  const ctx: TenantContext = { tenantId: tenantA, workspaceId: 'workspace-1', correlationId: asCorrelationId('corr-1') };

  const fakeReasoningEngine: IReasoningEngine = {
    async reason(): Promise<ReasoningOutput> {
      return {
        rationale: 'Evidence-backed draft',
        conclusion: JSON.stringify({
          subject: 'Hello',
          body: 'A validated, non-empty message body.',
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
      return { valid: true, safeOutput: 'A validated, non-empty message body.', piiCheck: 'PASSED' };
    },
  };

  const makeLead = (): Lead =>
    ({
      id: asLeadId('lead-1'),
      tenantId: tenantA,
      workspaceId: 'workspace-1',
      accountId: asAccountId('acc-1'),
      contactId: asContactId('contact-1'),
      icpProfileId: asICPProfileId('icp-1'),
      icpProfileVersionId: asICPProfileId('icp-version-1'),
      scores: { icpMatch: 0.9, signalScore: 0.8, intentScore: 0.7, evidenceConfidence: 0.9, overall: 0.85 },
      status: 'QUALIFIED',
      evidenceReferences: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Lead);

  /** A provider whose send() is spied so tests can assert it was (or was not) reached. */
  class SpyEmailProvider {
    readonly providerId = 'spy-email';
    readonly channel: OutreachChannel = 'email';
    readonly sendCalls: ProviderSendRequest[] = [];

    async send(_ctx: TenantContext, request: ProviderSendRequest): Promise<ProviderSendResult> {
      this.sendCalls.push(request);
      return { status: 'PROVIDER_ACCEPTED', providerMessageId: 'provider-msg-1', costUsd: 0.05 };
    }

    async checkHealth(): Promise<ProviderHealth> {
      return { healthy: true };
    }
  }

  interface Harness {
    campaignRepo: InMemoryCampaignRepository;
    sequenceRepo: InMemorySequenceRepository;
    executionRepo: InMemoryMessageExecutionRepository;
    registry: InMemoryOutreachProviderRegistry;
    executionService: OutreachExecutionService;
    allowlistRepo: InMemoryRecipientAllowlistRepository;
    suppressionRepo: InMemorySuppressionRepository;
    approvalPort: InMemoryApprovalVerificationPort;
    auditLog: InMemoryAuditLog;
    idempotencyStore: InMemoryIdempotencyStore;
    rateLimiter: InMemoryRateLimiter;
    provider: SpyEmailProvider;
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

  function buildHarness(options?: {
    budget?: { maxSendCount?: number; maxCostUsd?: number };
    rateLimitConfig?: { perSecond?: number; perMinute?: number; perHour?: number; perDay?: number };
  }): Harness {
    const campaignRepo = new InMemoryCampaignRepository();
    const sequenceRepo = new InMemorySequenceRepository();
    const executionRepo = new InMemoryMessageExecutionRepository();
    const registry = new InMemoryOutreachProviderRegistry();
    const provider = new SpyEmailProvider();
    registry.register(provider as any);
    registry.setTenantProvider(tenantA as string, 'email', 'spy-email');

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
      rateLimitConfig: options?.rateLimitConfig,
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

    return { campaignRepo, sequenceRepo, executionRepo, registry, executionService, allowlistRepo, suppressionRepo, approvalPort, auditLog, idempotencyStore, rateLimiter, provider };
  }

  /** Creates a campaign+sequence+drafted, awaiting-approval execution ready to pass into executeApprovedSend. */
  async function setupDraftedExecution(
    harness: Harness,
    options?: { budget?: { maxSendCount?: number; maxCostUsd?: number } },
  ): Promise<{ campaign: any; sequence: any; executionId: string; plan: OutreachPlan }> {
    const { OutreachCampaign, OutreachSequence } = require('@projectx/domain');
    const lead = makeLead();
    const planningService = new OutreachPlanningService({
      generateSequenceId: () => asSequenceId(`seq-${Math.random()}`),
      recipientSource: new TestRecipientSource(),
    });
    const plan = await planningService.plan(ctx, { campaignId: asCampaignId(`camp-${Math.random()}`), lead, evidence: [] });

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
        missionId: 'm-1',
        budget: options?.budget,
      },
      ctx.correlationId,
      'evt-1' as any,
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
      'evt-2' as any,
    );
    sequence.submitForApproval(ctx.correlationId, 'evt-3' as any);
    sequence.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-4' as any);
    sequence.start(ctx.correlationId, 'evt-5' as any);
    await harness.sequenceRepo.save(ctx, sequence);

    const draft = await harness.executionService.prepareDraft(ctx, sequence.id as string, plan, lead, []);
    if (draft.status !== 'AWAITING_APPROVAL') {
      throw new Error(`Expected AWAITING_APPROVAL, got ${draft.status}`);
    }

    return { campaign, sequence, executionId: draft.executionId as string, plan };
  }

  async function authorize(
    harness: Harness,
    target: { campaign: any; sequence: any; executionId: string; plan: OutreachPlan },
    overrides?: { approvalId?: string; outcome?: any; approvalTenantId?: string; approvalCampaignId?: string; approvalSequenceId?: string; approvalExecutionId?: string; actionType?: string; skipAllowlist?: boolean },
  ): Promise<string> {
    const approvalId = overrides?.approvalId ?? 'approval-1';
    if (!overrides?.skipAllowlist) {
      await harness.allowlistRepo.add(ctx, { channel: 'email', address: 'test@example.com', approvedBy: 'test-harness' });
    }
    harness.approvalPort.seed({
      approvalId,
      tenantId: overrides?.approvalTenantId ?? (tenantA as string),
      campaignId: overrides?.approvalCampaignId ?? (target.campaign.id as string),
      sequenceId: overrides?.approvalSequenceId ?? (target.sequence.id as string),
      executionId: overrides?.approvalExecutionId ?? target.executionId,
      recipientFingerprint: target.plan.recipient.recipientFingerprint,
      actionType: overrides?.actionType ?? 'OUTREACH_EMAIL_SEND',
      outcome: overrides?.outcome ?? 'APPROVED',
    });
    return approvalId;
  }

  it('fully authorized send → ALLOW, provider.send() is called, execution COMPLETED', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target);

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('COMPLETED');
    expect(harness.provider.sendCalls).toHaveLength(1);
    const allowEntry = harness.auditLog.entries.find((e) => e.result === 'success');
    expect(allowEntry).toBeDefined();
  });

  it('non-allowlisted recipient → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target, { skipAllowlist: true });

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect((result as any).reason).toContain('not on the tenant allowlist');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('suppressed recipient (manual) → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target);
    await harness.suppressionRepo.suppress(ctx, 'test@example.com', 'MANUAL', 'compliance-team', 'Do not contact');

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect((result as any).reason).toContain('suppressed');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('opted-out recipient (reply-based opt-out suppression) → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target);
    await harness.suppressionRepo.suppress(ctx, 'test@example.com', 'OPT_OUT', 'conversation-reply-handler', 'Prospect asked to stop');

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect((result as any).reason).toContain('OPT_OUT');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('missing approval → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await harness.allowlistRepo.add(ctx, { channel: 'email', address: 'test@example.com', approvedBy: 'test-harness' });
    // Note: approval is intentionally never seeded.

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect((result as any).reason).toContain('not found');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('pending approval → DENY/AWAITING_APPROVAL semantics, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target, { outcome: 'PENDING' });

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('rejected approval → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target, { outcome: 'REJECTED' });

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('cancelled approval → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target, { outcome: 'CANCELLED' });

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('expired approval → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target, { outcome: 'EXPIRED' });

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('wrong-tenant approval → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target, { approvalTenantId: 'tenant-other' });

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('wrong-target approval (different sequence) → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target, { approvalSequenceId: 'some-other-sequence' });

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('wrong actionType approval → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target, { actionType: 'OUTREACH_LINKEDIN_SEND' });

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('execution domain state says APPROVED, but the authoritative approval repository disagrees → DENY, provider.send() is never called', async () => {
    // This proves the gate never trusts a workflow-level "approved" flag: by
    // the time executeApprovedSend reaches the safety gate, execution.status
    // has already transitioned to 'APPROVED' via execution.approve(approvalId),
    // yet the independently re-verified approval is REJECTED.
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target, { outcome: 'REJECTED' });

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect(harness.provider.sendCalls).toHaveLength(0);
    const reloaded = await harness.executionRepo.load(ctx, target.executionId as any);
    expect(reloaded?.status).not.toBe('SENDING');
    expect(reloaded?.status).not.toBe('PROVIDER_ACCEPTED');
    expect(reloaded?.status).not.toBe('DELIVERY_PENDING');
  });

  it('rate limit exceeded → RETRYABLE, provider.send() is never called', async () => {
    const harness = buildHarness({ rateLimitConfig: { perMinute: 1 } });
    const first = await setupDraftedExecution(harness);
    await authorize(harness, first);
    const firstResult = await harness.executionService.executeApprovedSend(ctx, first.executionId as any, 'approval-1' as any);
    expect(firstResult.status).toBe('COMPLETED');
    expect(harness.provider.sendCalls).toHaveLength(1);

    const second = await setupDraftedExecution(harness);
    await authorize(harness, second, { approvalId: 'approval-2' });
    const secondResult = await harness.executionService.executeApprovedSend(ctx, second.executionId as any, 'approval-2' as any);

    expect(secondResult.status).toBe('RETRYABLE');
    expect(harness.provider.sendCalls).toHaveLength(1);
  });

  it('send-count budget exceeded → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness, { budget: { maxSendCount: 0 } });
    await authorize(harness, target);

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect((result as any).reason).toContain('Budget exceeded');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('cost budget exceeded → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness, { budget: { maxCostUsd: 0 } });
    await authorize(harness, target);

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect((result as any).reason).toContain('Budget exceeded');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('duplicate logical send (application-command idempotency) → COMPLETED recovery, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target);
    const execution = await harness.executionRepo.load(ctx, target.executionId as any);
    await harness.idempotencyStore.set(ctx, 'outreach:send', execution!.idempotencyKey, { submitted: true, providerMessageId: 'prior-msg-1' }, { status: 'COMPLETED' });

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('COMPLETED');
    expect(harness.provider.sendCalls).toHaveLength(0);

    const reloaded = await harness.executionRepo.load(ctx, target.executionId as any);
    expect(reloaded?.status).toBe('DELIVERY_PENDING');
    expect(reloaded?.providerMessageId).toBe('prior-msg-1');
  });

  it('concurrent duplicate sends (TOCTOU) → exactly one of two parallel SendSafetyGate.evaluate() calls wins the atomic idempotency claim', async () => {
    // Regression test for the Milestone 5 open risk: separate get()/set()
    // calls left a race window where two concurrent callers could both pass
    // the duplicate check before either wrote a record. The atomic claim()
    // reserves the key in a single operation, so exactly one of two
    // simultaneously-evaluated requests for the same idempotency key can
    // ever receive ALLOW. Evaluated directly against SendSafetyGate (rather
    // than through executeApprovedSend) to isolate the claim mechanism from
    // the OutreachMessageExecution aggregate's own shared-state guards.
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    const approvalId = await authorize(harness, target);
    const execution = await harness.executionRepo.load(ctx, target.executionId as any);

    const safetyGate = new SendSafetyGate({
      allowlistRepository: harness.allowlistRepo,
      suppressionRepository: harness.suppressionRepo,
      approvalVerificationPort: harness.approvalPort,
      rateLimiter: harness.rateLimiter,
      idempotencyStore: harness.idempotencyStore,
      auditLog: harness.auditLog,
    });

    const evaluateInput = {
      ctx,
      campaign: target.campaign,
      execution: execution!,
      recipientAddress: 'test@example.com',
      approvalId,
      actionType: 'OUTREACH_EMAIL_SEND',
      estimatedCostUsd: 0.1,
    };

    const [first, second] = await Promise.all([safetyGate.evaluate(evaluateInput), safetyGate.evaluate(evaluateInput)]);

    const decisions = [first.decision, second.decision].sort();
    expect(decisions).toEqual(['ALLOW', 'DENY']);
    const denied = (first.decision === 'DENY' ? first : second) as { decision: 'DENY'; code: string };
    expect(denied.code).toBe('DUPLICATE_SEND');
  });

  it('invalid/missing content → DENY, provider.send() is never called', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target);
    const execution = await harness.executionRepo.load(ctx, target.executionId as any);
    execution!.draft = { ...(execution!.draft as any), body: '' };
    await harness.executionRepo.save(ctx, execution!);

    const result = await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect((result as any).reason).toContain('no validated draft content');
    expect(harness.provider.sendCalls).toHaveLength(0);
  });

  it('every safety decision is audited with tenant, recipient, campaign, sequence, execution, approval, and correlation id', async () => {
    const harness = buildHarness();
    const target = await setupDraftedExecution(harness);
    await authorize(harness, target, { outcome: 'REJECTED' });

    await harness.executionService.executeApprovedSend(ctx, target.executionId as any, 'approval-1' as any);

    const denialEntry = harness.auditLog.entries.find((e) => e.result === 'denied');
    expect(denialEntry).toBeDefined();
    expect(denialEntry!.tenantId).toBe(tenantA as string);
    expect(denialEntry!.metadata?.recipientFingerprint).toBe(target.plan.recipient.recipientFingerprint);
    expect(denialEntry!.metadata?.campaignId).toBe(target.campaign.id);
    expect(denialEntry!.metadata?.sequenceId).toBe(target.sequence.id);
    expect(denialEntry!.metadata?.executionId).toBe(target.executionId);
    expect(denialEntry!.metadata?.approvalId).toBe('approval-1');
    expect(denialEntry!.correlationId).toBe(ctx.correlationId as string);
  });
});
