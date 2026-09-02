import type { TenantContext } from '@projectx/domain';
import type { AIExecutionRequest } from '@projectx/shared';

export interface IPolicyClient {
  evaluate(ctx: TenantContext, request: AIExecutionRequest): Promise<PolicyDecision>;
}

export interface PolicyDecision {
  decisionId: string;
  outcome: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  capabilities: string[];
  expiresAt: Date;
}
