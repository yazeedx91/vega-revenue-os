import { BaseSpecialist } from '../base-specialist';
import type { AgentImplementationRuntime } from '@projectx/ai-runtime';
import type { AIExecutionRequest, ExecutionOutcome } from '@projectx/shared';

export interface IcpQualificationRequest {
  readonly company?: { name?: string; industry?: string; size?: string };
  readonly icpCriteria?: { minSize?: number; industries?: string[] };
}

export class IcpQualificationSpecialist extends BaseSpecialist {
  readonly implementationKey = 'specialist.icp-qualification.v1' as const;
  readonly capabilities = ['icp_qualification', 'account_fit_scoring'] as const;
  readonly riskCategory = 'qualification';

  protected async executeCore(request: AIExecutionRequest, _runtime: AgentImplementationRuntime): Promise<ExecutionOutcome> {
    const target = (request.context.target ?? {}) as unknown as IcpQualificationRequest;
    if (!target.company) {
      throw new Error('Company profile is required for ICP qualification');
    }

    const company = target.company;
    const criteria = target.icpCriteria ?? {};
    const fitFactors: string[] = [];
    const mismatchFactors: string[] = [];

    if (criteria.industries && company.industry) {
      if (criteria.industries.includes(company.industry)) fitFactors.push('industry_match');
      else mismatchFactors.push('industry_mismatch');
    }

    if (criteria.minSize !== undefined && company.size) {
      const numeric = parseInt(company.size, 10);
      if (!Number.isNaN(numeric) && numeric >= criteria.minSize) fitFactors.push('size_match');
      else mismatchFactors.push('size_below_threshold');
    }

    const score = fitFactors.length + mismatchFactors.length === 0
      ? 0
      : fitFactors.length / (fitFactors.length + mismatchFactors.length);

    return {
      summary: `ICP fit score computed: ${(score * 100).toFixed(0)}%. Real account enrichment and deep ICP data deferred to Slice 8.`,
      decisions: [{ score, fit: score >= 0.5 }],
      actions: [
        { type: 'record_icp_score', score },
        { type: 'request_tool', toolCategory: 'account_data', slice: 8 },
      ],
      evidence: [
        { factors: fitFactors, mismatches: mismatchFactors, companyIndustry: company.industry, companySize: company.size },
      ],
    };
  }
}

