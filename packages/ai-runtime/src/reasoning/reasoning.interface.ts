import type { TenantContext } from '@projectx/domain';
import type {
  AIExecutionRequest,
  CorrelationId,
  ExecutionBudget,
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
  /** Remaining budget after any prior execution steps. */
  remainingBudget?: ExecutionBudget;
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
  /** Safe reasoning artifact fields. Raw chain-of-thought is never persisted here. */
  assumptions?: string[];
  modelUsage?: ModelUsage;
}
