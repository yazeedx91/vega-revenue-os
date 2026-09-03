import { BaseSpecialist } from '../base-specialist';
import type { AgentImplementationRuntime } from '@projectx/ai-runtime';
import type { AIExecutionRequest, ExecutionOutcome } from '@projectx/shared';

export interface ConversationRequest {
  readonly lastInboundMessage?: string;
  readonly intent?: 'reply' | 'objection' | 'question' | 'opt_out';
  readonly objections?: string[];
}

export class ConversationSpecialist extends BaseSpecialist {
  readonly implementationKey = 'specialist.conversation.v1' as const;
  readonly capabilities = ['conversation', 'reply_handling', 'objection_response'] as const;
  readonly riskCategory = 'conversation';

  protected async executeCore(request: AIExecutionRequest, _runtime: AgentImplementationRuntime): Promise<ExecutionOutcome> {
    const target = (request.context.target ?? {}) as ConversationRequest;
    const intent = target.intent ?? 'reply';

    if (intent === 'opt_out') {
      return {
        summary: 'Recipient intent is opt-out. No reply generated; compliance/safety review recommended before any further contact.',
        decisions: [{ intent, action: 'suppress' }],
        actions: [{ type: 'record_opt_out', intent }],
        evidence: [{ inboundMessage: target.lastInboundMessage }],
      };
    }

    const responsePlan = {
      acknowledge: !!target.lastInboundMessage,
      addressObjections: (target.objections ?? []).length > 0,
      askNextStep: intent !== 'objection',
    };

    return {
      summary: `Conversation response plan generated for intent "${intent}". Real reply drafting and sentiment analysis deferred to Slice 10.`,
      decisions: [{ intent, responsePlan }],
      actions: [
        { type: 'plan_response', responsePlan },
        { type: 'request_tool', toolCategory: 'inbound_conversation', slice: 10 },
      ],
      evidence: [
        { inboundMessage: target.lastInboundMessage, objections: target.objections },
      ],
    };
  }
}
