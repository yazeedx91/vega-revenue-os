import type { OutreachCampaign, OutreachMessageExecution, TenantContext } from '@projectx/domain';
import type { IAuditLog } from '@projectx/infrastructure';
import type { IIdempotencyStore, IRateLimiter } from '@projectx/infrastructure';
import type { CorrelationId, IdempotencyKey } from '@projectx/shared';
import type { IApprovalVerificationPort } from '../ports/approval-verification-port.interface';
import type { IRecipientAllowlistRepository } from '../ports/recipient-allowlist-repository.interface';
import type { ISuppressionRepository } from '../ports/suppression-repository.interface';
import type { SafetyDecision } from './safety-decision';

export interface RateLimitConfig {
  readonly perSecond?: number;
  readonly perMinute?: number;
  readonly perHour?: number;
  readonly perDay?: number;
}

export interface SendSafetyGateDependencies {
  allowlistRepository: IRecipientAllowlistRepository;
  suppressionRepository: ISuppressionRepository;
  approvalVerificationPort: IApprovalVerificationPort;
  rateLimiter: IRateLimiter;
  idempotencyStore: IIdempotencyStore;
  auditLog: IAuditLog;
  rateLimitConfig?: RateLimitConfig;
}

export interface SendSafetyGateInput {
  ctx: TenantContext;
  campaign: OutreachCampaign;
  execution: OutreachMessageExecution;
  recipientAddress: string;
  approvalId: string;
  actionType: string;
  estimatedCostUsd: number;
}

const IDEMPOTENCY_SCOPE = 'outreach:send';

/**
 * The single, authoritative pre-send policy decision for outbound outreach.
 * Composes tenant context, recipient allowlist, suppression/opt-out,
 * independent approval re-verification, rate limiting, budget enforcement,
 * application-command idempotency, and a final content-structure check into
 * one ALLOW / DENY / RETRYABLE decision.
 *
 * MUST be evaluated exactly once, immediately before the provider send call,
 * by the one authoritative send path (`OutreachExecutionService.executeApprovedSend`).
 * This is intentionally the ONLY policy engine for outbound sends — do not
 * duplicate any of these checks elsewhere.
 */
export class SendSafetyGate {
  constructor(private readonly deps: SendSafetyGateDependencies) {}

  async evaluate(input: SendSafetyGateInput): Promise<SafetyDecision> {
    const { ctx, campaign, execution, recipientAddress, approvalId, actionType, estimatedCostUsd } = input;

    // 1. Tenant context sanity — defense in depth beyond repository-level
    // tenant scoping already enforced upstream.
    if (ctx.tenantId !== campaign.tenantId || ctx.tenantId !== execution.tenantId) {
      return this.deny(input, 'INVALID_TENANT_CONTEXT', 'Tenant context does not match campaign/execution tenant');
    }

    // 2. Recipient allowlist — deny by default.
    const allowed = await this.deps.allowlistRepository.isAllowed(ctx, execution.channel, recipientAddress);
    if (!allowed) {
      return this.deny(input, 'NOT_ALLOWLISTED', 'Recipient is not on the tenant allowlist');
    }

    // 3. Suppression / opt-out — blocks every outbound path unconditionally.
    const suppression = await this.deps.suppressionRepository.isSuppressed(ctx, recipientAddress);
    if (suppression) {
      return this.deny(
        input,
        'SUPPRESSED',
        `Recipient is suppressed (${suppression.suppressionType} via ${suppression.source})`,
      );
    }

    // 4. Approval — independently re-verified against the authoritative
    // Approval aggregate. A workflow-level "approved" flag is never trusted.
    const approvalResult = await this.deps.approvalVerificationPort.verify(ctx, {
      approvalId,
      campaignId: campaign.id,
      sequenceId: execution.sequenceId,
      executionId: execution.id,
      idempotencyKey: execution.idempotencyKey as IdempotencyKey,
      recipientFingerprint: execution.recipientFingerprint!,
      actionType,
      correlationId: ctx.correlationId as CorrelationId,
    });
    if (approvalResult.outcome !== 'APPROVED') {
      return this.deny(input, this.approvalDenialCode(approvalResult.outcome), approvalResult.reason);
    }

    // 5. Autonomy policy — autonomy-gated approval requirements are already
    // enforced upstream at draft/approval-request time (Phase 10/11). This
    // gate does not duplicate that logic; it only trusts the independently
    // re-verified approval from step 4.

    // 6. Rate limiting — per-second/minute/hour/day, composed from the
    // shared single-window IRateLimiter primitive.
    const rateLimitDecision = await this.checkRateLimits(ctx, execution.channel);
    if (rateLimitDecision) {
      return this.retryable(input, rateLimitDecision.code, rateLimitDecision.reason, rateLimitDecision.retryAfterMs);
    }

    // 7. Budget — both send-count and cost ceilings. Computed here so the
    // correct denial code can be attributed, then applied via the existing
    // Campaign.recordSpend() as the single source of truth for the mutation.
    const budgetDenial = this.checkBudget(campaign, estimatedCostUsd);
    if (budgetDenial) {
      return this.deny(input, budgetDenial.code, budgetDenial.reason);
    }
    campaign.recordSpend(1, estimatedCostUsd);

    // 8. Content validation — final structural re-check. The LLM-level
    // content/PII/policy validation already ran once at draft time
    // (IOutputValidator in OutreachPersonalizationService); this is not a
    // second policy engine, only a guard against sending a missing/empty
    // draft.
    if (!execution.draft || !execution.draft.body || execution.draft.body.trim().length === 0) {
      return this.deny(input, 'INVALID_CONTENT', 'Execution has no validated draft content to send');
    }

    // 9. Idempotency — application-command layer, evaluated last via a
    // single atomic claim() (test-and-reserve in one operation). This is
    // deliberately the final check before ALLOW: it closes the TOCTOU race
    // that existed with a separate get()-then-set() pattern (two concurrent
    // evaluate() calls for the same idempotency key could otherwise both
    // observe "no completed send yet" and both proceed). Only one caller can
    // ever win the claim for a given key. Distinct from provider-side send
    // idempotency (handled by the provider adapter itself).
    const claimResult = await this.deps.idempotencyStore.claim(ctx, IDEMPOTENCY_SCOPE, execution.idempotencyKey);
    if (!claimResult.claimed) {
      return this.deny(
        input,
        'DUPLICATE_SEND',
        `Execution ${execution.id} already has an in-flight or completed send reserved for this idempotency key`,
      );
    }

    await this.audit(input, 'success', 'ALLOW', 'All safety checks passed');
    return { decision: 'ALLOW' };
  }

  private approvalDenialCode(
    outcome: Exclude<Awaited<ReturnType<IApprovalVerificationPort['verify']>>['outcome'], 'APPROVED'>,
  ): import('./safety-decision').SafetyDenialCode {
    switch (outcome) {
      case 'NOT_FOUND':
        return 'APPROVAL_NOT_FOUND';
      case 'WRONG_TENANT':
        return 'APPROVAL_WRONG_TENANT';
      case 'WRONG_TARGET':
        return 'APPROVAL_WRONG_TARGET';
      case 'EXPIRED':
        return 'APPROVAL_EXPIRED';
      case 'REJECTED':
        return 'APPROVAL_REJECTED';
      case 'CANCELLED':
        return 'APPROVAL_CANCELLED';
      case 'PENDING':
        return 'APPROVAL_PENDING';
      case 'INVALID_ACTION_TYPE':
        return 'APPROVAL_INVALID_ACTION_TYPE';
    }
  }

  private async checkRateLimits(
    ctx: TenantContext,
    channel: string,
  ): Promise<{ code: 'RATE_LIMITED' | 'REDIS_UNAVAILABLE'; reason: string; retryAfterMs: number } | null> {
    const config = this.deps.rateLimitConfig;
    if (!config) return null;

    const windows: Array<{ limit?: number; windowSeconds: number; label: string }> = [
      { limit: config.perSecond, windowSeconds: 1, label: 'per-second' },
      { limit: config.perMinute, windowSeconds: 60, label: 'per-minute' },
      { limit: config.perHour, windowSeconds: 3600, label: 'per-hour' },
      { limit: config.perDay, windowSeconds: 86400, label: 'per-day' },
    ];

    for (const window of windows) {
      if (window.limit === undefined) continue;
      try {
        const result = await this.deps.rateLimiter.isAllowed(ctx, 'outreach-send', channel, window.limit, window.windowSeconds);
        if (!result.allowed) {
          return {
            code: 'RATE_LIMITED',
            reason: `Rate limit exceeded (${window.label}: ${window.limit})`,
            retryAfterMs: Math.max(0, result.resetAt.getTime() - Date.now()),
          };
        }
      } catch (err) {
        return {
          code: 'REDIS_UNAVAILABLE',
          reason: `Redis rate limiter is unavailable; cannot verify rate limit (${window.label})`,
          retryAfterMs: 0,
        };
      }
    }
    return null;
  }

  private checkBudget(
    campaign: OutreachCampaign,
    estimatedCostUsd: number,
  ): { code: 'BUDGET_SEND_COUNT_EXCEEDED' | 'BUDGET_COST_EXCEEDED'; reason: string } | null {
    if (campaign.budget.maxSendCount !== undefined && campaign.sentCount + 1 > campaign.budget.maxSendCount) {
      return { code: 'BUDGET_SEND_COUNT_EXCEEDED', reason: `Budget exceeded: campaign ${campaign.id} would exceed maxSendCount ${campaign.budget.maxSendCount}` };
    }
    if (campaign.budget.maxCostUsd !== undefined && campaign.spentCostUsd + estimatedCostUsd > campaign.budget.maxCostUsd) {
      return { code: 'BUDGET_COST_EXCEEDED', reason: `Budget exceeded: campaign ${campaign.id} would exceed maxCostUsd ${campaign.budget.maxCostUsd}` };
    }
    return null;
  }

  private async deny(
    input: SendSafetyGateInput,
    code: import('./safety-decision').SafetyDenialCode,
    reason: string,
  ): Promise<SafetyDecision> {
    await this.audit(input, 'denied', code, reason);
    return { decision: 'DENY', code, reason };
  }

  private async retryable(
    input: SendSafetyGateInput,
    code: import('./safety-decision').SafetyDenialCode,
    reason: string,
    retryAfterMs: number,
  ): Promise<SafetyDecision> {
    await this.audit(input, 'denied', code, reason);
    return { decision: 'RETRYABLE', code, reason, retryAfterMs };
  }

  private async audit(
    input: SendSafetyGateInput,
    result: 'success' | 'denied',
    codeOrDecision: string,
    reason: string,
  ): Promise<void> {
    await this.deps.auditLog.record(input.ctx, {
      action: 'OUTREACH_SEND_SAFETY_DECISION',
      resourceType: 'OutreachMessageExecution',
      resourceId: input.execution.id as string,
      result,
      reason,
      metadata: {
        decision: codeOrDecision,
        tenantId: input.ctx.tenantId,
        campaignId: input.campaign.id,
        sequenceId: input.execution.sequenceId,
        executionId: input.execution.id,
        approvalId: input.approvalId,
        recipientFingerprint: input.execution.recipientFingerprint,
        correlationId: input.ctx.correlationId,
        actor: 'actor' in input.ctx ? (input.ctx as Record<string, unknown>).actor : 'system',
      },
    });
  }
}
