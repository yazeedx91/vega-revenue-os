import { BaseSpecialist } from '../base-specialist';
import type { AgentImplementationRuntime } from '@projectx/ai-runtime';
import type { AIExecutionRequest, ExecutionOutcome } from '@projectx/shared';

export interface ResearchRequest {
  readonly companyName?: string;
  readonly domain?: string;
  readonly researchScope: 'company' | 'market' | 'person';
}

export class ResearchSpecialist extends BaseSpecialist {
  readonly implementationKey = 'specialist.research.v1' as const;
  readonly capabilities = ['research', 'company_research', 'market_research'] as const;
  readonly riskCategory = 'research';

  protected async executeCore(request: AIExecutionRequest, runtime: AgentImplementationRuntime): Promise<ExecutionOutcome> {
    const target = (request.context.target ?? {}) as unknown as ResearchRequest;
    if (!target.researchScope) {
      throw new Error('Research scope is required');
    }
    if (!target.companyName && !target.domain) {
      throw new Error('At least one of companyName or domain is required for research');
    }

    const scope = target.researchScope;
    const targetName = target.companyName ?? target.domain;
    const reasoning = runtime.reasoningOutput;

    const summary = reasoning?.conclusion && reasoning.conclusion !== 'unknown'
      ? reasoning.conclusion
      : `Planned ${scope} research for target ${targetName}. Real data collection deferred to Slice 8 research tools.`;

    const evidence = reasoning?.evidence && reasoning.evidence.length > 0
      ? reasoning.evidence.map((e) => ({ source: 'reasoning', content: e }))
      : [{ validation: 'input_ok', scope, hasCompanyName: !!target.companyName, hasDomain: !!target.domain }];

    const decisions = [{ researchScope: scope, target: targetName }];
    const actions = reasoning?.proposedActions && reasoning.proposedActions.length > 0
      ? reasoning.proposedActions.map((a) => ({
          type: a.toolId,
          input: a.input,
          capability: a.capability,
          rationale: a.rationale,
        }))
      : [
          { type: 'plan_research', scope, target: targetName },
          { type: 'request_tool', toolCategory: 'research', slice: 8 },
        ];

    return {
      summary,
      decisions,
      actions,
      evidence,
    };
  }
}

