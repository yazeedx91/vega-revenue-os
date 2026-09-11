import { timingSafeEqual } from 'node:crypto';
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

import { asIdempotencyKey, asOutreachMessageId, type ApprovalId, type CorrelationId, type EventId, type OutreachExecutionId, type SequenceId } from '@projectx/shared';
import { ConcurrencyConflictError, type IIdempotencyStore } from '@projectx/infrastructure';
import type { IOutreachProviderRegistry } from '../ports/outreach-provider-registry.interface';
import type { ICampaignRepository, IMessageExecutionRepository, ISequenceRepository, OutreachRepositoryContext } from '../ports/outreach-repository.interface';
import type { ISequenceSchedulePolicy } from '../ports/sequence-schedule-policy.interface';
import type { SendSafetyGate } from '../safety/send-safety-gate';
import type { IHistoricalRecipientFingerprint, IOutboundRecipientRecovery } from '../ports/outbound-recipient-recovery.interface';
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
  recipientRecovery: IOutboundRecipientRecovery;
  historicalRecipientFingerprint: IHistoricalRecipientFingerprint;
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
    ctx: OutreachRepositoryContext,
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
        workspaceId: sequence.workspaceId,
        campaignId: campaign.id,
        sequenceId: sequence.id,
        stepNumber: step.stepNumber,
        leadId: sequence.leadId as string,
        contactId: sequence.contactId,
        recipientFingerprint: sequence.recipientFingerprint,
        recipientCiphertext: sequence.recipientCiphertext,
        recipientProtectionState: sequence.recipientProtectionState,
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
    ctx: OutreachRepositoryContext,
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
    ctx: OutreachRepositoryContext,
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
    ctx: OutreachRepositoryContext,
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

    let recipientAddress: string;
    try {
      recipientAddress = await this.recoverAndVerifyRecipient(execution);
    } catch {
      return { status: 'FAILED', executionId, reason: 'Protected recipient recovery failed' };
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
      recipientAddress,
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
      recipientAddress,
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
    ctx: OutreachRepositoryContext,
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
    ctx: OutreachRepositoryContext,
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
    ctx: OutreachRepositoryContext,
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
    ctx: OutreachRepositoryContext,
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
    ctx: OutreachRepositoryContext,
    localExecution: OutreachMessageExecutionType,
    executionId: OutreachExecutionId,
  ): Promise<ExecuteSendResult> {
    // The loser must never make decisions on a stale in-memory snapshot. It has
    // to reread the authoritative idempotency record and execution aggregate
    // before resolving the duplicate-send race.
    const existing = await this.deps.idempotencyStore?.get<{
      submitted?: boolean;
      providerMessageId?: string;
      internetMessageId?: string;
      reason?: string;
    }>(ctx, IDEMPOTENCY_SCOPE, localExecution.idempotencyKey);
    const reloaded = await this.deps.executionRepository.load(ctx, executionId);

    if (!reloaded) {
      return { status: 'FAILED', executionId, reason: 'Execution not found after duplicate send' };
    }

    if (existing?.status === 'COMPLETED') {
      // A COMPLETED idempotency record means a prior provider submission was
      // accepted. Reconcile the execution to a terminal success state only if
      // it has not already advanced, and never overwrite a newer winner state.
      if (this.shouldRecoverToDeliveryPending(reloaded.status)) {
        this.advanceToDeliveryPending(
          reloaded,
          existing.result?.providerMessageId,
          existing.result?.internetMessageId,
          ctx.correlationId as CorrelationId,
          this.deps.generateEventId(),
        );
        await this.saveAuthoritative(ctx, reloaded, executionId);
      }
      return this.resultFromExecution(reloaded, executionId);
    }

    if (existing?.status === 'PENDING') {
      const isExpired = this.isExpiredIdempotency(existing);
      const inFlightStatus = reloaded.status === 'SENDING' || reloaded.status === 'APPROVED';
      const attemptedSubmission = reloaded.attempts > 0 || reloaded.providerId !== undefined;

      // If the execution has already advanced past the submission point, the
      // authoritative execution state wins regardless of the idempotency record.
      if (this.isPositiveTerminal(reloaded.status)) {
        return this.resultFromExecution(reloaded, executionId);
      }

      // A live PENDING idempotency record means another worker may still own the
      // send. Do not resend, do not persist DELIVERY_UNKNOWN, and do not mutate
      // a concurrent newer execution state.
      if (!isExpired) {
        return { status: 'FAILED', executionId, reason: 'Delivery outcome unknown after prior attempt; reconciliation required' };
      }

      // A stale (expired) PENDING claim does NOT, by itself, prove a submission
      // occurred. Only persist DELIVERY_UNKNOWN when the authoritative execution
      // itself shows that a provider submission was attempted and the outcome is
      // genuinely ambiguous.
      if (inFlightStatus && attemptedSubmission) {
        reloaded.markDeliveryUnknown(
          'Prior submission attempt reached the provider before the idempotency claim expired; outcome unknown',
          ctx.correlationId as CorrelationId,
          this.deps.generateEventId(),
        );
        await this.saveAuthoritative(ctx, reloaded, executionId);
      }

      return this.resultFromExecution(reloaded, executionId);
    }

    if (existing?.status === 'FAILED' && existing.result?.submitted === false) {
      // A FAILED idempotency record that provably had no submission can only
      // be safely reclaimed through the atomic safety-gate claim(). If the gate
      // denied us, we must not resend from this duplicate path.
      if (this.isTerminalFailure(reloaded.status) || this.isPositiveTerminal(reloaded.status)) {
        return this.resultFromExecution(reloaded, executionId);
      }
      reloaded.markRequiresReconciliation(
        existing.result?.reason ?? 'Idempotency record exists but does not prove the submission was not sent',
        ctx.correlationId as CorrelationId,
        this.deps.generateEventId(),
      );
      await this.saveAuthoritative(ctx, reloaded, executionId);
      return this.resultFromExecution(reloaded, executionId);
    }

    if (this.isTerminalFailure(reloaded.status) || this.isPositiveTerminal(reloaded.status)) {
      return this.resultFromExecution(reloaded, executionId);
    }
    reloaded.markRequiresReconciliation(
      existing?.result?.reason ?? 'Idempotency record exists but does not prove the submission was not sent',
      ctx.correlationId as CorrelationId,
      this.deps.generateEventId(),
    );
    await this.saveAuthoritative(ctx, reloaded, executionId);
    return this.resultFromExecution(reloaded, executionId);
  }

  private shouldRecoverToDeliveryPending(status: MessageExecutionStatus): boolean {
    return !this.isPositiveTerminal(status) && !this.isTerminalFailure(status) && status !== 'DELIVERY_UNKNOWN' && status !== 'REQUIRES_RECONCILIATION';
  }

  private isPositiveTerminal(status: MessageExecutionStatus): boolean {
    return ['PROVIDER_ACCEPTED', 'DELIVERY_PENDING', 'DELIVERED', 'OPENED', 'REPLIED'].includes(status);
  }

  private isExpiredIdempotency(record: { expiresAt?: Date }): boolean {
    return record.expiresAt !== undefined && record.expiresAt.getTime() <= Date.now();
  }

  private hasSubmissionAttempt(execution: OutreachMessageExecutionType): boolean {
    return execution.attempts > 0 || execution.providerId !== undefined;
  }

  private advanceToDeliveryPending(
    execution: OutreachMessageExecutionType,
    providerMessageId: string | undefined,
    internetMessageId: string | undefined,
    correlationId: CorrelationId,
    eventId: EventId,
  ): void {
    if (execution.status === 'APPROVED') {
      execution.markSending(correlationId, eventId);
    }
    if (execution.status === 'SENDING') {
      execution.markProviderAccepted(providerMessageId, internetMessageId, undefined, correlationId, eventId);
    }
    if (execution.status === 'PROVIDER_ACCEPTED') {
      execution.markDeliveryPending(correlationId, eventId);
    }
  }

  private async saveAuthoritative(
    ctx: OutreachRepositoryContext,
    execution: OutreachMessageExecutionType,
    executionId: OutreachExecutionId,
  ): Promise<OutreachMessageExecutionType> {
    try {
      await this.deps.executionRepository.save(ctx, execution);
      return execution;
    } catch (err) {
      if (err instanceof ConcurrencyConflictError) {
        const newer = await this.deps.executionRepository.load(ctx, executionId);
        return newer ?? execution;
      }
      throw err;
    }
  }

  private resultFromExecution(execution: OutreachMessageExecutionType | null, executionId: OutreachExecutionId): ExecuteSendResult {
    if (!execution) {
      return { status: 'FAILED', executionId, reason: 'Execution not found' };
    }
    if (this.isPositiveTerminal(execution.status)) {
      return { status: 'COMPLETED', executionId };
    }
    if (execution.status === 'SENDING' || execution.status === 'APPROVED') {
      return { status: 'FAILED', executionId, reason: execution.lastError ?? 'Delivery outcome unknown after prior attempt; reconciliation required' };
    }
    if (execution.status === 'REQUIRES_RECONCILIATION') {
      return { status: 'FAILED', executionId, reason: 'Reconciliation required before retry' };
    }
    return { status: 'FAILED', executionId, reason: execution.lastError ?? `Execution is ${execution.status}` };
  }

  private async recoverAndVerifyRecipient(execution: OutreachMessageExecutionType): Promise<string> {
    if (execution.recipientProtectionState !== 'PROTECTED' || !execution.recipientCiphertext || !execution.recipientFingerprint) {
      throw new Error('Protected recipient is unavailable');
    }
    const parts = execution.recipientFingerprint.split('.');
    if (parts.length !== 3 || parts[0] !== 'h1' || !/^[A-Za-z0-9_-]{1,64}$/.test(parts[1])) {
      throw new Error('Protected recipient fingerprint is invalid');
    }
    const recovered = await this.deps.recipientRecovery.recoverEmailForSend(String(execution.tenantId), execution.recipientCiphertext);
    const verified = await this.deps.historicalRecipientFingerprint.fingerprintEmailForVersion(String(execution.tenantId), recovered, parts[1]);
    const storedBuffer = Buffer.from(execution.recipientFingerprint);
    const verifiedBuffer = Buffer.from(verified);
    if (storedBuffer.length !== verifiedBuffer.length || !timingSafeEqual(storedBuffer, verifiedBuffer)) {
      throw new Error('Protected recipient fingerprint mismatch');
    }
    return recovered;
  }

  private makeSendIdempotencyKey(
    ctx: OutreachRepositoryContext,
    campaign: OutreachCampaign,
    sequence: OutreachSequence,
    step: SequenceStep,
  ): string {
    if (!sequence.recipientFingerprint) throw new Error('Protected recipient fingerprint is required for idempotency');
    return `outreach:v2:${ctx.tenantId}:${campaign.id}:${sequence.id}:${step.stepNumber}:${sequence.recipientFingerprint}:${step.channel}`;
  }
}

function actionTypeForChannel(channel: OutreachChannel): string {
  if (channel === 'email') return 'OUTREACH_EMAIL_SEND';
  if (channel === 'linkedin') return 'OUTREACH_LINKEDIN_SEND';
  return 'OUTREACH_CALENDAR_CREATE';
}
