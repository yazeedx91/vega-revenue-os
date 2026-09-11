import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  Lead,
  OutreachMessageExecution,
  OutreachSequence,
  type MessageDraft,
  type OutreachPlan,
  type TenantContext,
} from '@projectx/domain';
import { InMemoryLeadRepository } from '@projectx/conversation';
import {
  ApprovalApplicationService,
  InMemoryApprovalRepository,
} from '@projectx/mission-orchestrator';
import type { ControlledCommunicationConfig } from '@projectx/infrastructure';
import type { IWorkflowClient, WorkflowExecutionRef, WorkflowStartOptions, WorkflowStartResult } from '@projectx/infrastructure';
import {
  asCampaignId,
  asContactId,
  asCorrelationId,
  asEventId,
  asIdempotencyKey,
  asLeadId,
  asOutreachExecutionId,
  asOutreachMessageId,
  asSequenceId,
  asTenantId,
  asUserId,
} from '@projectx/shared';
import { WorkflowIdFactory } from '@projectx/shared';
import {
  InMemoryCampaignRepository,
  InMemoryMessageExecutionRepository,
  InMemoryRecipientAllowlistRepository,
  InMemorySequenceRepository,
  InMemorySuppressionRepository,
  OutreachSequenceLifecycleService,
  type IOutboundRecipientSource,
} from '@projectx/outreach';
import {
  Phase14RealSendOperator,
  type Phase14RealSendOperatorConfig,
} from '../../../../scripts/phase14-8-real-send/operator';

const TEST_TENANT = 'test-tenant';
const RECIPIENT = 'phase14-real@example.com';
const CONTACT_ID = 'phase14-real-contact';
const OPERATOR_ID = 'phase14-test-operator';

function newCtx(correlationSuffix?: string): TenantContext {
  return {
    tenantId: asTenantId(TEST_TENANT),
    workspaceId: 'workspace-1',
    correlationId: asCorrelationId(
      `corr-${correlationSuffix ?? randomUUID().slice(0, 8)}`,
    ),
  };
}

class FakeWorkflowClient implements IWorkflowClient {
  public starts: Array<{
    workflowType: string;
    input: unknown;
    options?: WorkflowStartOptions;
  }> = [];
  public signals: Array<{
    ref: WorkflowExecutionRef;
    signalName: string;
    payload: unknown;
  }> = [];

  constructor(
    private readonly executionRepository: InMemoryMessageExecutionRepository,
    private readonly tenantId: string,
  ) {}

  async start<TInput = unknown>(
    ctx: TenantContext,
    workflowType: string,
    input: TInput,
    options?: WorkflowStartOptions,
  ): Promise<WorkflowStartResult> {
    this.starts.push({ workflowType, input, options });
    return {
      workflowId: options?.workflowId ?? 'wf-test',
      tenantId: ctx.tenantId as string,
      correlationId: ctx.correlationId,
      status: 'STARTED',
    };
  }

  async signal<TSignal = unknown>(
    ctx: TenantContext,
    ref: WorkflowExecutionRef,
    signalName: string,
    payload: TSignal,
  ): Promise<void> {
    this.signals.push({ ref, signalName, payload });

    if (signalName === 'outreachApprovalGranted') {
      const typedPayload = payload as { executionId?: string; approvalId?: string };
      const executionId = typedPayload.executionId;
      if (!executionId) return;

      const execution = await this.executionRepository.load(
        ctx,
        asOutreachExecutionId(executionId),
      );
      if (!execution) return;

      const corr = asCorrelationId(`signal-${randomUUID().slice(0, 8)}`);
      const evt = asEventId(`evt-${randomUUID().slice(0, 8)}`);

      execution.approve(
        typedPayload.approvalId as string,
        corr,
        evt,
      );
      execution.markSending(corr, evt);
      execution.markProviderAttempt('graph-email');
      execution.markProviderAccepted(
        undefined,
        undefined,
        undefined,
        corr,
        evt,
      );
      execution.markDeliveryPending(corr, evt);

      await this.executionRepository.save(ctx, execution);
    }
  }

  async query<T>(): Promise<T> {
    throw new Error('not implemented in test double');
  }

  async cancel(): Promise<void> {
    // no-op for tests
  }
}

function buildDependencies(liveEmailEnabled: boolean): {
  config: ControlledCommunicationConfig;
  operatorConfig: Phase14RealSendOperatorConfig;
  workflowClient: FakeWorkflowClient;
  executionRepository: InMemoryMessageExecutionRepository;
  sequenceRepository: InMemorySequenceRepository;
  campaignRepository: InMemoryCampaignRepository;
  allowlistRepository: InMemoryRecipientAllowlistRepository;
  suppressionRepository: InMemorySuppressionRepository;
  approvalRepository: InMemoryApprovalRepository;
  leadRepository: InMemoryLeadRepository;
} {
  const campaignRepository = new InMemoryCampaignRepository();
  const sequenceRepository = new InMemorySequenceRepository();
  const executionRepository = new InMemoryMessageExecutionRepository();
  const allowlistRepository = new InMemoryRecipientAllowlistRepository();
  const suppressionRepository = new InMemorySuppressionRepository();
  const approvalRepository = new InMemoryApprovalRepository();
  const leadRepository = new InMemoryLeadRepository();
  const recipientSource: IOutboundRecipientSource = {
    async resolveProtectedEmailRecipient() {
      return {
        contactId: CONTACT_ID,
        recipientFingerprint: 'h1.1.fingerprint123',
        recipientCiphertext: 'e1.1.ciphertext456',
        recipientProtectionState: 'PROTECTED',
      };
    },
  };
  const recipientRecovery = {
    async recoverEmailForSend(_tenantId: string, recipientCiphertext: string): Promise<string> {
      return recipientCiphertext === 'e1.1.ciphertext456' ? RECIPIENT : 'unknown@example.com';
    },
  };
  const historicalRecipientFingerprint = {
    async fingerprintEmailForVersion(_tenantId: string, rawEmail: string, keyVersion: string): Promise<string> {
      if (rawEmail === RECIPIENT && keyVersion === '1') return 'h1.1.fingerprint123';
      return `h1.${keyVersion}.unknown`;
    },
  };
  const workflowClient = new FakeWorkflowClient(executionRepository, TEST_TENANT);

  const lifecycleService = new OutreachSequenceLifecycleService({
    sequenceRepository,
    workflowClient,
    generateExecutionId: () =>
      asOutreachExecutionId(`exec-${randomUUID().slice(0, 8)}`),
    generateEventId: () => asEventId(`evt-${randomUUID().slice(0, 8)}`),
    taskQueue: 'outreach-execution',
  });

  const approvalApplicationService = new ApprovalApplicationService({
    approvalRepository,
    workflowClient,
    notificationPort: {
      notifyApprovalRequested: async () => {
        // Intentionally silent in tests.
      },
    },
    generateEventId: () => asEventId(`evt-${randomUUID().slice(0, 8)}`),
    generateCorrelationId: () =>
      asCorrelationId(`corr-${randomUUID().slice(0, 8)}`),
    generateApprovalId: () => `approval-${randomUUID().slice(0, 8)}`,
  });

  const config: ControlledCommunicationConfig = {
    liveEmailEnabled,
    mode: 'ALLOWLIST_ONLY',
    databaseUrl: 'fake',
    redisUrl: 'fake',
    temporalNamespace: 'default',
    graphTenantId: 'tenant-id',
    graphClientId: 'client-id',
    graphClientSecret: 'client-secret',
  };

  const operatorConfig: Phase14RealSendOperatorConfig = {
    config,
    campaignRepository,
    sequenceRepository,
    executionRepository,
    allowlistRepository,
    suppressionRepository,
    approvalRepository,
    leadRepository,
    lifecycleService,
    approvalApplicationService,
    workflowClient,
    recipientSource,
    recipientRecovery,
    historicalRecipientFingerprint,
    workspaceId: 'workspace-1',
    operatorId: OPERATOR_ID,
    prepareWaitMs: 0,
    executeWaitMs: 0,
    stateFilePath: path.join(
      os.tmpdir(),
      `phase14-8-operator-${randomUUID().slice(0, 8)}.json`,
    ),
    confirm: async () => true,
  };

  return {
    config,
    operatorConfig,
    workflowClient,
    executionRepository,
    sequenceRepository,
    campaignRepository,
    allowlistRepository,
    suppressionRepository,
    approvalRepository,
    leadRepository,
  };
}

describe('Phase14RealSendOperator', () => {
  it('prepare refuses when OUTREACH_MODE is not ALLOWLIST_ONLY', async () => {
    const deps = buildDependencies(false);
    deps.operatorConfig.config = { ...deps.config, mode: 'UNRESTRICTED' };
    const operator = new Phase14RealSendOperator(deps.operatorConfig);

    await expect(operator.prepare(newCtx(), RECIPIENT, CONTACT_ID)).rejects.toThrow(
      /OUTREACH_MODE must be 'ALLOWLIST_ONLY'/,
    );
  });

  it('prepare refuses when live email is already enabled', async () => {
    const deps = buildDependencies(true);
    const operator = new Phase14RealSendOperator(deps.operatorConfig);

    await expect(operator.prepare(newCtx(), RECIPIENT, CONTACT_ID)).rejects.toThrow(
      /OUTREACH_LIVE_EMAIL_ENABLED must be false during PREPARE/,
    );
  });

  it('prepare refuses when recipient is not in the allowlist', async () => {
    const deps = buildDependencies(false);
    const operator = new Phase14RealSendOperator(deps.operatorConfig);

    await expect(operator.prepare(newCtx(), RECIPIENT, CONTACT_ID)).rejects.toThrow(
      /NOT in the allowlist/,
    );
  });

  it('prepare refuses when recipient is suppressed', async () => {
    const deps = buildDependencies(false);
    const ctx = newCtx('allow-suppress');
    await deps.allowlistRepository.add(ctx, {
      channel: 'email',
      address: RECIPIENT,
      approvedBy: OPERATOR_ID,
      reason: 'test',
    });
    await deps.suppressionRepository.suppress(ctx, RECIPIENT, 'OPT_OUT', 'operator-test');

    const operator = new Phase14RealSendOperator(deps.operatorConfig);

    await expect(operator.prepare(ctx, RECIPIENT, CONTACT_ID)).rejects.toThrow(
      /on the suppression list/,
    );
  });

  it('prepare creates campaign/sequence and starts the workflow without approving or sending', async () => {
    const deps = buildDependencies(false);
    const ctx = newCtx('prepare-success');
    await deps.allowlistRepository.add(ctx, {
      channel: 'email',
      address: RECIPIENT,
      approvedBy: OPERATOR_ID,
      reason: 'test',
    });

    const operator = new Phase14RealSendOperator(deps.operatorConfig);
    const result = await operator.prepare(ctx, RECIPIENT, CONTACT_ID);

    expect(result.status).toBe('AWAITING_APPROVAL_PENDING');
    expect(result.sequenceId).toMatch(/^phase14-8-sequence-/);
    expect(result.campaignId).toMatch(/^phase14-8-campaign-/);
    expect(result.workflowId).toBe(
      WorkflowIdFactory.forOutreachSequence(TEST_TENANT, result.sequenceId),
    );

    const campaign = await deps.campaignRepository.load(ctx, asCampaignId(result.campaignId));
    const sequence = await deps.sequenceRepository.load(ctx, asSequenceId(result.sequenceId));

    expect(campaign).not.toBeNull();
    expect(sequence).not.toBeNull();
    expect(sequence?.status).toBe('RUNNING');
    expect(sequence?.workflowId).toBe(result.workflowId);

    expect(deps.workflowClient.starts).toHaveLength(1);
    expect(deps.workflowClient.starts[0].workflowType).toBe('OutreachSequenceWorkflow');
    expect(deps.workflowClient.starts[0].options?.workflowId).toBe(result.workflowId);

    expect(deps.workflowClient.signals).toHaveLength(0);
  });

  it('execute refuses when live email is not enabled', async () => {
    const deps = buildDependencies(false);
    const operator = new Phase14RealSendOperator(deps.operatorConfig);

    await expect(operator.execute(newCtx(), 'any-sequence-id')).rejects.toThrow(
      /OUTREACH_LIVE_EMAIL_ENABLED must be true before EXECUTE/,
    );
  });

  it('execute requests approval, signals the workflow, and returns the provider result', async () => {
    const deps = buildDependencies(false);
    const ctx = newCtx('execute-success');
    await deps.allowlistRepository.add(ctx, {
      channel: 'email',
      address: RECIPIENT,
      approvedBy: OPERATOR_ID,
      reason: 'test',
    });

    const operator = new Phase14RealSendOperator(deps.operatorConfig);
    const prepareResult = await operator.prepare(ctx, RECIPIENT, CONTACT_ID);

    // Simulate the worker having created a PENDING_APPROVAL execution.
    const execution = OutreachMessageExecution.create(
      {
        tenantId: ctx.tenantId,
        workspaceId: 'workspace-1',
        campaignId: asCampaignId(prepareResult.campaignId),
        sequenceId: asSequenceId(prepareResult.sequenceId),
        stepNumber: 1,
        leadId: 'test-lead',
        contactId: CONTACT_ID,
        recipientFingerprint: 'h1.1.fingerprint123',
        recipientCiphertext: 'e1.1.ciphertext456',
        recipientProtectionState: 'PROTECTED',
        channel: 'email',
        idempotencyKey: asIdempotencyKey('test-idempotency-key'),
      },
      ctx.correlationId,
      asEventId(`evt-${randomUUID().slice(0, 8)}`),
    );
    execution.startDrafting(
      ctx.correlationId,
      asEventId(`evt-${randomUUID().slice(0, 8)}`),
    );
    execution.setDraft(
      asOutreachMessageId('internet-message-id-123'),
      { subject: 'Phase 14.8 test', body: 'body', cta: 'Reply' } as MessageDraft,
      ctx.correlationId,
      asEventId(`evt-${randomUUID().slice(0, 8)}`),
    );
    await deps.executionRepository.save(ctx, execution);

    // Enable live email only for execute.
    deps.operatorConfig.config = { ...deps.config, liveEmailEnabled: true };

    const executeResult = await operator.execute(ctx, prepareResult.sequenceId);

    expect(executeResult.status).toBe('DELIVERY_PENDING');
    expect(executeResult.executionId).toBe(execution.id as string);
    expect(executeResult.providerMessageId).toBeUndefined();
    expect(executeResult.internetMessageId).toBeUndefined();

    expect(deps.workflowClient.signals).toHaveLength(1);
    expect(deps.workflowClient.signals[0].signalName).toBe('outreachApprovalGranted');

    const approvals = await deps.approvalRepository.load(
      ctx.tenantId,
      deps.workflowClient.signals[0].payload.approvalId as string,
    );
    expect(approvals?.status).toBe('APPROVED');
  });

  it('restarts from protected state only and still targets the originally planned recipient', async () => {
    const deps = buildDependencies(false);
    const ctx = newCtx('restart-proof');
    await deps.allowlistRepository.add(ctx, {
      channel: 'email',
      address: RECIPIENT,
      approvedBy: OPERATOR_ID,
      reason: 'test',
    });

    const stateFilePath = deps.operatorConfig.stateFilePath as string;

    const firstOperator = new Phase14RealSendOperator(deps.operatorConfig);
    const prepareResult = await firstOperator.prepare(ctx, RECIPIENT, CONTACT_ID);

    const firstStateBytes = await fs.readFile(stateFilePath);
    const firstStateText = firstStateBytes.toString('utf-8');
    expect(firstStateText).not.toContain(RECIPIENT);
    expect(firstStateText).not.toContain('recipientAddress');
    expect(firstStateText).toContain('"recipientFingerprint"');
    expect(firstStateText).toContain('"recipientCiphertext"');
    expect(firstStateText).toContain('"recipientProtectionState"');
    expect(firstStateText).toContain('"contactId"');
    expect(firstStateText).toContain('"workspaceId"');

    const NEW_RECIPIENT = 'new-recipient@example.com';

    const restartedConfig = {
      ...deps.operatorConfig,
      recipientSource: {
        async resolveProtectedEmailRecipient() {
          return {
            contactId: CONTACT_ID,
            recipientFingerprint: 'h1.1.fingerprint-new',
            recipientCiphertext: 'e1.1.ciphertext-new',
            recipientProtectionState: 'PROTECTED',
          };
        },
      },
      // Keep the original recovery/fingerprint services bound to the originally planned recipient.
      // A real implementation recovers from the state ciphertext, which still encodes the original recipient.
      recipientRecovery: {
        async recoverEmailForSend(_tenantId: string, recipientCiphertext: string): Promise<string> {
          return recipientCiphertext === 'e1.1.ciphertext456' ? RECIPIENT : 'unknown@example.com';
        },
      },
      historicalRecipientFingerprint: {
        async fingerprintEmailForVersion(_tenantId: string, rawEmail: string, keyVersion: string): Promise<string> {
          if (rawEmail === RECIPIENT && keyVersion === '1') return 'h1.1.fingerprint123';
          if (rawEmail === NEW_RECIPIENT) throw new Error('Unexpected new recipient fingerprinted');
          return `h1.${keyVersion}.unknown`;
        },
      },
    };

    const execution = OutreachMessageExecution.create(
      {
        tenantId: ctx.tenantId,
        workspaceId: 'workspace-1',
        campaignId: asCampaignId(prepareResult.campaignId),
        sequenceId: asSequenceId(prepareResult.sequenceId),
        stepNumber: 1,
        leadId: 'test-lead',
        contactId: CONTACT_ID,
        recipientFingerprint: 'h1.1.fingerprint123',
        recipientCiphertext: 'e1.1.ciphertext456',
        recipientProtectionState: 'PROTECTED',
        channel: 'email',
        idempotencyKey: asIdempotencyKey('test-idempotency-key-restart'),
      },
      ctx.correlationId,
      asEventId(`evt-${randomUUID().slice(0, 8)}`),
    );
    execution.startDrafting(ctx.correlationId, asEventId(`evt-${randomUUID().slice(0, 8)}`));
    execution.setDraft(
      asOutreachMessageId('internet-message-id-restart'),
      { subject: 'Phase 14.8 restart test', body: 'body', cta: 'Reply' } as MessageDraft,
      ctx.correlationId,
      asEventId(`evt-${randomUUID().slice(0, 8)}`),
    );
    await deps.executionRepository.save(ctx, execution);

    deps.operatorConfig.config = { ...deps.config, liveEmailEnabled: true };

    restartedConfig.config = { ...deps.config, liveEmailEnabled: true };
    const restartedOperator = new Phase14RealSendOperator(restartedConfig);
    const executeResult = await restartedOperator.execute(ctx, prepareResult.sequenceId);

    expect(executeResult.status).toBe('DELIVERY_PENDING');
    expect(executeResult.executionId).toBe(execution.id as string);

    const postExecuteStateBytes = await fs.readFile(stateFilePath);
    const postExecuteStateText = postExecuteStateBytes.toString('utf-8');
    expect(postExecuteStateText).not.toContain(RECIPIENT);
    expect(postExecuteStateText).not.toContain(NEW_RECIPIENT);
    expect(postExecuteStateText).not.toContain('recipientAddress');
  });
});
