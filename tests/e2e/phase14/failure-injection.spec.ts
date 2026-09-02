import { Pool } from 'pg';
import type { RedisClientType } from 'redis';
import { randomUUID } from 'crypto';
import { asEventId, asCorrelationId, asIdempotencyKey } from '@projectx/shared';
import { StubEmailProvider } from '@projectx/outreach';
import {
  buildCampaign,
  buildEvidence,
  buildLead,
  buildPlan,
  buildSequence,
  connectPostgres,
  connectRedis,
  createDurableAdapters,
  createExecutionService,
  createTenantContext,
  requireEnv,
  runMigrations,
  seedTenantAllowlist,
} from './helpers';

describe('Phase 14.7c deterministic failure injection', () => {
  let pool: Pool | undefined;
  let redis: RedisClientType | undefined;
  const tenantId = `tenant-failure-${randomUUID()}`;

  beforeAll(async () => {
    requireEnv();
    try {
      pool = await connectPostgres();
      redis = await connectRedis();
      await runMigrations();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Skipping failure-injection tests because integration services are unreachable:', err);
    }
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await redis?.disconnect();
  });

  async function prepareApprovedSend(adapters: Awaited<ReturnType<typeof createDurableAdapters>>, emailProvider: StubEmailProvider) {
    const ctx = createTenantContext(tenantId, { id: 'e2e-operator', role: 'admin' });
    const { service, approvalRepo } = createExecutionService(adapters, tenantId, emailProvider);

    const campaign = buildCampaign(tenantId, `campaign-fail-${randomUUID()}`);
    const sequence = buildSequence(tenantId, campaign.id as string, `sequence-fail-${randomUUID()}`);
    const recipientAddress = sequence.recipient.address;

    await adapters.campaignRepository.save(ctx, campaign);
    await adapters.sequenceRepository.save(ctx, sequence);
    await seedTenantAllowlist(adapters, ctx, recipientAddress);

    const lead = buildLead(tenantId);
    const evidence = [buildEvidence(tenantId)];
    const plan = buildPlan(campaign.id as string, sequence.id as string, sequence.recipient);

    const draft = await service.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
    expect(draft.status).toBe('AWAITING_APPROVAL');
    if (draft.status !== 'AWAITING_APPROVAL') {
      throw new Error(`Draft preparation failed: ${draft.status}`);
    }
    const executionId = draft.executionId;
    const approvalId = `approval-${executionId as string}`;
    const execution = await adapters.executionRepository.load(ctx, executionId);
    if (!execution) throw new Error('Execution not found after draft');
    const { Approval } = await import('@projectx/mission-orchestrator');
    const approval = Approval.create(
      {
        id: approvalId as any,
        tenantId: ctx.tenantId,
        missionId: 'mission-e2e',
        sequenceId: sequence.id as string,
        executionId: executionId as string,
        actionType: 'OUTREACH_EMAIL_SEND',
        riskCategory: 'HIGH',
        proposedAction: { message: 'Failure injection test' },
        evidence: [],
        reasoning: 'Approved for failure injection',
        confidence: 0.95,
        requestedBy: 'e2e-agent',
        approverRole: 'e2e-operator',
        timeoutSeconds: 3600,
        idempotencyKey: execution.idempotencyKey,
        correlationId: ctx.correlationId as any,
      },
      asEventId(`evt-approval-${executionId as string}`),
    );
    if (!approval.success) throw new Error(approval.error.message);
    approval.value.approve('e2e-operator' as any, 'Approved', asCorrelationId('corr-approve'), asEventId('evt-approve'));
    await approvalRepo.save(approval.value);

    return { ctx, service, campaign, sequence, executionId, approvalId };
  }

  it('returns RETRYABLE and records RATE_LIMITED when provider reports 429', async () => {
    if (!pool) return;
    const adapters = await createDurableAdapters();
    try {
      const provider = new StubEmailProvider();
      provider.configureFailure({
        type: 'failure',
        classification: 'RATE_LIMITED',
        errorCode: '429',
        errorMessage: 'Microsoft Graph throttled',
        retryAfterMs: 5000,
      });
      const { ctx, service, executionId, approvalId } = await prepareApprovedSend(adapters, provider);

      const result = await service.executeApprovedSend(ctx, executionId, approvalId as any);
      expect(result.status).toBe('RETRYABLE');

      const execution = await adapters.executionRepository.load(ctx, executionId);
      expect(execution?.status).toBe('SENDING');
      expect(execution?.retryClassification).toBe('RATE_LIMITED');

      expect(provider.getSentMessages()[0].simulatedStatus).toBe('RATE_LIMITED');
    } finally {
      await adapters.dispose();
    }
  });

  it('returns FAILED for non-retryable 401 and does not advance sequence', async () => {
    if (!pool) return;
    const adapters = await createDurableAdapters();
    try {
      const provider = new StubEmailProvider();
      provider.configureFailure({
        type: 'failure',
        classification: 'NON_RETRYABLE',
        errorCode: '401',
        errorMessage: 'Unauthorized',
      });
      const { ctx, service, executionId, approvalId, sequence } = await prepareApprovedSend(adapters, provider);

      const result = await service.executeApprovedSend(ctx, executionId, approvalId as any);
      expect(result.status).toBe('FAILED');

      const execution = await adapters.executionRepository.load(ctx, executionId);
      expect(execution?.status).toBe('FAILED_PRE_SUBMISSION');

      const reloadedSequence = await adapters.sequenceRepository.load(ctx, sequence.id);
      expect(reloadedSequence?.status).not.toBe('COMPLETED');
    } finally {
      await adapters.dispose();
    }
  });

  it('handles provider accept-then-timeout with stable providerMessageId on retry', async () => {
    if (!pool) return;
    const adapters = await createDurableAdapters();
    try {
      const provider = new StubEmailProvider();
      provider.simulateAcceptedThenTimeout();
      const { ctx, service, executionId, approvalId } = await prepareApprovedSend(adapters, provider);

      const first = await service.executeApprovedSend(ctx, executionId, approvalId as any);
      expect(first.status).toBe('FAILED');

      const executionAfterTimeout = await adapters.executionRepository.load(ctx, executionId);
      expect(executionAfterTimeout?.status).toBe('DELIVERY_UNKNOWN');

      // A PENDING idempotency record prevents a second provider send.
      provider.configureFailure({ type: 'success', costUsd: 0.05 });
      const second = await service.executeApprovedSend(ctx, executionId, approvalId as any);
      expect(second.status).toBe('FAILED');

      expect(provider.getSentMessages()).toHaveLength(1);
      const [sent] = provider.getSentMessages();
      expect(sent.simulatedStatus).toBe('AMBIGUOUS');
      expect(sent.providerMessageId).toBeDefined();

      const execution = await adapters.executionRepository.load(ctx, executionId);
      expect(execution?.status).toBe('DELIVERY_UNKNOWN');
    } finally {
      await adapters.dispose();
    }
  });
});
