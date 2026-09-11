import { randomUUID, timingSafeEqual } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { Pool } from 'pg';
import { TemporalWorkflowClient } from '@projectx/temporal-client';
import {
  Lead,
  OutreachCampaign,
  OutreachSequence,
  type OutreachPlan,
  type ProtectedRecipientSnapshot,
  type ResearchEvidence,
  type SequenceStep,
  type TenantContext,
} from '@projectx/domain';
import {
  AzureKeyVaultSecretsProvider,
  EnvironmentSecretsProvider,
  loadControlledCommunicationConfig,
  type ControlledCommunicationConfig,
  validateControlledCommunicationConfig,
  type ISecretsProvider,
  type IWorkflowClient,
} from '@projectx/infrastructure';
import {
  PostgresCampaignRepository,
  PostgresMessageExecutionRepository,
  PostgresRecipientAllowlistRepository,
  PostgresSequenceRepository,
  PostgresSuppressionRepository,
  OutreachSequenceLifecycleService,
  RepositoryOutboundRecipientSource,
  type ICampaignRepository,
  type IMessageExecutionRepository,
  type IOutboundRecipientSource,
  type IRecipientAllowlistRepository,
  type ISequenceRepository,
  type ISuppressionRepository,
} from '@projectx/outreach';
import {
  ApprovalApplicationService,
  PostgresApprovalRepository,
  PostgresMissionRepository,
  type IApprovalRepository,
  type INotificationPort,
} from '@projectx/mission-orchestrator';
import { PostgresLeadRepository, type ILeadRepository } from '@projectx/conversation';
import { PostgresContactRepository } from '@projectx/intelligence';
import {
  HistoricalRecipientFingerprint,
  OutboundRecipientRecovery,
  type IHistoricalRecipientFingerprint,
  type IOutboundRecipientRecovery,
} from '@projectx/application';
import {
  asAccountId,
  asCampaignId,
  asContactId,
  asCorrelationId,
  asEventId,
  asICPProfileId,
  asICPProfileVersionId,
  asIdempotencyKey,
  asLeadId,
  asOutreachExecutionId,
  asOutreachMessageId,
  asSequenceId,
  asTenantId,
  asUserId,
  WorkflowIdFactory,
} from '@projectx/shared';

export interface Phase14RealSendPrepareResult {
  campaignId: string;
  sequenceId: string;
  executionId?: string;
  workflowId: string;
  status: 'AWAITING_APPROVAL' | 'AWAITING_APPROVAL_PENDING' | 'FAILED';
  reason?: string;
}

export interface Phase14RealSendExecuteResult {
  executionId: string;
  status: string;
  providerMessageId?: string;
  internetMessageId?: string;
  nextDueAt?: Date;
}

export interface Phase14RealSendOperatorConfig {
  config: ControlledCommunicationConfig;
  campaignRepository: ICampaignRepository;
  sequenceRepository: ISequenceRepository;
  executionRepository: IMessageExecutionRepository;
  allowlistRepository: IRecipientAllowlistRepository;
  suppressionRepository: ISuppressionRepository;
  approvalRepository: IApprovalRepository;
  leadRepository: ILeadRepository;
  lifecycleService: OutreachSequenceLifecycleService;
  approvalApplicationService: ApprovalApplicationService;
  workflowClient: IWorkflowClient;
  recipientSource: IOutboundRecipientSource;
  recipientRecovery: IOutboundRecipientRecovery;
  historicalRecipientFingerprint: IHistoricalRecipientFingerprint;
  workspaceId?: string;
  operatorId?: string;
  stateFilePath?: string;
  confirm?: (message: string) => Promise<boolean>;
  prepareWaitMs?: number;
  executeWaitMs?: number;
  onDispose?: () => Promise<void>;
}

const DEFAULT_STATE_FILE = '.phase14-8-real-send-state.json';
const DEFAULT_PREPARE_WAIT_MS = 60_000;
const DEFAULT_EXECUTE_WAIT_MS = 60_000;
const DEFAULT_OPERATOR_ID = 'phase14-operator';

function buildPlan(
  campaignId: ReturnType<typeof asCampaignId>,
  sequenceId: ReturnType<typeof asSequenceId>,
  leadId: ReturnType<typeof asLeadId>,
  recipient: ProtectedRecipientSnapshot,
  workspaceId: string,
): OutreachPlan {
  const steps: SequenceStep[] = [
    {
      stepNumber: 1,
      channel: 'email',
      delayMs: 0,
      requiresApproval: true,
      objective: 'phase14-8-first-real-send',
    },
  ];

  return {
    campaignId,
    sequenceId,
    leadId,
    recipient,
    channel: 'email',
    steps,
    firstDueAt: new Date(),
    businessHours: {
      timezone: 'UTC',
      workDays: [1, 2, 3, 4, 5],
      startHour: 9,
      endHour: 17,
    },
    evidenceReferences: [],
    requiresApproval: true,
  };
}

class NoOpNotificationPort implements INotificationPort {
  async notifyApprovalRequested(): Promise<void> {
    // Intentionally silent for the operator launcher.
  }
}

export class Phase14RealSendOperator {
  private readonly config: Phase14RealSendOperatorConfig;

  constructor(config: Phase14RealSendOperatorConfig) {
    this.config = config;
  }

  async prepare(
    ctx: TenantContext,
    recipientAddress: string,
    contactId: string,
  ): Promise<Phase14RealSendPrepareResult> {
    if (this.config.config.mode !== 'ALLOWLIST_ONLY') {
      throw new Error(
        `OUTREACH_MODE must be 'ALLOWLIST_ONLY' for the first real send, got: ${this.config.config.mode ?? 'undefined'}`,
      );
    }

    if (this.config.config.liveEmailEnabled) {
      throw new Error(
        'OUTREACH_LIVE_EMAIL_ENABLED must be false during PREPARE. The workflow must be prepared before live email is enabled.',
      );
    }

    if (!recipientAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientAddress)) {
      throw new Error('Invalid recipient email address supplied to prepare.');
    }

    await this.ensureAllowlistAndNotSuppressed(ctx, recipientAddress);

    const tenantId = ctx.tenantId as string;
    const workspaceId = this.config.workspaceId ?? tenantId;
    const workspaceCtx = { ...ctx, workspaceId };
    const campaignId = asCampaignId(`phase14-8-campaign-${tenantId}-${Date.now()}`);
    const sequenceId = asSequenceId(`phase14-8-sequence-${tenantId}-${Date.now()}`);
    const leadId = asLeadId(`phase14-8-lead-${tenantId}-${recipientAddress}`);
    const contactIdTyped = asContactId(contactId || recipientAddress);

    const lead = Lead.create(
      {
        id: leadId,
        tenantId: ctx.tenantId,
        workspaceId,
        accountId: asAccountId('phase14-8-test-account'),
        contactId: contactIdTyped,
        icpProfileId: asICPProfileId('phase14-8-test-icp'),
        icpProfileVersionId: asICPProfileVersionId('phase14-8-test-icp-v1'),
        scores: {
          icpMatch: 1,
          signalScore: 1,
          intentScore: 1,
          evidenceConfidence: 1,
          overall: 1,
        },
        status: 'QUALIFIED',
        decisionReason: 'Phase 14.8 first real send test lead',
      },
      ctx.correlationId as ReturnType<typeof asCorrelationId>,
      this.newEventId(),
    );

    await this.config.leadRepository.save(workspaceCtx, lead);

    const recipient = await this.config.recipientSource.resolveProtectedEmailRecipient({
      tenantId,
      workspaceId,
      leadId: leadId as string,
      contactId: contactIdTyped as string,
    });

    const plan = buildPlan(campaignId, sequenceId, leadId, recipient, workspaceId);

    const campaign = OutreachCampaign.create(
      {
        id: campaignId,
        tenantId: ctx.tenantId,
        workspaceId,
        missionId: 'phase14-8-first-real-send',
        leadId,
        contactId: contactIdTyped as string,
        recipientFingerprint: plan.recipient.recipientFingerprint,
        recipientProtectionState: plan.recipient.recipientProtectionState,
        channel: 'email',
        steps: plan.steps,
      },
      ctx.correlationId as ReturnType<typeof asCorrelationId>,
      this.newEventId(),
    );

    const campaignSubmitResult = campaign.submitForApproval(
      ctx.correlationId as ReturnType<typeof asCorrelationId>,
      this.newEventId(),
    );
    if (!campaignSubmitResult.success) {
      throw new Error(`Campaign cannot be submitted for approval: ${campaignSubmitResult.error.message}`);
    }

    const campaignApproveResult = campaign.approve(
      asUserId(this.operatorId()),
      'Operator approved Phase 14.8 first real send preparation',
      ctx.correlationId as ReturnType<typeof asCorrelationId>,
      this.newEventId(),
    );
    if (!campaignApproveResult.success) {
      throw new Error(`Campaign cannot be approved: ${campaignApproveResult.error.message}`);
    }

    const campaignStartResult = campaign.start(
      ctx.correlationId as ReturnType<typeof asCorrelationId>,
      this.newEventId(),
    );
    if (!campaignStartResult.success) {
      throw new Error(`Campaign cannot start: ${campaignStartResult.error.message}`);
    }

    await this.config.campaignRepository.save(workspaceCtx, campaign);

    const sequence = OutreachSequence.create(
      {
        id: sequenceId,
        tenantId: ctx.tenantId,
        workspaceId,
        campaignId,
        leadId,
        contactId: contactIdTyped as string,
        recipientFingerprint: plan.recipient.recipientFingerprint,
        recipientCiphertext: plan.recipient.recipientCiphertext,
        recipientProtectionState: plan.recipient.recipientProtectionState,
        steps: plan.steps,
      },
      ctx.correlationId as ReturnType<typeof asCorrelationId>,
      this.newEventId(),
    );

    const submitResult = sequence.submitForApproval(
      ctx.correlationId as ReturnType<typeof asCorrelationId>,
      this.newEventId(),
    );
    if (!submitResult.success) {
      throw new Error(`Sequence cannot be submitted for approval: ${submitResult.error.message}`);
    }

    const approveResult = sequence.approve(
      asUserId(this.operatorId()),
      'Operator approved Phase 14.8 first real send preparation',
      ctx.correlationId as ReturnType<typeof asCorrelationId>,
      this.newEventId(),
    );
    if (!approveResult.success) {
      throw new Error(`Sequence cannot be approved: ${approveResult.error.message}`);
    }

    const sequenceStartResult = sequence.start(
      ctx.correlationId as ReturnType<typeof asCorrelationId>,
      this.newEventId(),
    );
    if (!sequenceStartResult.success) {
      throw new Error(`Sequence cannot start: ${sequenceStartResult.error.message}`);
    }

    await this.config.sequenceRepository.save(workspaceCtx, sequence);

    const startResult = await this.config.lifecycleService.startWorkflow(
      workspaceCtx,
      sequence,
      {
        plan,
        lead,
        evidence: [] as ResearchEvidence[],
        maxIterations: 50,
        replyTimeoutMs: 10 * 60 * 1000,
      },
    );

    const workflowId = startResult.workflowId;

    const execution = await this.waitForExecutionStatus(
      workspaceCtx,
      sequenceId,
      ['PENDING_APPROVAL'],
      this.config.prepareWaitMs ?? DEFAULT_PREPARE_WAIT_MS,
    );

    const result: Phase14RealSendPrepareResult = {
      campaignId: campaignId as string,
      sequenceId: sequenceId as string,
      executionId: execution?.id,
      workflowId,
      status: execution ? 'AWAITING_APPROVAL' : 'AWAITING_APPROVAL_PENDING',
      reason: execution
        ? undefined
        : 'Execution not yet observed. Ensure the outreach Temporal worker is running and retry prepare or inspect the workflow.',
    };

    await this.writeState({
      tenantId,
      workspaceId,
      contactId: contactIdTyped as string,
      recipientFingerprint: recipient.recipientFingerprint,
      recipientCiphertext: recipient.recipientCiphertext,
      recipientProtectionState: recipient.recipientProtectionState,
      campaignId: result.campaignId,
      sequenceId: result.sequenceId,
      workflowId: result.workflowId,
      executionId: result.executionId,
    });

    return result;
  }

  async execute(ctx: TenantContext, sequenceIdInput?: string): Promise<Phase14RealSendExecuteResult> {
    const config = this.config.config;

    if (config.mode !== 'ALLOWLIST_ONLY') {
      throw new Error(
        `OUTREACH_MODE must be 'ALLOWLIST_ONLY' for the first real send, got: ${config.mode ?? 'undefined'}`,
      );
    }

    if (!config.liveEmailEnabled) {
      throw new Error(
        'OUTREACH_LIVE_EMAIL_ENABLED must be true before EXECUTE. Enable it only after PREPARE has succeeded and you are ready to send.',
      );
    }

    validateControlledCommunicationConfig(config);

    const state = await this.readState();
    const sequenceId = sequenceIdInput || state?.sequenceId;
    if (!sequenceId) {
      throw new Error(
        'sequenceId is required. Pass it as an argument or run PREPARE first to create a state file.',
      );
    }

    const typedSequenceId = asSequenceId(sequenceId);
    const workspaceId = state?.workspaceId ?? this.config.workspaceId ?? (ctx.tenantId as string);
    const tenantId = ctx.tenantId as string;
    const workspaceCtx = { ...ctx, workspaceId };
    const sequence = await this.config.sequenceRepository.load(workspaceCtx, typedSequenceId);
    if (!sequence) {
      throw new Error(`Sequence ${sequenceId} not found`);
    }

    if (!state?.recipientCiphertext || !state?.recipientFingerprint) {
      throw new Error('Protected recipient snapshot not available for re-verification');
    }

    let recoveredAddress: string | undefined;
    try {
      recoveredAddress = await this.config.recipientRecovery.recoverEmailForSend(tenantId, state.recipientCiphertext);
    } catch (err) {
      throw new Error('Recipient recovery failed: cannot send without a valid protected snapshot');
    }

    const keyVersion = this.extractKeyVersion(state.recipientFingerprint);
    if (!keyVersion) {
      throw new Error('Invalid recipient fingerprint: cannot determine key version');
    }

    let recomputedFingerprint: string;
    try {
      recomputedFingerprint = await this.config.historicalRecipientFingerprint.fingerprintEmailForVersion(
        tenantId,
        recoveredAddress,
        keyVersion,
      );
    } catch {
      throw new Error('Recipient fingerprint re-computation failed');
    }

    if (Buffer.from(state.recipientFingerprint).length !== Buffer.from(recomputedFingerprint).length) {
      throw new Error('Recipient fingerprint mismatch: recovered address does not match the protected snapshot');
    }
    if (!timingSafeEqual(Buffer.from(state.recipientFingerprint), Buffer.from(recomputedFingerprint))) {
      throw new Error('Recipient fingerprint mismatch: recovered address does not match the protected snapshot');
    }

    await this.ensureAllowlistAndNotSuppressed(workspaceCtx, recoveredAddress);

    const executions = await this.config.executionRepository.findBySequence(workspaceCtx, typedSequenceId);
    const pendingExecution = executions.find(
      (e) => e.status === 'PENDING_APPROVAL' || e.status === 'DRAFTING' || e.status === 'PENDING',
    );
    if (!pendingExecution) {
      throw new Error(
        'No pending execution found for the prepared sequence. Ensure PREPARE succeeded and the workflow is waiting for approval.',
      );
    }

    const confirmed = await this.promptForConfirmation(
      `You are about to send a REAL email to ${recoveredAddress} using sequence ${sequenceId}. ` +
        `Live email is enabled. Type YES to proceed: `,
    );
    if (!confirmed) {
      throw new Error('Execute aborted by operator');
    }

    const executionId = pendingExecution.id;
    const actionType = 'OUTREACH_EMAIL_SEND';

    const approvalId = await this.config.approvalApplicationService.requestApproval(workspaceCtx, {
      missionId: 'phase14-8-first-real-send',
      sequenceId,
      executionId: executionId as string,
      actionType,
      riskCategory: 'LIVE_EMAIL_SEND',
      proposedAction: {
        campaignId: sequence.campaignId,
        sequenceId,
        executionId: executionId as string,
        contactId: state.contactId,
        recipientFingerprint: state.recipientFingerprint,
        channel: 'email',
      },
      evidence: [
        {
          source: 'operator-checklist',
          summary: 'Recipient allowlisted, not suppressed, and operator confirmed live send',
        },
      ],
      reasoning: 'Operator explicitly confirmed Phase 14.8 first real email send',
      confidence: 1,
      requestedBy: this.operatorId(),
      approverRole: 'phase14-operator',
      timeoutSeconds: 300,
      idempotencyKey: asIdempotencyKey(
        `phase14-8-approval:${ctx.tenantId as string}:${sequenceId}:${executionId}`,
      ),
    });

    await this.config.approvalApplicationService.approve(workspaceCtx, {
      approvalId,
      decision: 'APPROVED',
      reason: 'Operator confirmed real email send via phase14:execute-real-send',
      actorId: this.operatorId(),
    });

    const terminalExecution = await this.waitForExecutionStatus(
      workspaceCtx,
      typedSequenceId,
      ['PROVIDER_ACCEPTED', 'DELIVERY_PENDING', 'DELIVERED', 'REPLIED', 'FAILED', 'FAILED_PRE_SUBMISSION', 'DELIVERY_FAILED', 'DELIVERY_UNKNOWN', 'REQUIRES_RECONCILIATION', 'CANCELLED'],
      this.config.executeWaitMs ?? DEFAULT_EXECUTE_WAIT_MS,
    );

    if (!terminalExecution) {
      throw new Error(
        `Timed out waiting for execution ${executionId as string} to reach a terminal status. ` +
          `Inspect the workflow ${WorkflowIdFactory.forOutreachSequence(
            ctx.tenantId as string,
            sequenceId,
          )} in Temporal.`,
      );
    }

    return {
      executionId: terminalExecution.id as string,
      status: terminalExecution.status,
      providerMessageId: terminalExecution.providerMessageId,
      internetMessageId: terminalExecution.internetMessageId as string | undefined,
      nextDueAt: undefined,
    };
  }

  async dispose(): Promise<void> {
    if (this.config.onDispose) {
      await this.config.onDispose();
    }
  }

  private operatorId(): string {
    return this.config.operatorId ?? DEFAULT_OPERATOR_ID;
  }

  private async ensureAllowlistAndNotSuppressed(
    ctx: TenantContext,
    recipientAddress: string,
  ): Promise<void> {
    const allowed = await this.config.allowlistRepository.isAllowed(ctx, 'email', recipientAddress);
    if (!allowed) {
      throw new Error(
        'Recipient is NOT in the allowlist. Add it before running Phase 14.8.',
      );
    }

    const suppressed = await this.config.suppressionRepository.isSuppressed(ctx, recipientAddress);
    if (suppressed) {
      throw new Error(
        `Recipient is on the suppression list (${suppressed.suppressionType}). Cannot proceed.`,
      );
    }
  }

  private async waitForExecutionStatus(
    ctx: TenantContext,
    sequenceId: ReturnType<typeof asSequenceId>,
    statuses: string[],
    timeoutMs: number,
  ) {
    const deadline = Date.now() + timeoutMs;
    const interval = 1000;
    let checkedAtLeastOnce = false;

    while (!checkedAtLeastOnce || Date.now() < deadline) {
      checkedAtLeastOnce = true;
      const executions = await this.config.executionRepository.findBySequence(ctx, sequenceId);
      const match = executions.find((e) => statuses.includes(e.status));
      if (match) {
        return match;
      }
      if (Date.now() >= deadline) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(interval, deadline - Date.now())));
    }

    return undefined;
  }

  private async promptForConfirmation(message: string): Promise<boolean> {
    if (this.config.confirm) {
      return this.config.confirm(message);
    }

    if (!process.stdin.isTTY) {
      throw new Error(
        'This command requires an interactive terminal for confirmation. Set PHASE14_CONFIRM=YES or provide a confirm handler.',
      );
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const answer = await new Promise<string>((resolve) => {
        rl.question(message, resolve);
      });
      return answer.trim().toUpperCase() === 'YES';
    } finally {
      rl.close();
    }
  }

  private async writeState(state: Phase14RealSendState): Promise<void> {
    const filePath = this.config.stateFilePath ?? DEFAULT_STATE_FILE;
    await fs.writeFile(path.resolve(filePath), JSON.stringify(state, null, 2));
  }

  private async readState(): Promise<Phase14RealSendState | null> {
    const filePath = this.config.stateFilePath ?? DEFAULT_STATE_FILE;
    try {
      const raw = await fs.readFile(path.resolve(filePath), 'utf-8');
      return JSON.parse(raw) as Phase14RealSendState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  private extractKeyVersion(fingerprint: string): string | undefined {
    const parts = fingerprint.split('.');
    if (parts.length < 3) return undefined;
    return parts[1];
  }

  private newEventId(): ReturnType<typeof asEventId> {
    return asEventId(`evt-${Date.now()}-${randomUUID().slice(0, 8)}`);
  }
}

interface Phase14RealSendState {
  tenantId: string;
  workspaceId: string;
  contactId: string;
  recipientFingerprint: string;
  recipientCiphertext: string;
  recipientProtectionState: string;
  campaignId: string;
  sequenceId: string;
  workflowId: string;
  executionId?: string;
}

export function createPhase14RealSendOperatorFromEnv(
  overrides?: Partial<Phase14RealSendOperatorConfig>,
): Phase14RealSendOperator {
  const config = loadControlledCommunicationConfig();

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required for the Phase 14.8 real-send operator.');
  }

  const pool = new Pool({ connectionString: config.databaseUrl });

  const isProduction = (): boolean => process.env.NODE_ENV === 'production';
  const secretsProvider: ISecretsProvider = config.azureKeyVaultUrl
    ? new AzureKeyVaultSecretsProvider({ vaultUrl: config.azureKeyVaultUrl })
    : new EnvironmentSecretsProvider();
  if (isProduction() && !config.azureKeyVaultUrl) {
    throw new Error('AZURE_KEY_VAULT_URL is required in production; EnvironmentSecretsProvider is not allowed');
  }

  const campaignRepository = new PostgresCampaignRepository({ pool });
  const sequenceRepository = new PostgresSequenceRepository({ pool });
  const executionRepository = new PostgresMessageExecutionRepository({ pool });
  const allowlistRepository = new PostgresRecipientAllowlistRepository({ pool });
  const suppressionRepository = new PostgresSuppressionRepository({ pool });
  const approvalRepository = new PostgresApprovalRepository({ pool });
  const leadRepository = new PostgresLeadRepository({ pool });

  const workflowClient = new TemporalWorkflowClient({
    address: config.temporalAddress,
    namespace: config.temporalNamespace,
  });

  const lifecycleService = new OutreachSequenceLifecycleService({
    sequenceRepository,
    workflowClient,
    generateExecutionId: () => asOutreachExecutionId(`exec-${Date.now()}-${randomUUID().slice(0, 8)}`),
    generateEventId: () => asEventId(`evt-${Date.now()}-${randomUUID().slice(0, 8)}`),
    taskQueue: 'outreach-execution',
  });

  const approvalApplicationService = new ApprovalApplicationService({
    approvalRepository,
    missionRepository: new PostgresMissionRepository({ pool }),
    workflowClient,
    notificationPort: new NoOpNotificationPort(),
    generateEventId: () => asEventId(`evt-${Date.now()}-${randomUUID().slice(0, 8)}`),
    generateCorrelationId: () => asCorrelationId(`corr-${Date.now()}-${randomUUID().slice(0, 8)}`),
    generateApprovalId: () => `approval-${Date.now()}-${randomUUID().slice(0, 8)}`,
  });

  const recipientSource = new RepositoryOutboundRecipientSource({
    leadRepository,
    contactRepository: new PostgresContactRepository({ pool }),
  });

  const recipientRecovery = new OutboundRecipientRecovery(secretsProvider);
  const historicalRecipientFingerprint = new HistoricalRecipientFingerprint(secretsProvider);

  return new Phase14RealSendOperator({
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
    workspaceId: process.env.PHASE14_WORKSPACE_ID,
    operatorId: process.env.PHASE14_OPERATOR_ID,
    stateFilePath: process.env.PHASE14_STATE_FILE,
    confirm:
      process.env.PHASE14_CONFIRM === 'YES'
        ? async () => true
        : overrides?.confirm,
    onDispose: async () => {
      await pool.end();
    },
    ...overrides,
  });
}

async function run(): Promise<void> {
  const command = process.argv[2];
  const tenantId = process.env.PHASE14_TENANT_ID;
  const recipient = process.env.PHASE14_RECIPIENT_EMAIL;
  const sequenceIdArg = process.argv[3];

  if (!tenantId) {
    throw new Error('PHASE14_TENANT_ID is required');
  }

  const operator = createPhase14RealSendOperatorFromEnv();

  try {
    const ctx: TenantContext = {
      tenantId: asTenantId(tenantId),
      correlationId: asCorrelationId(`phase14-${Date.now()}-${randomUUID().slice(0, 8)}`),
    };

    if (command === 'prepare') {
      if (!recipient) {
        throw new Error('PHASE14_RECIPIENT_EMAIL is required for prepare');
      }

      const result = await operator.prepare(ctx, recipient, recipient);

      console.log('\n=== Phase 14.8 PREPARE complete ===');
      console.log(`tenantId:           ${tenantId}`);
      console.log(`campaignId:         ${result.campaignId}`);
      console.log(`sequenceId:         ${result.sequenceId}`);
      console.log(`executionId:        ${result.executionId ?? '<pending>'}`);
      console.log(`workflowId:         ${result.workflowId}`);
      console.log(`status:             ${result.status}`);
      if (result.reason) {
        console.log(`note:               ${result.reason}`);
      }
      console.log('\nNext: review the draft, confirm allowlist/suppression, then run:');
      console.log('  OUTREACH_LIVE_EMAIL_ENABLED=true pnpm phase14:execute-real-send');
    } else if (command === 'execute') {
      const result = await operator.execute(ctx, sequenceIdArg);

      console.log('\n=== Phase 14.8 EXECUTE complete ===');
      console.log(`executionId:        ${result.executionId}`);
      console.log(`status:             ${result.status}`);
      console.log(`providerMessageId:  ${result.providerMessageId ?? '<not returned>'}`);
      console.log(`internetMessageId:  ${result.internetMessageId ?? '<not returned>'}`);

      console.log('\n*** IMMEDIATE ACTION REQUIRED ***');
      console.log('Set OUTREACH_LIVE_EMAIL_ENABLED=false (or remove it) and restart the worker.');
      console.log('Review the recipient inbox for the test email and any reply.');
    } else {
      console.error('Usage: pnpm phase14:prepare-real-send');
      console.error('       OUTREACH_LIVE_EMAIL_ENABLED=true pnpm phase14:execute-real-send [sequenceId]');
      process.exit(1);
    }
  } finally {
    await operator.dispose();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('\nPhase 14.8 operator failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
