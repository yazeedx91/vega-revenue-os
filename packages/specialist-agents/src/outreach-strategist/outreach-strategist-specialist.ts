import { BaseSpecialist } from '../base-specialist';
import type { AgentImplementationRuntime } from '@projectx/ai-runtime';
import type { AIExecutionRequest, ExecutionOutcome } from '@projectx/shared';

export interface OutreachStrategistRequest {
  readonly objective: string;
  readonly audience?: { role?: string; industry?: string };
  readonly constraints?: { maxSteps?: number; channels?: string[] };
}

export class OutreachStrategistSpecialist extends BaseSpecialist {
  readonly implementationKey = 'specialist.outreach-strategist.v1' as const;
  readonly capabilities = ['outreach_strategy', 'channel_selection', 'sequence_design'] as const;
  readonly riskCategory = 'strategy';

  protected async executeCore(request: AIExecutionRequest, _runtime: AgentImplementationRuntime): Promise<ExecutionOutcome> {
    const target = (request.context.target ?? {}) as unknown as OutreachStrategistRequest;
    if (!target.objective) {
      throw new Error('Outreach objective is required');
    }

    const channels = target.constraints?.channels ?? ['email'];
    const maxSteps = target.constraints?.maxSteps ?? 3;

    if (!['email', 'linkedin', 'phone'].some((c) => channels.includes(c))) {
      throw new Error('At least one supported outreach channel is required');
    }

    return {
      summary: `Outreach strategy planned for objective "${target.objective}" using channels [${channels.join(', ')}] with ${maxSteps} steps. Sequence execution deferred to Slice 6/10.`,
      decisions: [{ selectedChannels: channels, maxSteps, objective: target.objective }],
      actions: [
        { type: 'design_sequence', channels, maxSteps },
        { type: 'request_tool', toolCategory: 'outreach_execution', slice: 6 },
      ],
      evidence: [
        { audience: target.audience, constraints: target.constraints },
      ],
    };
  }
}

