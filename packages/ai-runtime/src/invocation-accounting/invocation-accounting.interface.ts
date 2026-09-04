import type { TenantContext } from '@projectx/domain';
import type { TenantId } from '@projectx/shared';

export interface LLMInvocationRecord {
  readonly tenantId: TenantId;
  readonly missionId: string;
  readonly executionId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly providerRequestId: string;
  readonly capability: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
  readonly recordedAt: Date;
}

export interface IInvocationAccounting {
  record(ctx: TenantContext, record: LLMInvocationRecord): Promise<void>;
  listByExecution(ctx: TenantContext, executionId: string): Promise<readonly LLMInvocationRecord[]>;
}
