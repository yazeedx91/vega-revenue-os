import type { IOutputValidator, IReasoningEngine, OutputValidationResult, ReasoningOutput } from '@projectx/ai-runtime';
import { ResearchEvidence, type Lead, type OutreachChannel, type OutreachPlan, type ProviderHealth, type ProviderSendRequest, type ProviderSendResult, type TenantContext } from '@projectx/domain';
import { InMemoryAuditLog, InMemoryIdempotencyStore, InMemoryRateLimiter } from '@projectx/infrastructure';
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
  asTenantId,
} from '@projectx/shared';
import { OutreachExecutionService } from '../application/outreach-execution.service';
import { OutreachPersonalizationService } from '../application/outreach-personalization.service';
import { OutreachPlanningService } from '../application/outreach-planning.service';
import { InMemoryApprovalVerificationPort } from '../infrastructure/in-memory-approval-verification-port';
import { InMemoryCampaignRepository } from '../infrastructure/in-memory-campaign-repository';
import { InMemoryMessageExecutionRepository } from '../infrastructure/in-memory-message-execution-repository';
import { InMemoryOutreachProviderRegistry } from '../infrastructure/in-memory-provider-registry';
import { InMemoryRecipientAllowlistRepository } from '../infrastructure/in-memory-recipient-allowlist-repository';
import { InMemorySequenceRepository } from '../infrastructure/in-memory-sequence-repository';
import { InMemorySequenceSchedulePolicy } from '../infrastructure/in-memory-schedule-policy';
import { InMemorySuppressionRepository } from '../infrastructure/in-memory-suppression-repository';
import { SendSafetyGate } from '../safety/send-safety-gate';

describe('OutreachExecutionService production idempotency hardening', () => {
  const tenantA = asTenantId('tenant-a');
  const ctx: TenantContext = { tenantId: tenantA, correlationId: asCorrelationId('corr-1') };

  const fakeReasoningEngine: IReasoningEngine = {
    async reason(): Promise<ReasoningOutput> {
      return {
        rationale: 'stub',
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
    async validate(): Promise<OutputValidationResult> {
      return { valid: true, safeOutput: 'A validated, non-empty message body.', piiCheck: 'PASSED' };
    },
  };

  class SpyEmailProvider {
    readonly providerId = 'spy-email';
    readonly channel: OutreachChannel = 'email';
    readonly sendCalls: ProviderSendRequest[] = [];

    constructor(private readonly result: ProviderSendResult = { status: 'PROVIDER_ACCEPTED', providerMessageId: 'provider-msg-1', costUsd: 0.05 }) {}

    async send(_ctx: TenantContext, request: ProviderSendRequest): Promise<ProviderSendResult> {
      this.sendCalls.push(request);
      return { ...this.result };
    }

    async checkHealth(): Promise<ProviderHealth> {
      return { healthy: true };
    }
  }

  async function buildHarness(providerResult?: ProviderSendResult) {
    const campaignRepo = new InMemoryCampaignRepository();
    const sequenceRepo = new InMemorySequenceRepository();
    const executionRepo = new InMemoryMessageExecutionRepository();
    const registry = new InMemoryOutreachProviderRegistry();
    const provider = new SpyEmailProvider(providerResult);
    registry.register(provider as any);
    registry.setTenantProvider(tenantA as string, 'email', 'spy-email');

    const schedulePolicy = new InMemorySequenceSchedulePolicy();
    let seed = 0;
    const planningService = new OutreachPlanningService({ generateSequenceId: () => asSequenceId(`seq-${++seed}`) });
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
    });

    const executionService = new OutreachExecutionService({
      campaignRepository: campaignRepo,
      sequenceRepository: sequenceRepo,
      executionRepository: executionRepo,
      providerRegistry: registry,
      schedulePolicy,
      personalizationService,
      safetyGate,
      idempotencyStore,
      generateExecutionId: () => `exec-${++seed}`,
      generateEventId: () => `evt-${++seed}` as any,
      channelCostEstimate: () => 0.1,
    });

    return { campaignRepo, sequenceRepo, executionRepo, executionService, allowlistRepo, approvalPort, idempotencyStore, provider };
  }

  async function createApprovedExecution(
    deps: Awaited<ReturnType<typeof buildHarness>>,
    options: { approve?: boolean } = { approve: true },
  ) {
    const { OutreachCampaign, OutreachSequence } = require('@projectx/domain');
    const lead: Lead = {
      id: asLeadId('lead-1'),
      tenantId: tenantA,
      accountId: asAccountId('acc-1'),
      contactId: asContactId('contact-1'),
      icpProfileId: asICPProfileId('icp-1'),
      scores: { icpMatch: 0.9, signalScore: 0.8, intentScore: 0.7, evidenceConfidence: 0.9, overall: 0.85 },
      status: 'QUALIFIED',
      evidenceReferences: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Lead;

    const planningService = new OutreachPlanningService({ generateSequenceId: () => asSequenceId(`seq-${Date.now()}`) });
    const plan: OutreachPlan = planningService.plan(ctx, { campaignId: asCampaignId(`camp-${Date.now()}`), lead, evidence: [] });

    const campaign = OutreachCampaign.create(
      {
        id: plan.campaignId,
        tenantId: tenantA,
        leadId: lead.contactId as string,
        recipient: plan.recipient,
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
        campaignId: campaign.id,
        leadId: lead.contactId as string,
        recipient: plan.recipient,
        steps: plan.steps,
      },
      ctx.correlationId,
      'evt-5' as any,
    );
    sequence.submitForApproval(ctx.correlationId, 'evt-6' as any);
    sequence.approve('approver-1' as any, 'approved', ctx.correlationId, 'evt-7' as any);
    sequence.start(ctx.correlationId, 'evt-8' as any);
    await deps.sequenceRepo.save(ctx, sequence);

    const evidence = [
      new ResearchEvidence({
        evidenceId: asEvidenceId('ev-1'),
        tenantId: tenantA,
        claimType: 'funding-round',
        normalizedValue: 'raised Series B',
        source: 'test',
        reliabilityTier: 'PUBLIC_RECORD',
        observedAt: new Date(),
        freshnessExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
        confidence: 0.9,
        confidenceBreakdown: { sourceReliability: 0.9, extractionConfidence: 0.9, corroboration: 0.9 },
        provenance: [],
      }),
    ];

    const draft = await deps.executionService.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
    if (draft.status !== 'AWAITING_APPROVAL') throw new Error(`Expected AWAITING_APPROVAL, got ${draft.status}`);

    await deps.allowlistRepo.add(ctx, { channel: 'email', address: plan.recipient.address, approvedBy: 'test-harness' });
    if (options.approve) {
      deps.approvalPort.seed({
        approvalId: 'approval-1',
        tenantId: tenantA as string,
        campaignId: campaign.id as string,
        sequenceId: sequence.id as string,
        executionId: draft.executionId as string,
        recipientAddress: plan.recipient.address,
        actionType: 'OUTREACH_EMAIL_SEND',
        outcome: 'APPROVED',
      });
    }

    const execution = await deps.executionRepo.load(ctx, draft.executionId as any);
    return { campaign, sequence, plan, lead, executionId: draft.executionId as string, idempotencyKey: execution!.idempotencyKey };
  }

  it('prepareDraft returns AWAITING_APPROVAL while the aggregate is PENDING_APPROVAL', async () => {
    const deps = await buildHarness();
    const { sequence, plan, lead, executionId } = await createApprovedExecution(deps, { approve: false });

    const draft = await deps.executionService.prepareDraft(ctx, sequence.id as string, plan, lead, []);

    expect(draft.status).toBe('AWAITING_APPROVAL');
    const execution = await deps.executionRepo.load(ctx, executionId as any);
    expect(execution?.status).toBe('PENDING_APPROVAL');
  });

  it('stale PENDING idempotency record prevents duplicate provider submission and moves to DELIVERY_UNKNOWN', async () => {
    const deps = await buildHarness();
    const { executionId, idempotencyKey } = await createApprovedExecution(deps);

    // Simulate a prior crash that reserved the idempotency key but never resolved
    // the provider outcome.
    await deps.idempotencyStore.set(
      ctx,
      'outreach:send',
      idempotencyKey,
      {},
      { status: 'PENDING' },
    );

    const result = await deps.executionService.executeApprovedSend(ctx, executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect((result as any).reason).toContain('reconciliation required');
    expect(deps.provider.sendCalls).toHaveLength(0);

    const reloaded = await deps.executionRepo.load(ctx, executionId as any);
    expect(reloaded?.status).toBe('DELIVERY_UNKNOWN');

    // The idempotency record remains PENDING so no future process can reclaim it.
    const record = await deps.idempotencyStore.get(ctx, 'outreach:send', idempotencyKey);
    expect(record?.status).toBe('PENDING');
  });

  it('COMPLETED idempotency record recovers the execution without contacting the provider', async () => {
    const deps = await buildHarness();
    const { executionId, idempotencyKey } = await createApprovedExecution(deps);

    await deps.idempotencyStore.set(
      ctx,
      'outreach:send',
      idempotencyKey,
      { submitted: true, providerMessageId: 'recovered-msg-1', internetMessageId: '<recovered@example.com>' },
      { status: 'COMPLETED' },
    );

    const result = await deps.executionService.executeApprovedSend(ctx, executionId as any, 'approval-1' as any);

    expect(result.status).toBe('COMPLETED');
    expect(deps.provider.sendCalls).toHaveLength(0);

    const reloaded = await deps.executionRepo.load(ctx, executionId as any);
    expect(reloaded?.status).toBe('DELIVERY_PENDING');
    expect(reloaded?.providerMessageId).toBe('recovered-msg-1');
    expect(reloaded?.internetMessageId).toBe('<recovered@example.com>');
  });

  it('FAILED idempotency record with submitted=false is safely re-claimed and retried', async () => {
    const deps = await buildHarness();
    const { executionId, idempotencyKey } = await createApprovedExecution(deps);

    await deps.idempotencyStore.set(
      ctx,
      'outreach:send',
      idempotencyKey,
      { submitted: false, reason: 'prior safety gate denial' },
      { status: 'FAILED' },
    );

    const result = await deps.executionService.executeApprovedSend(ctx, executionId as any, 'approval-1' as any);

    expect(result.status).toBe('COMPLETED');
    expect(deps.provider.sendCalls).toHaveLength(1);

    const record = await deps.idempotencyStore.get(ctx, 'outreach:send', idempotencyKey);
    expect(record?.status).toBe('COMPLETED');
  });

  it('FAILED idempotency record without submitted=false requires reconciliation', async () => {
    const deps = await buildHarness();
    const { executionId, idempotencyKey } = await createApprovedExecution(deps);

    await deps.idempotencyStore.set(
      ctx,
      'outreach:send',
      idempotencyKey,
      { reason: 'unknown prior outcome' },
      { status: 'FAILED' },
    );

    const result = await deps.executionService.executeApprovedSend(ctx, executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect((result as any).reason).toContain('Reconciliation required');
    expect(deps.provider.sendCalls).toHaveLength(0);
  });

  it('provider AMBIGUOUS result leaves idempotency PENDING and does not auto-retry', async () => {
    const deps = await buildHarness({ status: 'AMBIGUOUS', providerErrorCode: 'GRAPH_TIMEOUT_AMBIGUOUS', providerErrorMessage: 'timeout after possible submission', costUsd: 0 });
    const { executionId, idempotencyKey } = await createApprovedExecution(deps);

    const first = await deps.executionService.executeApprovedSend(ctx, executionId as any, 'approval-1' as any);
    expect(first.status).toBe('FAILED');
    expect((first as any).reason).toContain('timeout after possible submission');
    expect(deps.provider.sendCalls).toHaveLength(1);

    const afterFirst = await deps.executionRepo.load(ctx, executionId as any);
    expect(afterFirst?.status).toBe('DELIVERY_UNKNOWN');

    const record = await deps.idempotencyStore.get(ctx, 'outreach:send', idempotencyKey);
    expect(record?.status).toBe('PENDING');

    // A subsequent retry must not resend because the PENDING record blocks it.
    const second = await deps.executionService.executeApprovedSend(ctx, executionId as any, 'approval-1' as any);
    expect(second.status).toBe('FAILED');
    expect(deps.provider.sendCalls).toHaveLength(1);
  });

  it('two parallel executeApprovedSend calls race the same execution -> exactly one provider invocation', async () => {
    const deps = await buildHarness();
    const { executionId } = await createApprovedExecution(deps);

    const [first, second] = await Promise.all([
      deps.executionService.executeApprovedSend(ctx, executionId as any, 'approval-1' as any),
      deps.executionService.executeApprovedSend(ctx, executionId as any, 'approval-1' as any),
    ]);

    // The atomic safety-gate claim guarantees only one caller reaches the
    // provider, even when two workers start simultaneously.
    expect(deps.provider.sendCalls).toHaveLength(1);

    const terminalStatuses = ['COMPLETED', 'FAILED', 'RETRYABLE'];
    expect(terminalStatuses).toContain(first.status);
    expect(terminalStatuses).toContain(second.status);

    const reloaded = await deps.executionRepo.load(ctx, executionId as any);
    expect(['DELIVERY_PENDING', 'DELIVERY_UNKNOWN', 'FAILED_PRE_SUBMISSION', 'FAILED']).toContain(reloaded?.status);
  });

  it('calling executeApprovedSend again after a successful prior completion is a no-op (Temporal retry safety)', async () => {
    const deps = await buildHarness();
    const { executionId } = await createApprovedExecution(deps);

    const first = await deps.executionService.executeApprovedSend(ctx, executionId as any, 'approval-1' as any);
    expect(first.status).toBe('COMPLETED');
    expect(deps.provider.sendCalls).toHaveLength(1);

    const second = await deps.executionService.executeApprovedSend(ctx, executionId as any, 'approval-1' as any);
    expect(second.status).toBe('COMPLETED');
    expect(deps.provider.sendCalls).toHaveLength(1);

    const record = await deps.idempotencyStore.get(ctx, 'outreach:send', (await deps.executionRepo.load(ctx, executionId as any))!.idempotencyKey);
    expect(record?.status).toBe('COMPLETED');
  });

  it('a stale PENDING idempotency record from a prior crash before provider invocation prevents duplicate submission', async () => {
    const deps = await buildHarness();
    const { executionId, idempotencyKey } = await createApprovedExecution(deps);

    await deps.idempotencyStore.set(
      ctx,
      'outreach:send',
      idempotencyKey,
      {},
      { status: 'PENDING' },
    );

    const result = await deps.executionService.executeApprovedSend(ctx, executionId as any, 'approval-1' as any);

    expect(result.status).toBe('FAILED');
    expect((result as any).reason).toContain('reconciliation required');
    expect(deps.provider.sendCalls).toHaveLength(0);

    const reloaded = await deps.executionRepo.load(ctx, executionId as any);
    expect(reloaded?.status).toBe('DELIVERY_UNKNOWN');

    const record = await deps.idempotencyStore.get(ctx, 'outreach:send', idempotencyKey);
    expect(record?.status).toBe('PENDING');
  });
});
