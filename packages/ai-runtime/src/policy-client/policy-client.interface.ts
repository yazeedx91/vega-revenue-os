import type { TenantContext } from '@projectx/domain';
import type { AIExecutionRequest } from '@projectx/shared';

export interface IPolicyClient {
  evaluate(ctx: TenantContext, request: AIExecutionRequest): Promise<PolicyDecision>;
}

export interface PolicyDecision {
  decisionId: string;
  tenantId: string;
  missionId?: string;
  agentId?: string;
  agentVersion?: string;
  capability?: string;
  action?: string;
  tool?: string;
  outcome: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  capabilities: string[];
  autonomyLevel?: number;
  riskCategory?: string;
  policyVersion?: string;
  evaluatedAt: Date;
  expiresAt: Date;
  correlationId?: string;
  executionId?: string;
}
