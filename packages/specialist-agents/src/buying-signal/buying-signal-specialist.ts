import { BaseSpecialist } from '../base-specialist';
import type { AgentImplementationRuntime } from '@projectx/ai-runtime';
import type { AIExecutionRequest, ExecutionOutcome } from '@projectx/shared';

export interface BuyingSignalRequest {
  readonly signals?: { type: string; value: unknown; source: string; timestamp?: string }[];
  readonly intentTopics?: string[];
}

export class BuyingSignalSpecialist extends BaseSpecialist {
  readonly implementationKey = 'specialist.buying-signal.v1' as const;
  readonly capabilities = ['buying_signal_detection', 'intent_analysis'] as const;
  readonly riskCategory = 'analysis';

  protected async executeCore(request: AIExecutionRequest, _runtime: AgentImplementationRuntime): Promise<ExecutionOutcome> {
    const target = (request.context.target ?? {}) as BuyingSignalRequest;
    const signals = target.signals ?? [];
    const intentTopics = new Set(target.intentTopics ?? []);

    let matched = 0;
    const matchedSignals: unknown[] = [];
    for (const signal of signals) {
      if (!signal.type || !signal.source) {
        throw new Error('Each signal must have a type and a source');
      }
      if (intentTopics.size === 0 || (signal.value && typeof signal.value === 'string' && intentTopics.has(String(signal.value)))) {
        matched += 1;
        matchedSignals.push(signal);
      }
    }

    const strength = signals.length === 0 ? 0 : matched / signals.length;

    return {
      summary: `Buying-signal analysis: ${matched} of ${signals.length} signals matched intent topics. Real signal enrichment and correlation deferred to Slice 8.`,
      decisions: [{ signalCount: signals.length, matched, strength, intentTopics: [...intentTopics] }],
      actions: [
        { type: 'record_intent_score', strength },
        { type: 'request_tool', toolCategory: 'signal_aggregation', slice: 8 },
      ],
      evidence: matchedSignals,
    };
  }
}

