import type { TenantContext } from '@projectx/domain';
import type { ModelUsage, TenantId } from '@projectx/shared';
import type { ProposedAction } from './reasoning.interface';

export interface ReasoningArtifact {
  readonly tenantId: TenantId;
  readonly missionId: string;
  readonly executionId: string;
  readonly agentId: string;
  readonly agentVersion?: string;
  readonly capability?: string;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
  readonly rationale: string;
  readonly conclusion: string;
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly requiredApprovals?: readonly string[];
  readonly proposedActions?: readonly ProposedAction[];
  readonly assumptions?: readonly string[];
  readonly modelUsage: ModelUsage;
  readonly providerId: string;
  readonly modelId: string;
  readonly providerRequestId: string;
  readonly latencyMs: number;
  readonly recordedAt: Date;
}

export interface IReasoningArtifactRepository {
  save(ctx: TenantContext, artifact: ReasoningArtifact): Promise<void>;
  listByExecution(ctx: TenantContext, executionId: string): Promise<readonly ReasoningArtifact[]>;
}
