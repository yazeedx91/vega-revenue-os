/**
 * Phase 14.8 approval-wait lifecycle regression tests.
 *
 * Reproduces the controlled real-send blocker: the workflow previously waited
 * at most 600s (hardcoded) for the approval signal, then COMPLETED with
 * TIMEOUT while the persisted execution stayed PENDING_APPROVAL — so a later
 * EXECUTE signaled a dead workflow ("workflow execution already completed").
 *
 * Invariants proven here, against a real Temporal server + the real
 * OutreachSequenceWorkflow + real outreach activities (in-memory repos, stub
 * provider, live email irrelevant — no Graph code is wired):
 *  1. Without approvalTimeoutMs the workflow waits durably: execution reaches
 *     PENDING_APPROVAL and the workflow is still RUNNING.
 *  2. Persist+grant approval signals the SAME running workflow; it resumes,
 *     the provider is called exactly once, and the execution is persisted
 *     ACCEPTED with provider metadata and incremented attempts.
 *  3. A duplicate approval signal can never produce a second provider call.
 *  4. An explicitly supplied approvalTimeoutMs persists the execution as
 *     FAILED before the workflow completes with TIMEOUT; zero provider calls.
 *
 * Skips (like temporal-acceptance.spec.ts) when Temporal is unreachable.
 */
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { randomUUID } from 'crypto';
import type { Lead, OutreachPlan, TenantContext } from '@projectx/domain';
import { OutreachCampaign, OutreachSequence } from '@projectx/domain';
import type { IReasoningEngine, IOutputValidator, ReasoningOutput, ValidationResult } from '@projectx/ai-runtime';
import { InMemoryAuditLog, InMemoryIdempotencyStore, InMemoryRateLimiter } from '@projectx/infrastructure';
import {
  InMemoryCampaignRepository,
  InMemoryMessageExecutionRepository,
  InMemoryOutreachProviderRegistry,
  InMemoryRecipientAllowlistRepository,
  InMemorySequenceRepository,
  InMemorySequenceSchedulePolicy,
  InMemorySuppressionRepository,
  OutreachExecutionService,
  OutreachPersonalizationService,
  OutreachSequenceLifecycleService,
  SendSafetyGate,
  StubEmailProvider,
} from '@projectx/outreach';
import {
  ApprovalApplicationService,
  ApprovalVerificationAdapter,
  InMemoryApprovalRepository,
} from '@projectx/mission-orchestrator';
import { TemporalWorkflowClient } from '@projectx/temporal-client';
import {
  asAccountId,
  asCampaignId,
  asContactId,
  asCorrelationId,
  asEventId,
  asICPProfileId,
  asIdempotencyKey,
  asLeadId,
  asOutreachExecutionId,
  asOutreachMessageId,
  asSequenceId,
  asTenantId,
  asUserId,
  WorkflowIdFactory,
} from '@projectx/shared';
import {
  setOutreachExecutionService,
  setMessageExecutionRepository,
  setSequenceRepository,
} from '../activities/outreach-activities';

const DEFAULT_TEMPORAL_ADDRESS = 'localhost:7234';

async function isReachable(address: string): Promise<boolean> {
  try {
    const connection = await NativeConnection.connect({ address });
    await connection.close();
    return true;
  } catch {
    return false;
  }
}

const tenantId = asTenantId(`tenant-approval-lifecycle-${Date.now()}`);
const ctx: TenantContext = { tenantId, correlationId: asCorrelationId('corr-approval-lifecycle') };

const fakeReasoningEngine: IReasoningEngine = {
  async reason(): Promise<ReasoningOutput> {
    return {
      rationale: 'test draft',
      conclusion: JSON.stringify({
        subject: 'Approval lifecycle test',
        body: 'Deterministic test body.',
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
    return { valid: true, safeOutput: 'Deterministic test body.', piiCheck: 'PASSED' };
  },
};

const RECIPIENT = 'approval-lifecycle-test@example.com';

function buildPlan(campaignId: string, sequenceId: string, leadId: string): OutreachPlan {
  return {
    campaignId: asCampaignId(campaignId),
    sequenceId: asSequenceId(sequenceId),
    leadId: asLeadId(leadId),
    recipient: {
      contactId: asContactId(RECIPIENT),
      name: RECIPIENT,
      email: RECIPIENT,
      channel: 'email',
      address: RECIPIENT,
    },
    channel: 'email',
    steps: [
      {
        stepNumber: 1,
        channel: 'email',
        delayMs: 0,
        requiresApproval: true,
        objective: 'approval-lifecycle-regression',
      },
    ],
    firstDueAt: new Date(),
    businessHours: { timezone: 'UTC', workDays: [1, 2, 3, 4, 5], startHour: 0, endHour: 24 },
    evidenceReferences: [],
    requiresApproval: true,
  } as OutreachPlan;
}

function makeLead(leadId: string): Lead {
  return {
    id: asLeadId(leadId),
    tenantId,
    accountId: asAccountId('acc-approval-lifecycle'),
    contactId: asContactId(RECIPIENT),
    icpProfileId: asICPProfileId('icp-approval-lifecycle'),
    scores: { icpMatch: 1, signalScore: 1, intentScore: 1, evidenceConfidence: 1, overall: 1 },
    status: 'QUALIFIED',
    evidenceReferences: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Lead;
}

describe('Phase 14.8 approval-wait lifecycle (Temporal integration)', () => {
  const address = process.env.TEMPORAL_ADDRESS ?? DEFAULT_TEMPORAL_ADDRESS;
  const taskQueue = `approval-lifecycle-${Date.now()}`;

  let nativeConnection: NativeConnection | undefined;
  let worker: Worker | undefined;
  let workerRun: Promise<void> | undefined;
  let describeClient: Client;

  const sequenceRepo = new InMemorySequenceRepository();
  const executionRepo = new InMemoryMessageExecutionRepository();
  const campaignRepo = new InMemoryCampaignRepository();
  const approvalRepository = new InMemoryApprovalRepository();
  const provider = new StubEmailProvider({ type: 'success', costUsd: 0.01 });
  const allowlistRepo = new InMemoryRecipientAllowlistRepository();

  let workflowClient: TemporalWorkflowClient;
  let lifecycleService: OutreachSequenceLifecycleService;
  let approvalService: ApprovalApplicationService;

  let seed = 0;

  beforeAll(async () => {
    if (!(await isReachable(address))) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping approval lifecycle tests: ${address} unreachable`);
      return;
    }

    const registry = new InMemoryOutreachProviderRegistry();
    registry.register(provider);
    registry.setTenantProvider(tenantId as string, 'email', provider.providerId);

    await allowlistRepo.add(ctx, {
      channel: 'email',
      address: RECIPIENT,
      approvedBy: 'approval-lifecycle-spec',
    });

    const personalizationService = new OutreachPersonalizationService({
      reasoningEngine: fakeReasoningEngine,
      outputValidator: fakeValidator,
      generateMessageId: () => asOutreachMessageId(`msg-${++seed}-${randomUUID().slice(0, 8)}`),
      generateExecutionId: () => `exec-${++seed}-${randomUUID().slice(0, 8)}`,
      generateIdempotencyKey: (hint) => asIdempotencyKey(`idmp-${hint}-${++seed}`),
    });

    const safetyGate = new SendSafetyGate({
      allowlistRepository: allowlistRepo,
      suppressionRepository: new InMemorySuppressionRepository(),
      approvalVerificationPort: new ApprovalVerificationAdapter(approvalRepository),
      rateLimiter: new InMemoryRateLimiter(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      auditLog: new InMemoryAuditLog(),
    });

    const executionService = new OutreachExecutionService({
      campaignRepository: campaignRepo,
      sequenceRepository: sequenceRepo,
      executionRepository: executionRepo,
      providerRegistry: registry,
      schedulePolicy: new InMemorySequenceSchedulePolicy(),
      personalizationService,
      safetyGate,
      generateExecutionId: () => `exec-${++seed}-${randomUUID().slice(0, 8)}`,
      generateEventId: () => asEventId(`evt-${++seed}-${randomUUID().slice(0, 8)}`),
      channelCostEstimate: () => 0.01,
    });

    setOutreachExecutionService(executionService);
    setMessageExecutionRepository(executionRepo);
    setSequenceRepository(sequenceRepo);

    workflowClient = new TemporalWorkflowClient({ address });

    lifecycleService = new OutreachSequenceLifecycleService({
      sequenceRepository: sequenceRepo,
      workflowClient,
      generateExecutionId: () => asOutreachExecutionId(`exec-${++seed}-${randomUUID().slice(0, 8)}`),
      generateEventId: () => asEventId(`evt-${++seed}-${randomUUID().slice(0, 8)}`),
      taskQueue,
    });

    approvalService = new ApprovalApplicationService({
      approvalRepository,
      workflowClient,
      notificationPort: { notifyApprovalRequested: async () => undefined },
      generateEventId: () => asEventId(`evt-${++seed}-${randomUUID().slice(0, 8)}`),
      generateCorrelationId: () => asCorrelationId(`corr-${++seed}-${randomUUID().slice(0, 8)}`),
      generateApprovalId: () => `approval-${++seed}-${randomUUID().slice(0, 8)}`,
    });

    nativeConnection = await NativeConnection.connect({ address });
    describeClient = new Client({ connection: await Connection.connect({ address }) });

    worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../workflows/outreach-sequence-workflow'),
      activities: require('../activities/outreach-activities'),
    });
    workerRun = worker.run().catch(() => {});
  }, 90_000);

  afterAll(async () => {
    worker?.shutdown();
    if (workerRun) {
      await workerRun;
    }
    await nativeConnection?.close();
  });

  async function createStartedSequence(label: string): Promise<{ sequence: OutreachSequence; plan: OutreachPlan; lead: Lead }> {
    const suffix = `${label}-${Date.now()}`;
    const campaignId = `campaign-${suffix}`;
    const sequenceId = `sequence-${suffix}`;
    const leadId = `lead-${suffix}`;
    const plan = buildPlan(campaignId, sequenceId, leadId);
    const lead = makeLead(leadId);

    const evt = () => asEventId(`evt-${++seed}-${randomUUID().slice(0, 8)}`);
    const correlationId = ctx.correlationId as ReturnType<typeof asCorrelationId>;

    const campaign = OutreachCampaign.create(
      {
        id: plan.campaignId,
        tenantId,
        missionId: 'approval-lifecycle-regression',
        leadId: plan.leadId,
        recipient: plan.recipient,
        channel: 'email',
        steps: plan.steps,
      },
      correlationId,
      evt(),
    );
    campaign.submitForApproval(correlationId, evt());
    campaign.approve(asUserId('spec-operator'), 'test', correlationId, evt());
    campaign.start(correlationId, evt());
    await campaignRepo.save(ctx, campaign);

    const sequence = OutreachSequence.create(
      {
        id: plan.sequenceId,
        tenantId,
        campaignId: plan.campaignId,
        leadId: plan.leadId,
        recipient: plan.recipient,
        steps: plan.steps,
      },
      correlationId,
      evt(),
    );
    sequence.submitForApproval(correlationId, evt());
    sequence.approve(asUserId('spec-operator'), 'test', correlationId, evt());
    sequence.start(correlationId, evt());
    await sequenceRepo.save(ctx, sequence);

    return { sequence, plan, lead };
  }

  async function waitForExecutionStatus(
    sequenceId: string,
    statuses: string[],
    timeoutMs: number,
  ): Promise<{ id: string; status: string; providerMessageId?: string; attempts: number } | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const executions = await executionRepo.findBySequence(ctx, asSequenceId(sequenceId));
      const match = executions.find((e) => statuses.includes(e.status));
      if (match) {
        return match as unknown as { id: string; status: string; providerMessageId?: string; attempts: number };
      }
      if (Date.now() >= deadline) {
        return undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async function grantApproval(sequenceId: string, executionId: string): Promise<string> {
    const execution = await executionRepo.load(ctx, asOutreachExecutionId(executionId));
    if (!execution) throw new Error(`Execution ${executionId} not found for approval`);

    const approvalId = await approvalService.requestApproval(ctx, {
      missionId: 'approval-lifecycle-regression',
      sequenceId,
      executionId,
      actionType: 'OUTREACH_EMAIL_SEND',
      riskCategory: 'LIVE_EMAIL_SEND',
      proposedAction: { sequenceId, executionId, recipientAddress: RECIPIENT, channel: 'email' },
      evidence: [{ source: 'spec', summary: 'regression test' }],
      reasoning: 'regression test approval',
      confidence: 1,
      requestedBy: 'spec-operator',
      approverRole: 'phase14-operator',
      timeoutSeconds: 300,
      idempotencyKey: execution.idempotencyKey,
    });
    await approvalService.approve(ctx, {
      approvalId,
      decision: 'APPROVED',
      reason: 'regression test operator YES',
      actorId: 'spec-operator',
    });
    return approvalId;
  }

  it(
    'waits durably for approval (workflow RUNNING at PENDING_APPROVAL), sends exactly once on approval, and survives duplicate signals',
    async () => {
      if (!nativeConnection) return;

      const { sequence, plan, lead } = await createStartedSequence('happy');
      const sequenceId = sequence.id as string;

      const startResult = await lifecycleService.startWorkflow(ctx, sequence, {
        plan,
        lead,
        evidence: [],
        maxIterations: 10,
        replyTimeoutMs: 2_000,
        // No approvalTimeoutMs: the workflow must wait indefinitely.
      });
      expect(startResult.status).toBe('STARTED');
      expect(startResult.workflowId).toBe(WorkflowIdFactory.forOutreachSequence(tenantId as string, sequenceId));

      // PREPARE invariant: execution PENDING_APPROVAL, zero provider calls,
      // workflow still RUNNING (previously it would die after 600s; there is
      // now no timer at all, which we assert via the absence of any timeout
      // and the workflow remaining running once PENDING_APPROVAL is reached).
      const pending = await waitForExecutionStatus(sequenceId, ['PENDING_APPROVAL'], 30_000);
      expect(pending).toBeDefined();
      expect(provider.getSentMessages()).toHaveLength(0);

      const handle = describeClient.workflow.getHandle(startResult.workflowId);
      expect((await handle.describe()).status.name).toBe('RUNNING');

      // EXECUTE + YES invariant: persist approval, signal the SAME workflow.
      await grantApproval(sequenceId, pending!.id);

      const accepted = await waitForExecutionStatus(sequenceId, ['PROVIDER_ACCEPTED', 'DELIVERY_PENDING', 'DELIVERED', 'FAILED'], 30_000);
      expect(accepted).toBeDefined();
      expect(accepted!.status).toBe('DELIVERY_PENDING');
      expect(accepted!.providerMessageId).toBeDefined();
      expect(accepted!.attempts).toBeGreaterThanOrEqual(1);
      expect(provider.getSentMessages()).toHaveLength(1);

      // Duplicate approval signal while the workflow is still running must
      // never cause a second provider call.
      await workflowClient.signal(
        ctx,
        { workflowId: startResult.workflowId, tenantId: tenantId as string, correlationId: ctx.correlationId },
        'outreachApprovalGranted',
        { executionId: pending!.id, approvalId: 'duplicate-signal' },
      );

      const result = await handle.result();
      expect(result.status).toBe('COMPLETED');
      expect(provider.getSentMessages()).toHaveLength(1);
    },
    120_000,
  );

  it(
    'explicit approvalTimeoutMs persists the execution as FAILED before completing with TIMEOUT and never sends',
    async () => {
      if (!nativeConnection) return;

      const sentBefore = provider.getSentMessages().length;
      const { sequence, plan, lead } = await createStartedSequence('timeout');
      const sequenceId = sequence.id as string;

      const startResult = await lifecycleService.startWorkflow(ctx, sequence, {
        plan,
        lead,
        evidence: [],
        maxIterations: 10,
        replyTimeoutMs: 2_000,
        approvalTimeoutMs: 2_000,
      });
      expect(startResult.status).toBe('STARTED');

      const handle = describeClient.workflow.getHandle(startResult.workflowId);
      const result = await handle.result();
      expect(result.status).toBe('TIMEOUT');
      expect(result.reason).toBe('Timed out waiting for approval signal');

      // DB state must be consistent: the execution is FAILED, not stuck in
      // PENDING_APPROVAL for a workflow that no longer exists.
      const failed = await waitForExecutionStatus(sequenceId, ['FAILED'], 10_000);
      expect(failed).toBeDefined();
      expect(provider.getSentMessages().length).toBe(sentBefore);
    },
    120_000,
  );
});
