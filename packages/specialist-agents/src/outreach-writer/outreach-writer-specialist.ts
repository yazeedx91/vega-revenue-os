import { BaseSpecialist } from '../base-specialist';
import type { AgentImplementationRuntime } from '@projectx/ai-runtime';
import type { AIExecutionRequest, ExecutionOutcome } from '@projectx/shared';

export interface OutreachWriterRequest {
  readonly channel: 'email' | 'linkedin';
  readonly recipient?: { name?: string; role?: string; company?: string };
  readonly keyPoints?: string[];
  readonly tone?: string;
}

export class OutreachWriterSpecialist extends BaseSpecialist {
  readonly implementationKey = 'specialist.outreach-writer.v1' as const;
  readonly capabilities = ['outreach_writing', 'message_drafting', 'personalization'] as const;
  readonly riskCategory = 'generation';

  protected async executeCore(request: AIExecutionRequest, _runtime: AgentImplementationRuntime): Promise<ExecutionOutcome> {
    const target = (request.context.target ?? {}) as unknown as OutreachWriterRequest;
    if (!target.channel) {
      throw new Error('Channel is required for message drafting');
    }
    if (!target.recipient) {
      throw new Error('Recipient is required for personalization');
    }

    const tone = target.tone ?? 'professional';
    const placeholders = { name: target.recipient.name ?? '[name]', company: target.recipient.company ?? '[company]', role: target.recipient.role ?? '[role]' };
    const keyPoints = target.keyPoints ?? [];

    return {
      summary: `Draft message planned for ${target.channel} to ${placeholders.name} at ${placeholders.company} with ${keyPoints.length} key points and tone "${tone}". Real LLM generation deferred to Slice 5.`,
      decisions: [{ channel: target.channel, tone, keyPoints }],
      actions: [
        { type: 'request_generation', channel: target.channel, placeholders, keyPoints, tone },
        { type: 'request_tool', toolCategory: 'llm_generation', slice: 5 },
      ],
      evidence: [{ recipient: target.recipient, keyPoints, tone }],
    };
  }
}

