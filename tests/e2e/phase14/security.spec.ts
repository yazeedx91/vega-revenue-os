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
  recipientFromSequence,
  runMigrations,
  seedTenantAllowlist,
} from './helpers';

describe('Phase 14.7c security boundaries', () => {
  let pool: Pool | undefined;
  let redis: RedisClientType | undefined;
  const tenantId = `tenant-security-${randomUUID()}`;

  beforeAll(async () => {
    requireEnv();
    try {
      pool = await connectPostgres();
      redis = await connectRedis();
      await runMigrations();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Skipping security E2E tests because integration services are unreachable:', err);
    }
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await redis?.disconnect();
  });

  it('blocks send when approval is missing', async () => {
    if (!pool) return;
    const adapters = await createDurableAdapters();
    try {
      const ctx = createTenantContext(tenantId, { id: 'e2e-operator', role: 'admin' });
      const provider = new StubEmailProvider();
      const { service } = createExecutionService(adapters, tenantId, provider);

      const campaign = buildCampaign(tenantId, `campaign-sec-${randomUUID()}`);
      const sequence = buildSequence(tenantId, campaign.id as string, `sequence-sec-${randomUUID()}`);
      await adapters.campaignRepository.save(ctx, campaign);
      await adapters.sequenceRepository.save(ctx, sequence);
      await seedTenantAllowlist(adapters, ctx, recipientFromSequence(sequence).address);

      const lead = buildLead(tenantId);
      const evidence = [buildEvidence(tenantId)];
      const plan = buildPlan(campaign.id as string, sequence.id as string, recipientFromSequence(sequence));

      const draft = await service.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
      expect(draft.status).toBe('AWAITING_APPROVAL');
      if (draft.status !== 'AWAITING_APPROVAL') {
        throw new Error(`Draft preparation failed: ${draft.status}`);
      }
      const result = await service.executeApprovedSend(ctx, draft.executionId, 'missing-approval-id' as any);
      expect(result.status).toBe('FAILED');
      expect(provider.getSentMessages()).toHaveLength(0);

      const execution = await adapters.executionRepository.load(ctx, draft.executionId);
      expect(execution?.status).toBe('FAILED_PRE_SUBMISSION');
    } finally {
      await adapters.dispose();
    }
  });

  it('blocks send when approval target does not match execution', async () => {
    if (!pool) return;
    const adapters = await createDurableAdapters();
    try {
      const ctx = createTenantContext(tenantId, { id: 'e2e-operator', role: 'admin' });
      const provider = new StubEmailProvider();
      const { service, approvalRepo } = createExecutionService(adapters, tenantId, provider);

      const campaign = buildCampaign(tenantId, `campaign-sec-target-${randomUUID()}`);
      const sequence = buildSequence(tenantId, campaign.id as string, `sequence-sec-target-${randomUUID()}`);
      await adapters.campaignRepository.save(ctx, campaign);
      await adapters.sequenceRepository.save(ctx, sequence);
      await seedTenantAllowlist(adapters, ctx, recipientFromSequence(sequence).address);

      const lead = buildLead(tenantId);
      const evidence = [buildEvidence(tenantId)];
      const plan = buildPlan(campaign.id as string, sequence.id as string, recipientFromSequence(sequence));

      const draft = await service.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
      if (draft.status !== 'AWAITING_APPROVAL') {
        throw new Error(`Draft preparation failed: ${draft.status}`);
      }
      const executionId = draft.executionId;

      const { Approval } = await import('@projectx/mission-orchestrator');
      const approval = Approval.create(
        {
          id: 'approval-wrong-target' as any,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          workspaceBindingState: 'WORKSPACE_BOUND',
          missionId: 'mission-e2e',
          sequenceId: 'wrong-sequence',
          executionId: executionId as string,
          actionType: 'OUTREACH_EMAIL_SEND',
          riskCategory: 'HIGH',
          proposedAction: { message: 'wrong target' },
          evidence: [],
          reasoning: 'Approval with mismatched sequence',
          confidence: 0.95,
          requestedBy: 'e2e-agent',
          approverRole: 'e2e-operator',
          timeoutSeconds: 3600,
          idempotencyKey: asIdempotencyKey('idem-approval-wrong'),
          correlationId: ctx.correlationId as any,
        },
        asEventId('evt-approval-wrong'),
      );
      if (!approval.success) throw new Error(approval.error.message);
      approval.value.approve('e2e-operator' as any, 'Approved', asCorrelationId('corr-approve'), asEventId('evt-approve'));
      await approvalRepo.save(ctx, approval.value);

      const result = await service.executeApprovedSend(ctx, executionId, 'approval-wrong-target' as any);
      expect(result.status).toBe('FAILED');
      expect(provider.getSentMessages()).toHaveLength(0);
    } finally {
      await adapters.dispose();
    }
  });

  it('enforces RLS: tenant A cannot read tenant B outreach records', async () => {
    if (!pool) return;
    const tenantA = `tenant-rls-a-${randomUUID()}`;
    const tenantB = `tenant-rls-b-${randomUUID()}`;
    const ctxA = createTenantContext(tenantA, { id: 'e2e-operator', role: 'admin' });
    const ctxB = createTenantContext(tenantB, { id: 'e2e-operator', role: 'admin' });
    const adapters = await createDurableAdapters();
    try {
      const campaignA = buildCampaign(tenantA, `campaign-rls-${randomUUID()}`);
      const sequenceA = buildSequence(tenantA, campaignA.id as string, `sequence-rls-${randomUUID()}`);
      await adapters.campaignRepository.save(ctxA, campaignA);
      await adapters.sequenceRepository.save(ctxA, sequenceA);

      const campaignB = await adapters.campaignRepository.load(ctxB, campaignA.id);
      expect(campaignB).toBeNull();

      const sequenceB = await adapters.sequenceRepository.load(ctxB, sequenceA.id);
      expect(sequenceB).toBeNull();
    } finally {
      await adapters.dispose();
    }
  });

  it('does not permit live email to be enabled in the E2E environment', () => {
    expect(process.env.OUTREACH_LIVE_EMAIL_ENABLED).not.toBe('true');
    expect(process.env.GRAPH_WEBHOOK_CALLBACK_URL).toBeFalsy();
    expect(process.env.GRAPH_CLIENT_SECRET).toBeFalsy();
  });
});
