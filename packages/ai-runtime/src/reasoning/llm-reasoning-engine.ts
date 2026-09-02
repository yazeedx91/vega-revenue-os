import type { TenantContext } from '@projectx/domain';
import { ensureSameTenant } from '@projectx/domain';
import type { ILLMClient } from '../llm-client/llm-client.interface';
import type { IReasoningEngine, ReasoningOutput, ReasoningRequest } from './reasoning.interface';

export class LLMBasedReasoningEngine implements IReasoningEngine {
  constructor(private readonly llmClient: ILLMClient) {}

  async reason(ctx: TenantContext, request: ReasoningRequest): Promise<ReasoningOutput> {
    ensureSameTenant(ctx, request.execution.tenantId);

    const completion = await this.llmClient.complete(request.promptContext);
    const text = completion.content?.trim() ?? '';

    if (!text) {
      return {
        rationale: 'No reasoning content returned by model.',
        conclusion: 'insufficient_information',
        confidence: 0,
        evidence: [],
        requiredApprovals: [],
      };
    }

    const modelUsage = {
      model: completion.model,
      inputTokens: completion.tokensInput,
      outputTokens: completion.tokensOutput,
      costUsd: completion.costUsd,
    };

    try {
      const parsed = JSON.parse(text) as Partial<ReasoningOutput>;
      return {
        rationale: parsed.rationale ?? text,
        conclusion: parsed.conclusion ?? 'unknown',
        confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
        evidence: parsed.evidence ?? [],
        requiredApprovals: parsed.requiredApprovals,
        proposedActions: parsed.proposedActions,
        modelUsage,
      };
    } catch {
      return {
        rationale: text,
        conclusion: 'parsed_from_free_text',
        confidence: 0.5,
        evidence: [],
        requiredApprovals: [],
        modelUsage,
      };
    }
  }
}
