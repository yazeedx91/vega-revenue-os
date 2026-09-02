import type { TenantContext } from '@projectx/domain';
import { ensureSameTenant } from '@projectx/domain';
import type { IDecisionEngine, DecisionOutput, DecisionRequest } from './decision.interface';

export class PolicyAwareDecisionEngine implements IDecisionEngine {
  async decide(ctx: TenantContext, request: DecisionRequest): Promise<DecisionOutput> {
    ensureSameTenant(ctx, request.execution.tenantId);

    if (request.policyDecision.outcome === 'DENY') {
      return {
        outcome: 'DENY',
        allowedCapabilities: [],
        requiredApprovals: [],
        rationale: 'Policy denied execution; decision engine cannot override.',
      };
    }

    const approvals = new Set<string>(request.reasoning.requiredApprovals ?? []);

    if (request.policyDecision.outcome === 'REQUIRE_APPROVAL') {
      approvals.add('policy');
    }

    const autonomy = request.execution.policyContext.autonomyLevel;
    const risk = request.execution.policyContext.riskCategory;
    const highRiskCategories = new Set(['HIGH', 'CRITICAL']);
    if (highRiskCategories.has(risk) && autonomy < 4) {
      approvals.add(`high-risk-${risk.toLowerCase()}`);
    }

    if (autonomy < 2) {
      approvals.add('autonomy-level');
    }

    if (request.reasoning.confidence < 0.5) {
      approvals.add('low-confidence');
    }

    if (approvals.size > 0) {
      return {
        outcome: 'REQUIRE_APPROVAL',
        allowedCapabilities: request.policyDecision.capabilities,
        requiredApprovals: Array.from(approvals),
        rationale: 'Execution requires explicit approval before proceeding.',
      };
    }

    return {
      outcome: 'ALLOW',
      allowedCapabilities: request.policyDecision.capabilities,
      requiredApprovals: [],
      rationale: 'Policy allowed and all autonomy/confidence checks passed.',
    };
  }
}
