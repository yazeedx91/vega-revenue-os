import { BaseSpecialist } from '../base-specialist';
import type { AgentImplementationRuntime } from '@projectx/ai-runtime';
import type { AIExecutionRequest, ExecutionOutcome } from '@projectx/shared';

export interface FollowUpNurtureRequest {
  readonly lastTouchDays?: number;
  readonly engagementTrend?: 'warming' | 'cooling' | 'stale';
  readonly sequenceStep?: number;
}

export class FollowUpNurtureSpecialist extends BaseSpecialist {
  readonly implementationKey = 'specialist.follow-up-nurture.v1' as const;
  readonly capabilities = ['follow_up', 'nurture', 're_engagement'] as const;
  readonly riskCategory = 'nurture';

  protected async executeCore(request: AIExecutionRequest, _runtime: AgentImplementationRuntime): Promise<ExecutionOutcome> {
    const target = (request.context.target ?? {}) as FollowUpNurtureRequest;
    const trend = target.engagementTrend ?? 'stale';
    const nextStep = (target.sequenceStep ?? 0) + 1;
    const cooldownDays = trend === 'stale' ? 14 : trend === 'cooling' ? 7 : 3;

    return {
      summary: `Nurture follow-up planned: trend "${trend}", next step ${nextStep}, recommended cooldown ${cooldownDays} days. Message generation deferred to Slice 5/10.`,
      decisions: [{ trend, nextStep, cooldownDays }],
      actions: [
        { type: 'plan_nurture_step', step: nextStep, cooldownDays },
        { type: 'request_tool', toolCategory: 'nurture_generation', slice: 5 },
      ],
      evidence: [
        { lastTouchDays: target.lastTouchDays, trend, nextStep },
      ],
    };
  }
}
