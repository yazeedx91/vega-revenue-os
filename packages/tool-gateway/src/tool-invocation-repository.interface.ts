import type { TenantContext } from '@projectx/domain';
import type { ToolCallStatus } from '@projectx/shared';

/** Durable logical tool invocation (audit/execution record). */
export interface ToolInvocationRecord {
  readonly toolCallId: string;
  readonly toolDefinitionId: string;
  readonly toolId: string;
  readonly version: string;
  readonly providerId: string;
  readonly tenantId: string;
  readonly missionId?: string;
  readonly executionId?: string;
  readonly taskId?: string;
  readonly agentId?: string;
  readonly correlationId: string;
  readonly action?: string;
  readonly idempotencyKey?: string;
  readonly decision?: string;
  /** 'IN_PROGRESS' while in flight; a terminal ToolCallStatus once completed. */
  status: ToolCallStatus | 'IN_PROGRESS';
  auditId?: string;
  readonly startedAt: Date;
  completedAt?: Date;
  error?: Record<string, unknown>;
}

/**
 * Durable per-physical-attempt record. Tri-state crash-safety: a pre-provider
 * attempt is created with `status='STARTED'` and `submitted`/`resultKnown`
 * NULL. `submitted=false` may only be persisted once non-submission is
 * positively known — an incomplete attempt is UNKNOWN, never a fabricated safe
 * failure.
 */
export interface ToolInvocationAttemptRecord {
  readonly tenantId: string;
  readonly toolCallId: string;
  readonly attempt: number;
  readonly toolDefinitionId: string;
  readonly providerId: string;
  status: 'STARTED' | 'COMPLETED' | 'FAILED' | 'OUTCOME_UNKNOWN';
  submitted?: boolean;
  resultKnown?: boolean;
  failureClassification?: string;
  retryable?: boolean;
  providerRequestId?: string;
  readonly startedAt: Date;
  completedAt?: Date;
}

export interface IToolInvocationRepository {
  /** Persist the logical invocation BEFORE the idempotency claim. */
  createInvocation(ctx: TenantContext, record: ToolInvocationRecord): Promise<void>;

  /** Update the logical invocation's terminal status/audit/error. */
  completeInvocation(
    ctx: TenantContext,
    toolCallId: string,
    update: { status: ToolCallStatus; auditId?: string; error?: Record<string, unknown> },
  ): Promise<void>;

  /** Persist a STARTED attempt BEFORE crossing the provider boundary. */
  createAttempt(ctx: TenantContext, record: ToolInvocationAttemptRecord): Promise<void>;

  /** Update an attempt with submission certainty + terminal status. */
  completeAttempt(
    ctx: TenantContext,
    toolCallId: string,
    attempt: number,
    update: Partial<Pick<ToolInvocationAttemptRecord,
      'status' | 'submitted' | 'resultKnown' | 'failureClassification' | 'retryable' | 'providerRequestId'>>,
  ): Promise<void>;

  getInvocation(ctx: TenantContext, toolCallId: string): Promise<ToolInvocationRecord | undefined>;
  listAttempts(ctx: TenantContext, toolCallId: string): Promise<ToolInvocationAttemptRecord[]>;
}
