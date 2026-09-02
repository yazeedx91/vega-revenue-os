import {
  ensureSameTenant,
  OutreachMessageExecution,
  type Lead,
  type MessageExecutionStatus,
  type OutreachCampaign,
  type OutreachMessageExecution as OutreachMessageExecutionType,
  type OutreachSequence,
  type OutreachChannel,
  type OutreachPlan,
  type ResearchEvidence,
  type SequenceStep,
} from '@projectx/domain';
import type { TenantContext } from '@projectx/domain';
import { asIdempotencyKey, asOutreachMessageId, type ApprovalId, type CorrelationId, type EventId, type OutreachExecutionId, type SequenceId } from '@projectx/shared';
import { ConcurrencyConflictError, type IIdempotencyStore } from '@projectx/infrastructure';
import type { IOutreachProviderRegistry } from '../ports/outreach-provider-registry.interface';
import type { ICampaignRepository, IMessageExecutionRepository, ISequenceRepository } from '../ports/outreach-repository.interface';
import type { ISequenceSchedulePolicy } from '../ports/sequence-schedule-policy.interface';
import type { SendSafetyGate } from '../safety/send-safety-gate';
import type { OutreachPersonalizationService } from './outreach-personalization.service';

const IDEMPOTENCY_SCOPE = 'outreach:send';

export interface OutreachExecutionServiceDependencies {
  campaignRepository: ICampaignRepository;
  sequenceRepository: ISequenceRepository;
  executionRepository: IMessageExecutionRepository;
  providerRegistry: IOutreachProviderRegistry;
  schedulePolicy: ISequenceSchedulePolicy;
  personalizationService: OutreachPersonalizationService;
  safetyGate: SendSafetyGate;
  idempotencyStore?: IIdempotencyStore;
  generateExecutionId: () => string;
  generateEventId: () => EventId;
  channelCostEstimate: (channel: OutreachChannel) => number;
}

export type PrepareDraftResult =
  | { status: 'AWAITING_APPROVAL'; executionId: OutreachExecutionId; actionType: string }
  | { status: 'FAILED'; reason: string };

export type ExecuteSendResult =
  | { status: 'COMPLETED'; executionId: OutreachExecutionId; nextDueAt?: Date }
  | { status: 'RETRYABLE'; executionId: OutreachExecutionId; retryAfterMs?: number }
  | { status: 'FAILED'; executionId: OutreachExecutionId; reason: string };

export class OutreachExecutionService {
  constructor(private readonly deps: OutreachExecutionServiceDependencies) {}

  async prepareDraft(
    ctx: TenantContext,
    sequenceId: string,
    plan: OutreachPlan,
    lead: Lead,
    evidence: ResearchEvidence[],
  ): Promise<PrepareDraftResult> {
    const sequence = await this.deps.sequenceRepository.load(ctx, sequenceId as unknown as SequenceId);
    if (!sequence) return { status: 'FAILED', reason: 'Sequence not found' };
    ensureSameTenant(ctx, sequence.tenantId);

    const campaign = await this.deps.campaignRepository.load(ctx, sequence.campaignId);
    if (!campaign) return { status: 'FAILED', reason: 'Campaign not found' };

    const step = sequence.steps[sequence.currentStepIndex];
    if (!step) return { status: 'FAILED', reason: 'No current step' };

    const idempotencyKey = this.makeSendIdempotencyKey(ctx, campaign, sequence, step);
    const existing = await this.deps.executionRepository.findByIdempotencyKey(ctx, idempotencyKey as string);
    if (existing) {
      return {
        status: 'AWAITING_APPROVAL',
        executionId: existing.id,
        actionType: actionTypeForChannel(step.channel),
      };
    }

    const execution = OutreachMessageExecution.create(
      {
        tenantId: ctx.tenantId,
        campaignId: campaign.id,
        sequenceId: sequence.id,
        stepNumber: step.stepNumber,
        leadId: sequence.leadId as string,
        recipientAddress: sequence.recipient.address,
        channel: step.channel,
        idempotencyKey: asIdempotencyKey(idempotencyKey),
      },
      ctx.correlationId as CorrelationId,
      this.deps.generateEventId(),
    );
    execution.startDrafting(ctx.correlationId as CorrelationId, this.deps.generateEventId());

    const personalization = await this.deps.personalizationService.personalize(ctx, plan, lead, evidence);
    if (!personalization.success) {
      execution.reject(`Personalization failed: ${personalization.error.message}`, ctx.correlationId as CorrelationId, this.deps.generateEventId());
      await this.deps.executionRepository.save(ctx, execution);
      return { status: 'FAILED', reason: personalization.error.message };
    }

    const draftResult = execution.setDraft(
      personalization.value.messageId,
      personalization.value.draft,
      ctx.correlationId as CorrelationId,
      this.deps.generateEventId(),
    );
    if (!draftResult.success) {
      return { status: 'FAILED', reason: draftResult.error.message };
    }

    await this.deps.executionRepository.save(ctx, execution);
    return {
      status: 'AWAITING_APPROVAL',
      executionId: execution.id,
      actionType: actionTypeForChannel(step.channel),
    };
  }

  async executeApprovedSend(
    ctx: TenantContext,
    executionId: OutreachExecutionId,
    approvalId: ApprovalId,
  ): Promise<ExecuteSendResult> {
    try {
      return await this.doExecuteApprovedSend(ctx, executionId, approvalId);
    } catch (err) {
      if (err instanceof ConcurrencyConflictError) {
        return this.resolveFromAuthoritativeState(ctx, executionId);
      }
      throw err;
    }
  }

  private async resolveFromAuthoritativeState(
    ctx: TenantContext,
    executionId: OutreachExecutionId,
  ): Promise<ExecuteSendResult> {
    const execution = await this.deps.executionRepository.load(ctx, executionId);
    if (!execution) {
      return { status: 'FAILED', executionId, reason: 'Execution not found after concurrency conflict' };
    }
    try {
      return await this.handleDuplicateSendIdempotency(ctx, execution, executionId);
    } catch (err) {
      if (err instanceof ConcurrencyConflictError) {
        return { status: 'FAILED', executionId, reason: 'Concurrent execution conflict persisted after reload' };
      }
      throw err;
    }
  }

  private async doExecuteApprovedSend(
    ctx: TenantContext,
    executionId: OutreachExecutionId,
    approvalId: ApprovalId,
  ): Promise<ExecuteSendResult> {
    const execution = await this.deps.executionRepository.load(ctx, executionId);
    if (!execution) {
      return { status: 'FAILED', executionId, reason: 'Execution not found' };
    }
    ensureSameTenant(ctx, execution.tenantId);

    const sequence = await this.deps.sequenceRepository.load(ctx, execution.sequenceId);
    if (!sequence) {
      return { status: 'FAILED', executionId, reason: 'Sequence not found' };
    }
    ensureSameTenant(ctx, sequence.tenantId);

    const campaign = await this.deps.campaignRepository.load(ctx, execution.campaignId);
    if (!campaign) {
      return { status: 'FAILED', executionId, reason: 'Campaign not found' };
    }
    ensureSameTenant(ctx, campaign.tenantId);

    // Terminal / already-submitted states: never contact the provider again.
    if (
      execution.status === 'PROVIDER_ACCEPTED' ||
      execution.status === 'DELIVERY_PENDING' ||
      execution.status === 'DELIVERED' ||
      execution.status === 'OPENED' ||
      execution.status === 'REPLIED'
    ) {
      return { status: 'COMPLETED', executionId };
    }

    const terminalFailureStates: Array<OutreachMessageExecutionType['status']> = [
      'FAILED_PRE_SUBMISSION',
      'DELIVERY_FAILED',
      'DELIVERY_UNKNOWN',
      'REQUIRES_RECONCILIATION',
      'FAILED',
      'CANCELLED',
      'BOUNCED',
    ];
    if (terminalFailureStates.includes(execution.status)) {
      return { status: 'FAILED', executionId, reason: execution.lastError ?? `Execution is ${execution.status}` };
    }

    if (execution.status === 'PENDING_APPROVAL') {
      const approveResult = execution.approve(approvalId, ctx.correlationId as CorrelationId, this.deps.generateEventId());
      if (!approveResult.success) {
        return { status: 'FAILED', executionId, reason: approveResult.error.message };
      }
    }

    if (execution.status === 'APPROVED') {
      const sendingResult = execution.markSending(ctx.correlationId as CorrelationId, this.deps.generateEventId());
      if (!sendingResult.success) {
        return { status: 'FAILED', executionId, reason: sendingResult.error.message };
      }
    }

    if (execution.status !== 'SENDING') {
      return { status: 'FAILED', executionId, reason: `Execution not ready to send: ${execution.status}` };
    }

    const step = sequence.steps.find((s) => s.stepNumber === execution.stepNumber);
    if (!step) {
      return { status: 'FAILED', executionId, reason: 'Step not found' };
    }

    const estimatedCost = this.deps.channelCostEstimate(step.channel);

    // Single authoritative pre-send safety decision — tenant, allowlist,
    // suppression, independently re-verified approval, rate limit, budget,
    // idempotency, and content checks. The safety gate performs the atomic
    // idempotency claim() as its final check, so we must never call claim()
    // again here. A DUPLICATE_DENY from the gate means a prior in-flight or
    // completed send exists; inspect the record to recover completed sends or
    // fail closed on stale PENDING records without contacting the provider.
    const safetyDecision = await this.deps.safetyGate.evaluate({
      ctx,
      campaign,
      execution,
      approvalId: approvalId as unknown as string,
      actionType: actionTypeForChannel(step.channel),
      estimatedCostUsd: estimatedCost,
    });

    if (safetyDecision.decision === 'DENY') {
      if (safetyDecision.code === 'DUPLICATE_SEND') {
        return this.handleDuplicateSendIdempotency(ctx, execution, executionId);
      }
      execution.markFailed(
        'NON_RETRYABLE',
        `Safety gate denied: ${safetyDecision.reason}`,
        safetyDecision.code,
        ctx.correlationId as CorrelationId,
        this.deps.generateEventId(),
      );
      await this.deps.executionRepository.save(ctx, execution);
      await this.markIdempotencyFailed(ctx, execution, false);
      return { status: 'FAILED', executionId, reason: safetyDecision.reason };
    }

    if (safetyDecision.decision === 'RETRYABLE') {
      execution.markFailed(
        'RATE_LIMITED',
        safetyDecision.reason,
        undefined,
        ctx.correlationId as CorrelationId,
        this.deps.generateEventId(),
      );
      await this.deps.executionRepository.save(ctx, execution);
      await this.markIdempotencyFailed(ctx, execution, false);
      return { status: 'RETRYABLE', executionId, retryAfterMs: safetyDecision.retryAfterMs };
    }

    const provider = await this.deps.providerRegistry.select(ctx, step.channel);
    if (!provider) {
      execution.markFailed(
        'NON_RETRYABLE',
        'No provider available for channel',
        'NO_PROVIDER',
        ctx.correlationId as CorrelationId,
        this.deps.generateEventId(),
      );
      await this.deps.executionRepository.save(ctx, execution);
      await this.markIdempotencyFailed(ctx, execution, false);
      return { status: 'FAILED', executionId, reason: 'No provider available' };
    }

    execution.markProviderAttempt(provider.providerId);
    await this.deps.executionRepository.save(ctx, execution);

    const result = await provider.send(ctx, {
      idempotencyKey: execution.idempotencyKey,
      correlationId: ctx.correlationId as CorrelationId,
      executionId: execution.id,
      tenantId: ctx.tenantId,
      campaignId: campaign.id,
      sequenceId: execution.sequenceId,
      messageId: execution.messageId ?? (execution.id as unknown as ReturnType<typeof asOutreachMessageId>),
      recipientAddress: execution.recipientAddress,
      subject: execution.draft?.subject,
      body: execution.draft?.body ?? '',
      cta: execution.draft?.cta,
      channel: step.channel,
    });

    campaign.spentCostUsd += result.costUsd - estimatedCost;

    if (result.status === 'PROVIDER_ACCEPTED' || result.status === 'ACCEPTED' || result.status === 'DELIVERED') {
      const acceptResult = execution.markProviderAccepted(
        result.providerMessageId,
        result.internetMessageId,
        result.providerErrorCode,
        ctx.correlationId as CorrelationId,
        this.deps.generateEventId(),
      );
      if (!acceptResult.success) {
        return { status: 'FAILED', executionId, reason: acceptResult.error.message };
      }
      execution.markDeliveryPending(ctx.correlationId as CorrelationId, this.deps.generateEventId());
      await this.deps.executionRepository.save(ctx, execution);
      await this.deps.campaignRepository.save(ctx, campaign);
      await this.markIdempotencyCompleted(ctx, execution, {
        providerMessageId: result.providerMessageId,
        internetMessageId: result.internetMessageId,
      });
      return this.advanceSequence(ctx, sequence, execution);
    }

    if (result.status === 'FAILED') {
      const classification = result.retryClassification ?? 'NON_RETRYABLE';
      execution.markFailed(
        classification,
        result.providerErrorMessage ?? 'Provider reported failure',
        result.providerErrorCode,
        ctx.correlationId as CorrelationId,
        this.deps.generateEventId(),
      );
      await this.deps.executionRepository.save(ctx, execution);
      if (classification === 'RETRYABLE' || classification === 'RATE_LIMITED') {
        await this.markIdempotencyFailed(ctx, execution, false);
        return { status: 'RETRYABLE', executionId, retryAfterMs: result.retryAfterMs };
      }
      await this.markIdempotencyFailed(ctx, execution, false);
      return { status: 'FAILED', executionId, reason: result.providerErrorMessage ?? 'Provider failure' };
    }

    if (result.status === 'RATE_LIMITED') {
      execution.markFailed(
        'RATE_LIMITED',
        'Rate limited',
        result.providerErrorCode,
        ctx.correlationId as CorrelationId,
        this.deps.generateEventId(),
      );
      await this.deps.executionRepository.save(ctx, execution);
      await this.markIdempotencyFailed(ctx, execution, false);
      return { status: 'RETRYABLE', executionId, retryAfterMs: result.retryAfterMs ?? 60000 };
    }

    if (result.status === 'AMBIGUOUS') {
      execution.markDeliveryUnknown(
        result.providerErrorMessage ?? 'Provider submission outcome is ambiguous',
        ctx.correlationId as CorrelationId,
        this.deps.generateEventId(),
      );
      await this.deps.executionRepository.save(ctx, execution);
      // Do NOT update the idempotency record: leave it PENDING so no future
      // caller can blindly reclaim and resend.
      return {
        status: 'FAILED',
        executionId,
        reason: result.providerErrorMessage ?? 'Provider submission outcome is ambiguous; reconciliation required',
      };
    }

    await this.markIdempotencyFailed(ctx, execution, false);
    return { status: 'FAILED', executionId, reason: `Unknown provider status ${result.status}` };
  }

  async recordResponse(
    ctx: TenantContext,
    executionId: OutreachExecutionId,
    responseType: 'OPENED' | 'REPLIED',
  ): Promise<void> {
    const execution = await this.deps.executionRepository.load(ctx, executionId);
    if (!execution) return;
    ensureSameTenant(ctx, execution.tenantId);

    if (execution.status === 'PROVIDER_ACCEPTED' || execution.status === 'DELIVERY_PENDING') {
      execution.markDelivered(undefined, ctx.correlationId as CorrelationId, this.deps.generateEventId());
    }
    if (execution.status === 'DELIVERED') {
      execution.markOpened(ctx.correlationId as CorrelationId, this.deps.generateEventId());
    }
    if (responseType === 'REPLIED') {
      execution.markReplied(ctx.correlationId as CorrelationId, this.deps.generateEventId());
    }
    await this.deps.executionRepository.save(ctx, execution);
  }

  private async advanceSequence(
    ctx: TenantContext,
    sequence: OutreachSequence,
    execution: OutreachMessageExecutionType,
  ): Promise<ExecuteSendResult> {
    const hasMoreSteps = sequence.currentStepIndex + 1 < sequence.steps.length;
    const nextDueAt = hasMoreSteps
      ? this.deps.schedulePolicy.computeNextDueAt(
          new Date(),
          sequence.steps[sequence.currentStepIndex + 1].delayMs,
        )
      : undefined;

    const campaign = await this.deps.campaignRepository.load(ctx, sequence.campaignId);
    const completeResult = sequence.completeStep(
      execution.id,
      nextDueAt,
      ctx.correlationId as CorrelationId,
      this.deps.generateEventId(),
    );
    if (!completeResult.success) {
      return { status: 'FAILED', executionId: execution.id, reason: completeResult.error.message };
    }
    await this.deps.sequenceRepository.save(ctx, sequence);

    if (!hasMoreSteps && campaign) {
      campaign.complete(ctx.correlationId as CorrelationId, this.deps.generateEventId());
      await this.deps.campaignRepository.save(ctx, campaign);
    }

    return { status: 'COMPLETED', executionId: execution.id, nextDueAt };
  }

  private isTerminalFailure(status: MessageExecutionStatus): boolean {
    return [
      'FAILED_PRE_SUBMISSION',
      'DELIVERY_FAILED',
      'DELIVERY_UNKNOWN',
      'REQUIRES_RECONCILIATION',
      'FAILED',
      'CANCELLED',
      'BOUNCED',
    ].includes(status);
  }

  private async markIdempotencyCompleted(
    ctx: TenantContext,
    execution: OutreachMessageExecutionType,
    result: { providerMessageId?: string; internetMessageId?: string },
  ): Promise<void> {
    if (this.deps.idempotencyStore) {
      await this.deps.idempotencyStore.set(
        ctx,
        IDEMPOTENCY_SCOPE,
        execution.idempotencyKey,
        { submitted: true, providerMessageId: result.providerMessageId, internetMessageId: result.internetMessageId },
        { status: 'COMPLETED' },
      );
    }
  }

  private async markIdempotencyFailed(
    ctx: TenantContext,
    execution: OutreachMessageExecutionType,
    submitted: boolean,
    reason?: string,
  ): Promise<void> {
    if (this.deps.idempotencyStore) {
      await this.deps.idempotencyStore.set(
        ctx,
        IDEMPOTENCY_SCOPE,
        execution.idempotencyKey,
        { submitted, reason },
        { status: 'FAILED' },
      );
    }
  }

  private async handleDuplicateSendIdempotency(
    ctx: TenantContext,
    execution: OutreachMessageExecutionType,
    executionId: OutreachExecutionId,
  ): Promise<ExecuteSendResult> {
    const existing = await this.deps.idempotencyStore?.get<{
      submitted?: boolean;
      providerMessageId?: string;
      internetMessageId?: string;
      reason?: string;
    }>(ctx, IDEMPOTENCY_SCOPE, execution.idempotencyKey);

    if (existing?.status === 'COMPLETED') {
      // A COMPLETED idempotency record means the provider accepted the send in
      // a prior attempt. Recover the execution to a terminal success state and
      // never contact the provider again.
      if (!this.isTerminalFailure(execution.status)) {
        const acceptResult = execution.markProviderAccepted(
          existing.result?.providerMessageId,
          existing.result?.internetMessageId,
          undefined,
          ctx.correlationId as CorrelationId,
          this.deps.generateEventId(),
        );
        if (acceptResult.success) {
          execution.markDeliveryPending(ctx.correlationId as CorrelationId, this.deps.generateEventId());
        }
        await this.deps.executionRepository.save(ctx, execution);
      }
      return { status: 'COMPLETED', executionId };
    }

    if (existing?.status === 'PENDING') {
      execution.markDeliveryUnknown(
        'Prior submission attempt still in flight at provider; outcome unknown',
        ctx.correlationId as CorrelationId,
        this.deps.generateEventId(),
      );
      await this.deps.executionRepository.save(ctx, execution);
      return {
        status: 'FAILED',
        executionId,
        reason: 'Delivery outcome unknown after prior attempt; reconciliation required',
      };
    }

    execution.markRequiresReconciliation(
      existing?.result?.reason ?? 'Idempotency record exists but does not prove the submission was not sent',
      ctx.correlationId as CorrelationId,
      this.deps.generateEventId(),
    );
    await this.deps.executionRepository.save(ctx, execution);
    return { status: 'FAILED', executionId, reason: 'Reconciliation required before retry' };
  }

  private makeSendIdempotencyKey(
    ctx: TenantContext,
    campaign: OutreachCampaign,
    sequence: OutreachSequence,
    step: SequenceStep,
  ): string {
    return `outreach:${ctx.tenantId}:${campaign.id}:${sequence.id}:${step.stepNumber}:${sequence.recipient.address}:${step.channel}`;
  }
}

function actionTypeForChannel(channel: OutreachChannel): string {
  if (channel === 'email') return 'OUTREACH_EMAIL_SEND';
  if (channel === 'linkedin') return 'OUTREACH_LINKEDIN_SEND';
  return 'OUTREACH_CALENDAR_CREATE';
}
