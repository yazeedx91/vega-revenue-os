import type { TenantContext } from '@projectx/domain';
import type {
  AIExecutionRequest,
  CorrelationId,
  IdempotencyKey,
  ModelUsage,
  PromptContext,
} from '@projectx/shared';

/**
 * Performs structured reasoning for an agent execution.
 */
export interface IReasoningEngine {
  reason(ctx: TenantContext, request: ReasoningRequest): Promise<ReasoningOutput>;
}

export interface ReasoningRequest {
  execution: AIExecutionRequest;
  promptContext: PromptContext;
  observations: string[];
  correlationId: CorrelationId;
  idempotencyKey?: IdempotencyKey;
  deadline?: Date;
  abortSignal?: AbortSignal;
}

export interface ProposedAction {
  readonly actionId: string;
  readonly capability: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly input: unknown;
  readonly rationale: string;
  readonly riskCategory: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface ReasoningOutput {
  rationale: string;
  conclusion: string;
  confidence: number;
  evidence: string[];
  requiredApprovals?: string[];
  proposedActions?: ProposedAction[];
  modelUsage?: ModelUsage;
}
