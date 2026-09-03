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

  protected async executeCore(request: AIExecutionRequest, _runtime: AgentImplementationRuntime): Promise<ExecutionOutcome> {
    const target = (request.context.target ?? {}) as unknown as ResearchRequest;
    if (!target.researchScope) {
      throw new Error('Research scope is required');
    }
    if (!target.companyName && !target.domain) {
      throw new Error('At least one of companyName or domain is required for research');
    }

    const scope = target.researchScope;
    const decisions = [{ researchScope: scope, target: target.companyName ?? target.domain }];
    const actions = [
      { type: 'plan_research', scope, target: target.companyName ?? target.domain },
      { type: 'request_tool', toolCategory: 'research', slice: 8 },
    ];
    const evidence = [
      { validation: 'input_ok', scope, hasCompanyName: !!target.companyName, hasDomain: !!target.domain },
    ];

    return {
      summary: `Planned ${scope} research for target ${target.companyName ?? target.domain}. Real data collection deferred to Slice 8 research tools.`,
      decisions,
      actions,
      evidence,
    };
  }
}

