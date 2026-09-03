import { BaseSpecialist } from '../base-specialist';
import type { AgentImplementationRuntime } from '@projectx/ai-runtime';
import type { AIExecutionRequest, ExecutionOutcome } from '@projectx/shared';

export interface LeadQualificationRequest {
  readonly lead?: { title?: string; seniority?: string; department?: string };
  readonly idealPersona?: { titles?: string[]; seniorities?: string[]; departments?: string[] };
}

export class LeadQualificationSpecialist extends BaseSpecialist {
  readonly implementationKey = 'specialist.lead-qualification.v1' as const;
  readonly capabilities = ['lead_qualification', 'lead_scoring'] as const;
  readonly riskCategory = 'qualification';

  protected async executeCore(request: AIExecutionRequest, _runtime: AgentImplementationRuntime): Promise<ExecutionOutcome> {
    const target = (request.context.target ?? {}) as unknown as LeadQualificationRequest;
    if (!target.lead) {
      throw new Error('Lead profile is required for lead qualification');
    }

    const lead = target.lead;
    const persona = target.idealPersona ?? {};
    const matches: string[] = [];

    if (persona.departments && lead.department && persona.departments.includes(lead.department)) matches.push('department');
    if (persona.seniorities && lead.seniority && persona.seniorities.includes(lead.seniority)) matches.push('seniority');
    if (persona.titles && lead.title) {
      const normalized = lead.title.toLowerCase();
      const titleMatch = persona.titles.some((t) => normalized.includes(t.toLowerCase()));
      if (titleMatch) matches.push('title');
    }

    const score = Math.min(1, matches.length / 3);

    return {
      summary: `Lead qualification score: ${(score * 100).toFixed(0)}% based on ${matches.length} persona matches. Deep lead data and engagement history deferred to Slice 8.`,
      decisions: [{ score, qualified: score >= 0.5, matches }],
      actions: [
        { type: 'record_lead_score', score },
        { type: 'request_tool', toolCategory: 'lead_data', slice: 8 },
      ],
      evidence: [{ lead: { title: lead.title, seniority: lead.seniority, department: lead.department }, persona }],
    };
  }
}

