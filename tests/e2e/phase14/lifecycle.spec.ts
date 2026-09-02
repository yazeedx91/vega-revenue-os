import { Pool } from 'pg';
import type { RedisClientType } from 'redis';
import { randomUUID } from 'crypto';
import {
  asEventId,
  asCorrelationId,
  asIdempotencyKey,
} from '@projectx/shared';
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

describe('Phase 14.7c deterministic outreach lifecycle', () => {
  let pool: Pool | undefined;
  let redis: RedisClientType | undefined;
  const tenantId = `tenant-e2e-${randomUUID()}`;

  beforeAll(async () => {
    requireEnv();
    try {
      pool = await connectPostgres();
      redis = await connectRedis();
      await runMigrations();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Skipping E2E lifecycle tests because integration services are unreachable:', err);
    }
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await redis?.disconnect();
  });

  it('end-to-end: draft, approval, send, and complete with real Postgres + Redis', async () => {
    if (!pool) return;
    const adapters = await createDurableAdapters();
    try {
      const ctx = createTenantContext(tenantId, { id: 'e2e-operator', role: 'admin' });
      const emailProvider = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
      const { service, approvalRepo } = createExecutionService(adapters, tenantId, emailProvider);

      const campaign = buildCampaign(tenantId);
      const sequence = buildSequence(tenantId, campaign.id as string);
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
          proposedAction: { message: 'E2E send' },
          evidence: [],
          reasoning: 'Approved by E2E lifecycle test',
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

      const sendResult = await service.executeApprovedSend(ctx, executionId, approvalId as any);
      expect(sendResult.status).toBe('COMPLETED');

      expect(emailProvider.getSentMessages()).toHaveLength(1);
      const [sent] = emailProvider.getSentMessages();
      expect(sent.recipientAddress).toBe(recipientAddress);
      expect(sent.simulatedStatus).toBe('PROVIDER_ACCEPTED');
      expect(sent.providerMessageId).toBeDefined();

      const loadedExecution = await adapters.executionRepository.load(ctx, executionId);
      expect(loadedExecution?.status).toBe('DELIVERY_PENDING');
      expect(loadedExecution?.providerMessageId).toBe(sent.providerMessageId);

      const reloadedCampaign = await adapters.campaignRepository.load(ctx, campaign.id);
      expect(reloadedCampaign?.sentCount).toBe(1);
      expect(reloadedCampaign?.spentCostUsd).toBeGreaterThan(0);

      const reloadedSequence = await adapters.sequenceRepository.load(ctx, sequence.id);
      expect(reloadedSequence?.status).toBe('COMPLETED');

      const auditClient = await pool.connect();
      try {
        await auditClient.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
        var audit = await auditClient.query(
          `SELECT action, result FROM audit.audit_log WHERE tenant_id = $1 AND resource_id = $2`,
          [tenantId, executionId as string],
        );
      } finally {
        auditClient.release();
      }
      expect(audit.rowCount).toBeGreaterThan(0);
      expect(audit.rows.some((r) => r.action === 'OUTREACH_SEND_SAFETY_DECISION' && r.result === 'success')).toBe(true);

      // Idempotent re-execution must not send a second message.
      const secondResult = await service.executeApprovedSend(ctx, executionId, approvalId as any);
      expect(secondResult.status).toBe('COMPLETED');
      expect(emailProvider.getSentMessages()).toHaveLength(1);
    } finally {
      await adapters.dispose();
    }
  });

  it('denies send when recipient is not on the tenant allowlist', async () => {
    if (!pool) return;
    const adapters = await createDurableAdapters();
    try {
      const ctx = createTenantContext(tenantId, { id: 'e2e-operator', role: 'admin' });
      const emailProvider = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
      const { service } = createExecutionService(adapters, tenantId, emailProvider);

      const campaign = buildCampaign(tenantId, `campaign-unallowed-${randomUUID()}`, 'unallowed@example.com');
      const sequence = buildSequence(tenantId, campaign.id as string, `sequence-unallowed-${randomUUID()}`, 'unallowed@example.com');

      await adapters.campaignRepository.save(ctx, campaign);
      await adapters.sequenceRepository.save(ctx, sequence);

      const lead = buildLead(tenantId);
      const evidence = [buildEvidence(tenantId)];
      const plan = buildPlan(campaign.id as string, sequence.id as string, sequence.recipient);

      const draft = await service.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
      expect(draft.status).toBe('AWAITING_APPROVAL');
      if (draft.status !== 'AWAITING_APPROVAL') {
        throw new Error(`Draft preparation failed: ${draft.status}`);
      }
      const sendResult = await service.executeApprovedSend(ctx, draft.executionId, `approval-${draft.executionId as string}` as any);
      expect(sendResult.status).toBe('FAILED');
      expect(emailProvider.getSentMessages()).toHaveLength(0);
    } finally {
      await adapters.dispose();
    }
  });

  it('blocks send when recipient is suppressed', async () => {
    if (!pool) return;
    const adapters = await createDurableAdapters();
    try {
      const ctx = createTenantContext(tenantId, { id: 'e2e-operator', role: 'admin' });
      const emailProvider = new StubEmailProvider({ type: 'success', costUsd: 0.05 });
      const { service } = createExecutionService(adapters, tenantId, emailProvider);

      const recipientAddress = `suppressed-${randomUUID()}@example.com`;
      const campaign = buildCampaign(tenantId, `campaign-suppressed-${randomUUID()}`, recipientAddress);
      const sequence = buildSequence(tenantId, campaign.id as string, `sequence-suppressed-${randomUUID()}`, recipientAddress);

      await adapters.campaignRepository.save(ctx, campaign);
      await adapters.sequenceRepository.save(ctx, sequence);
      await seedTenantAllowlist(adapters, ctx, recipientAddress);
      await adapters.suppressionRepository.suppress(ctx, recipientAddress, 'OPT_OUT', 'e2e-test', 'Deterministic opt-out');

      const lead = buildLead(tenantId);
      const evidence = [buildEvidence(tenantId)];
      const plan = buildPlan(campaign.id as string, sequence.id as string, sequence.recipient);

      const draft = await service.prepareDraft(ctx, sequence.id as string, plan, lead, evidence);
      if (draft.status !== 'AWAITING_APPROVAL') {
        throw new Error(`Draft preparation failed: ${draft.status}`);
      }
      const sendResult = await service.executeApprovedSend(ctx, draft.executionId, `approval-${draft.executionId as string}` as any);
      expect(sendResult.status).toBe('FAILED');
      expect(emailProvider.getSentMessages()).toHaveLength(0);

      const execution = await adapters.executionRepository.load(ctx, draft.executionId);
      expect(execution?.status).toBe('FAILED_PRE_SUBMISSION');
    } finally {
      await adapters.dispose();
    }
  });

  it('isolates tenant data: other tenant cannot see allowlist, campaigns, or executions', async () => {
    if (!pool) return;
    const adapters = await createDurableAdapters();
    try {
      const tenantA = `tenant-a-${randomUUID()}`;
      const tenantB = `tenant-b-${randomUUID()}`;
      const ctxA = createTenantContext(tenantA, { id: 'e2e-operator', role: 'admin' });
      const ctxB = createTenantContext(tenantB, { id: 'e2e-operator', role: 'admin' });

      const campaignA = buildCampaign(tenantA, `campaign-iso-a-${randomUUID()}`, 'iso@example.com');
      const sequenceA = buildSequence(tenantA, campaignA.id as string, `sequence-iso-a-${randomUUID()}`, 'iso@example.com');
      await adapters.campaignRepository.save(ctxA, campaignA);
      await adapters.sequenceRepository.save(ctxA, sequenceA);
      await seedTenantAllowlist(adapters, ctxA, 'iso@example.com');

      const loadedByB = await adapters.campaignRepository.load(ctxB, campaignA.id);
      expect(loadedByB).toBeNull();

      const allowedForB = await adapters.allowlistRepository.isAllowed(ctxB, 'email', 'iso@example.com');
      expect(allowedForB).toBe(false);
    } finally {
      await adapters.dispose();
    }
  });
});
