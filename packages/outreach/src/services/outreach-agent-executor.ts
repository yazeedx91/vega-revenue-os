import type { IAgentExecutor } from '@projectx/ai-runtime';
import { OutreachCampaign, OutreachSequence, type Lead, type ResearchEvidence } from '@projectx/domain';

import type {
  AIExecutionRequest,
  AIExecutionResult,
  CampaignId,
  ModelUsage,
  OutreachExecutionId,
  SequenceId,
} from '@projectx/shared';
import { asCampaignId, asCorrelationId, asEventId } from '@projectx/shared';
import type { ICampaignRepository, ISequenceRepository, OutreachRepositoryContext } from '../ports/outreach-repository.interface';
import type { OutreachExecutionService } from '../application/outreach-execution.service';
import type { OutreachPlanningService } from '../application/outreach-planning.service';

export interface OutreachAgentExecutorDependencies {
  planningService: OutreachPlanningService;
  executionService: OutreachExecutionService;
  campaignRepository: ICampaignRepository;
  sequenceRepository: ISequenceRepository;
  generateEventId: () => string;
}

export class OutreachAgentExecutor implements IAgentExecutor {
  constructor(private readonly deps: OutreachAgentExecutorDependencies) {}

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    const startedAt = new Date();
    const modelUsage: ModelUsage = {
      model: 'outreach-kernel',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };

    const workspaceId = request.context.authorization?.workspaceId;
    if (!workspaceId) return this.failed(request, startedAt, modelUsage, 'Trusted workspace authorization context is required');
    const ctx: OutreachRepositoryContext = {
      tenantId: request.tenantId,
      workspaceId,
      correlationId: request.correlationId,
    };

    try {
      switch (request.taskType) {
        case 'plan-outreach':
          return await this.planOutreach(ctx, request, startedAt, modelUsage);
        case 'draft-message':
          return await this.draftMessage(ctx, request, startedAt, modelUsage);
        case 'execute-send':
          return await this.executeSend(ctx, request, startedAt, modelUsage);
        case 'advance-sequence':
          return await this.advanceSequence(ctx, request, startedAt, modelUsage);
        case 'record-response':
          return await this.recordResponse(ctx, request, startedAt, modelUsage);
        default:
          return this.failed(request, startedAt, modelUsage, `Unsupported outreach task type: ${request.taskType}`);
      }
    } catch (error) {
      return this.failed(request, startedAt, modelUsage, error instanceof Error ? error.message : String(error));
    }
  }

  private outcome(summary: string, extra: Record<string, unknown> = {}): AIExecutionResult['outcome'] {
    return {
      summary,
      decisions: [],
      actions: [],
      evidence: [],
      ...extra,
    } as unknown as AIExecutionResult['outcome'];
  }

  private async planOutreach(
    ctx: OutreachRepositoryContext,
    request: AIExecutionRequest,
    startedAt: Date,
    modelUsage: ModelUsage,
  ): Promise<AIExecutionResult> {
    const input = request.context.plan as {
      campaignId?: string;
      lead: Lead;
      evidence: ResearchEvidence[];
      mission?: { channels?: string[] };
    };

    const campaignId = asCampaignId(input.campaignId ?? `campaign-${request.executionId}`);
    const plan = await this.deps.planningService.plan(ctx, {
      campaignId,
      lead: input.lead,
      evidence: input.evidence,
      channels: input.mission?.channels,
    });

    const eventId = this.deps.generateEventId() as unknown as ReturnType<typeof asEventId>;
    const campaign = OutreachCampaign.create(
      {
        id: plan.campaignId,
        tenantId: ctx.tenantId,
        workspaceId: input.lead.workspaceId,
        leadId: plan.leadId,
        contactId: plan.recipient.contactId,
        recipientFingerprint: plan.recipient.recipientFingerprint,
        recipientProtectionState: plan.recipient.recipientProtectionState,
        channel: plan.channel,
        steps: plan.steps,
        missionId: request.missionId,
      },
      request.correlationId,
      eventId,
    );

    const sequence = OutreachSequence.create(
      {
        id: plan.sequenceId,
        tenantId: ctx.tenantId,
        workspaceId: input.lead.workspaceId,
        campaignId: campaign.id,
        leadId: plan.leadId,
        contactId: plan.recipient.contactId,
        recipientFingerprint: plan.recipient.recipientFingerprint,
        recipientCiphertext: plan.recipient.recipientCiphertext,
        recipientProtectionState: plan.recipient.recipientProtectionState,
        campaignRecipientFingerprint: campaign.recipientFingerprint,
        steps: plan.steps,
      },
      request.correlationId,
      eventId,
    );

    await this.deps.campaignRepository.save(ctx, campaign);
    await this.deps.sequenceRepository.save(ctx, sequence);

    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: 'COMPLETED',
      outcome: this.outcome('Outreach campaign and sequence created', {
        campaignId: campaign.id,
        sequenceId: sequence.id,
        plan,
      }),
      modelUsage,
      startedAt,
      completedAt: new Date(),
      correlationId: request.correlationId,
      events: ['OutreachPlanned'],
    };
  }

  private async draftMessage(
    ctx: OutreachRepositoryContext,
    request: AIExecutionRequest,
    startedAt: Date,
    modelUsage: ModelUsage,
  ): Promise<AIExecutionResult> {
    const input = request.context.plan as {
      sequenceId: SequenceId;
      plan: import('@projectx/domain').OutreachPlan;
      lead: Lead;
      evidence: ResearchEvidence[];
    };

    const result = await this.deps.executionService.prepareDraft(
      ctx,
      input.sequenceId as string,
      input.plan,
      input.lead,
      input.evidence,
    );

    if (result.status === 'FAILED') {
      return this.failed(request, startedAt, modelUsage, result.reason);
    }

    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: 'AWAITING_APPROVAL',
      outcome: this.outcome('Outreach message draft created and awaiting approval', {
        executionId: result.executionId,
        actionType: result.actionType,
      }),
      modelUsage,
      startedAt,
      completedAt: new Date(),
      correlationId: request.correlationId,
      events: ['OutreachDraftAwaitingApproval'],
    };
  }

  private async executeSend(
    ctx: OutreachRepositoryContext,
    request: AIExecutionRequest,
    startedAt: Date,
    modelUsage: ModelUsage,
  ): Promise<AIExecutionResult> {
    const input = request.context.target as {
      executionId: OutreachExecutionId;
      approvalId: string;
    };

    const result = await this.deps.executionService.executeApprovedSend(
      ctx,
      input.executionId,
      input.approvalId as unknown as import('@projectx/shared').ApprovalId,
    );

    if (result.status === 'FAILED') {
      return this.failed(request, startedAt, modelUsage, result.reason);
    }

    if (result.status === 'RETRYABLE') {
      return {
        executionId: request.executionId,
        tenantId: request.tenantId,
        missionId: request.missionId,
        status: 'FAILED',
        outcome: this.outcome(`Provider send retryable: ${result.retryAfterMs ?? 'unknown'}ms`, {
          executionId: result.executionId,
          retryAfterMs: result.retryAfterMs,
        }),
        modelUsage,
        startedAt,
        completedAt: new Date(),
        correlationId: request.correlationId,
        events: ['OutreachSendRetryable'],
      };
    }

    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: 'COMPLETED',
      outcome: this.outcome('Outreach send completed', {
        executionId: result.executionId,
        nextDueAt: result.nextDueAt,
      }),
      modelUsage,
      startedAt,
      completedAt: new Date(),
      correlationId: request.correlationId,
      events: ['OutreachSendCompleted'],
    };
  }

  private async advanceSequence(
    ctx: OutreachRepositoryContext,
    request: AIExecutionRequest,
    startedAt: Date,
    modelUsage: ModelUsage,
  ): Promise<AIExecutionResult> {
    const input = request.context.target as { sequenceId: SequenceId };
    const sequence = await this.deps.sequenceRepository.load(ctx, input.sequenceId as unknown as SequenceId);
    if (!sequence) {
      return this.failed(request, startedAt, modelUsage, 'Sequence not found');
    }

    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: 'COMPLETED',
      outcome: this.outcome(`Sequence advanced to step ${sequence.currentStepIndex + 1}`, {
        sequenceId: sequence.id,
        currentStepIndex: sequence.currentStepIndex,
        nextDueAt: sequence.nextDueAt,
      }),
      modelUsage,
      startedAt,
      completedAt: new Date(),
      correlationId: request.correlationId,
      events: ['SequenceAdvanced'],
    };
  }

  private async recordResponse(
    ctx: OutreachRepositoryContext,
    request: AIExecutionRequest,
    startedAt: Date,
    modelUsage: ModelUsage,
  ): Promise<AIExecutionResult> {
    const input = request.context.target as { executionId: OutreachExecutionId; responseType: 'OPENED' | 'REPLIED' };
    await this.deps.executionService.recordResponse(ctx, input.executionId, input.responseType);

    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: 'COMPLETED',
      outcome: this.outcome(`Provider response recorded: ${input.responseType}`, {
        executionId: input.executionId,
        responseType: input.responseType,
      }),
      modelUsage,
      startedAt,
      completedAt: new Date(),
      correlationId: request.correlationId,
      events: ['OutreachResponseRecorded'],
    };
  }

  private failed(
    request: AIExecutionRequest,
    startedAt: Date,
    modelUsage: ModelUsage,
    reason: string,
  ): AIExecutionResult {
    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: 'FAILED',
      outcome: this.outcome(reason),
      modelUsage,
      startedAt,
      completedAt: new Date(),
      correlationId: request.correlationId,
      events: [],
    };
  }
}
