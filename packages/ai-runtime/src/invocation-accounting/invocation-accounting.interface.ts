import type { TenantContext } from '@projectx/domain';
import type { TenantId } from '@projectx/shared';

export type LLMInvocationStatus = 'success' | 'failed' | 'blocked_budget';

/**
 * Auditable record for a single provider attempt within one logical LLM call.
 * Identity is (tenantId, llmCallId, attempt) — recordedAt is NOT part of the
 * identity. Failed attempts are recorded honestly: a submitted attempt whose
 * usage is unknown carries NULL usage and usageKnown=false plus a conservative
 * estimatedCostUsd charge so fallback cannot silently exceed budget.
 */
export interface LLMInvocationRecord {
  readonly tenantId: TenantId;
  readonly missionId: string;
  readonly executionId: string;
  /** Stable identity of the logical call (one router.invoke). */
  readonly llmCallId: string;
  /** Provider-attempt index within the call (1 = primary, 2 = fallback, ...). */
  readonly attempt: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly providerRequestId?: string;
  readonly capability: string;
  readonly status: LLMInvocationStatus;
  /** Whether an HTTP request was actually dispatched to the provider. */
  readonly submitted: boolean;
  /** Whether real usage figures are known for this attempt. */
  readonly usageKnown: boolean;
  readonly failureClassification?: string;
  readonly retryable?: boolean;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
  /** Conservative charge retained when a submitted attempt's usage is unknown. */
  readonly estimatedCostUsd?: number;
  readonly latencyMs?: number;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
  readonly recordedAt: Date;
}

export interface IInvocationAccounting {
  record(ctx: TenantContext, record: LLMInvocationRecord): Promise<void>;
  listByExecution(ctx: TenantContext, executionId: string): Promise<readonly LLMInvocationRecord[]>;
}
