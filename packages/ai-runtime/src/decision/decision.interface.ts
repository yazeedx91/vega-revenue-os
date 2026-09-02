import type { TenantContext } from '@projectx/domain';
import type { AIExecutionRequest, CorrelationId, IdempotencyKey } from '@projectx/shared';
import type { ReasoningOutput } from '../reasoning/reasoning.interface';
import type { PolicyDecision } from '../policy-client/policy-client.interface';

/**
 * Combines reasoning and policy evaluation to render an execution decision.
 */
export interface IDecisionEngine {
  decide(ctx: TenantContext, request: DecisionRequest): Promise<DecisionOutput>;
}

export interface DecisionRequest {
  execution: AIExecutionRequest;
  reasoning: ReasoningOutput;
  policyDecision: PolicyDecision;
  correlationId: CorrelationId;
  idempotencyKey?: IdempotencyKey;
  deadline?: Date;
  abortSignal?: AbortSignal;
}

export interface DecisionOutput {
  outcome: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  allowedCapabilities: string[];
  requiredApprovals: string[];
  rationale: string;
}
