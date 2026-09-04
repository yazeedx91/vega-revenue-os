import type { TenantContext } from '@projectx/domain';
import { ensureSameTenant } from '@projectx/domain';
import type { ExecutionBudget, ModelUsage, PromptContext } from '@projectx/shared';
import { LLMRouter, LLMProviderError } from '@projectx/llm-gateway';
import type { LLMProviderRequest, LLMProviderResult } from '@projectx/llm-gateway';
import type { IReasoningEngine, ReasoningOutput, ReasoningRequest, ProposedAction } from './reasoning.interface';
import type { IReasoningArtifactRepository, ReasoningArtifact } from './reasoning-artifact.interface';
import { StructuredOutputValidator } from '../output-validator/structured-output-validator';
import type { IOutputValidator, OutputValidationRequest, OutputValidatorPolicy } from '../output-validator/output-validator.interface';

const REASONING_OUTPUT_POLICY: OutputValidatorPolicy = {
  requiredFields: ['rationale', 'conclusion', 'confidence', 'evidence'],
  forbiddenValues: [],
  allowedActions: [],
  piiPatterns: [],
  schema: {
    type: 'object',
    required: ['rationale', 'conclusion', 'confidence', 'evidence'],
    properties: {
      rationale: { type: 'string' },
      conclusion: { type: 'string' },
      confidence: { type: 'number' },
      evidence: { type: 'array', items: { type: 'string' } },
      requiredApprovals: { type: 'array', items: { type: 'string' } },
      proposedActions: { type: 'array' },
      assumptions: { type: 'array', items: { type: 'string' } },
    },
  },
};

export interface ProductionReasoningEngineDeps {
  readonly llmRouter: LLMRouter;
  readonly artifactRepository: IReasoningArtifactRepository;
  readonly outputValidator?: IOutputValidator;
  readonly maxRetries?: number;
}

export class ProductionReasoningEngine implements IReasoningEngine {
  private readonly outputValidator: IOutputValidator;

  constructor(private readonly deps: ProductionReasoningEngineDeps) {
    this.outputValidator = deps.outputValidator ?? new StructuredOutputValidator(REASONING_OUTPUT_POLICY);
  }

  async reason(ctx: TenantContext, request: ReasoningRequest): Promise<ReasoningOutput> {
    ensureSameTenant(ctx, request.execution.tenantId);

    const budget = request.remainingBudget ?? request.execution.budget;
    const maxTokens = Math.min(this.inferMaxTokens(request.promptContext), budget?.maxTokens ?? 1000);
    const baseRequest = this.buildLLMRequest(ctx, request, budget, maxTokens);

    let llmRequest = baseRequest;
    let lastValidation: { valid: boolean; schemaViolations?: string[]; policyViolations?: string[] } | undefined;
    let accumulatedCostUsd = 0;
    let accumulatedTokens = 0;
    let stoppedByBudget = false;
    const maxAttempts = (this.deps.maxRetries ?? 2) + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // Repair budget pre-check: before spending on another call, verify the
      // accumulated spend still leaves room within the execution budget. When
      // the budget is already exhausted, fail safely without another call.
      if (attempt > 0 && budget) {
        const exhausted =
          (budget.maxCostUsd !== undefined && accumulatedCostUsd >= budget.maxCostUsd) ||
          (budget.maxTokens !== undefined && accumulatedTokens >= budget.maxTokens);
        if (exhausted) {
          stoppedByBudget = true;
          break;
        }
      }

      // Deterministic per-call identity: each repair invoke is a distinct,
      // stable logical call (provider fallbacks within it share the call id).
      llmRequest = {
        ...llmRequest,
        llmCallId: `${request.idempotencyKey as unknown as string}:reasoning:${attempt}`,
      };

      let result: LLMProviderResult;
      try {
        result = await this.deps.llmRouter.invoke(llmRequest);
      } catch (err) {
        // Budget exhaustion surfaced by the router's conservative ledger must
        // fail safely (no further repair calls) rather than propagate.
        if (err instanceof LLMProviderError && err.code === 'BUDGET_EXHAUSTED') {
          stoppedByBudget = true;
          break;
        }
        throw err;
      }
      const raw = this.extractRaw(result);
      accumulatedCostUsd += result.costUsd;
      accumulatedTokens += result.totalTokens;

      const validation = await this.outputValidator.validate(ctx, {
        execution: request.execution,
        proposedOutput: raw,
        correlationId: request.correlationId,
        idempotencyKey: request.idempotencyKey,
        deadline: request.deadline,
        abortSignal: request.abortSignal,
      } as OutputValidationRequest);

      if (validation.valid) {
        const reasoning = this.toReasoningOutput(raw as Record<string, unknown>, result);
        const artifact = this.toArtifact(ctx, request, reasoning, result);
        await this.deps.artifactRepository.save(ctx, artifact);
        return reasoning;
      }

      lastValidation = validation;
      llmRequest = {
        ...llmRequest,
        messages: [
          ...llmRequest.messages,
          { role: 'assistant', content: typeof raw === 'string' ? raw : JSON.stringify(raw) },
          { role: 'user', content: this.buildCorrectionMessage(validation) },
        ],
      };
    }

    const nullResult: LLMProviderResult = {
      providerId: 'none',
      modelId: 'none',
      providerRequestId: 'none',
      content: '',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      finishReason: 'validation_failed',
      startedAt: new Date(),
      completedAt: new Date(),
    };

    const fallback: ReasoningOutput = {
      rationale: stoppedByBudget
        ? 'Reasoning repair stopped: execution budget exhausted before a valid structured output was produced.'
        : `Model output failed structured validation after ${maxAttempts} attempts: ${lastValidation?.schemaViolations?.join('; ') ?? 'unknown'}`,
      conclusion: stoppedByBudget ? 'budget_exhausted' : 'invalid_structured_output',
      confidence: 0,
      evidence: lastValidation?.schemaViolations ?? [],
      requiredApprovals: [],
      proposedActions: [],
      assumptions: ['Output did not conform to the required reasoning schema.'],
      modelUsage: this.toModelUsage({}, nullResult),
    };
    await this.deps.artifactRepository.save(ctx, this.toArtifact(ctx, request, fallback, undefined));
    return fallback;
  }

  private buildLLMRequest(
    _ctx: TenantContext,
    request: ReasoningRequest,
    budget: ExecutionBudget | undefined,
    maxTokens: number,
  ): LLMProviderRequest {
    const messages = this.toMessages(request.promptContext, request.observations);
    return {
      tenantId: request.execution.tenantId as string,
      missionId: request.execution.missionId,
      executionId: request.execution.executionId,
      agentId: request.execution.agentId,
      agentVersion: request.execution.agentVersion ?? 'unknown',
      capability: 'reasoning',
      modelFamily: request.promptContext.modelFamily,
      messages,
      structuredOutputSchema: REASONING_OUTPUT_POLICY.schema as unknown as Record<string, unknown>,
      maxTokens,
      temperature: 0.2,
      deadline: request.deadline,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      budget: budget ? { maxCostUsd: budget.maxCostUsd, maxTokens: budget.maxTokens } : undefined,
      metadata: {
        latencyClass: 'background',
        origin: 'reasoning-engine',
      },
    };
  }

  private toMessages(promptContext: PromptContext, observations: string[]): import('@projectx/llm-gateway').LLMMessage[] {
    const messages: import('@projectx/llm-gateway').LLMMessage[] = [];
    if (promptContext.userMessage) {
      messages.push({ role: 'system', content: promptContext.userMessage });
    }
    if (promptContext.memoryContext?.length) {
      messages.push({ role: 'user', content: promptContext.memoryContext.join('\n') });
    }
    if (promptContext.knowledgeContext?.length) {
      messages.push({ role: 'user', content: promptContext.knowledgeContext.join('\n') });
    }
    if (promptContext.toolsAvailable?.length) {
      messages.push({
        role: 'user',
        content: `Authorized capabilities: ${promptContext.toolsAvailable.join(', ')}`,
      });
    }
    if (observations.length) {
      messages.push({ role: 'user', content: `Observations:\n${observations.join('\n')}` });
    }
    return messages;
  }

  private extractRaw(result: LLMProviderResult): unknown {
    return result.structured ?? this.tryParse(result.content);
  }

  private tryParse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private buildCorrectionMessage(validation: {
    valid: boolean;
    schemaViolations?: string[];
    policyViolations?: string[];
  }): string {
    const reasons = (validation.schemaViolations ?? []).concat(validation.policyViolations ?? []);
    return `Your previous response failed validation. Fix it and reply with only the corrected JSON object. Violations: ${reasons.join('; ')}`;
  }

  private toReasoningOutput(raw: Record<string, unknown>, result: LLMProviderResult): ReasoningOutput {
    return {
      rationale: String(raw.rationale ?? ''),
      conclusion: String(raw.conclusion ?? 'unknown'),
      confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
      evidence: Array.isArray(raw.evidence) ? raw.evidence.map(String) : [],
      requiredApprovals: Array.isArray(raw.requiredApprovals) ? raw.requiredApprovals.map(String) : [],
      proposedActions: this.parseProposedActions(raw.proposedActions),
      assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : [],
      modelUsage: this.toModelUsage(raw, result),
    };
  }

  private parseProposedActions(value: unknown): ProposedAction[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.map((a, i) => ({
      actionId: String((a as Record<string, unknown>).actionId ?? `action-${i}`),
      capability: String((a as Record<string, unknown>).capability ?? 'unknown'),
      toolId: String((a as Record<string, unknown>).toolId ?? 'unknown'),
      toolVersion: String((a as Record<string, unknown>).toolVersion ?? '1.0.0'),
      input: (a as Record<string, unknown>).input ?? {},
      rationale: String((a as Record<string, unknown>).rationale ?? ''),
      riskCategory: (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).includes(
        (a as Record<string, unknown>).riskCategory as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      )
        ? ((a as Record<string, unknown>).riskCategory as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL')
        : 'MEDIUM',
    }));
  }

  private toModelUsage(_raw: unknown, result: LLMProviderResult): ModelUsage {
    return {
      model: result.modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      provider: result.providerId,
      latencyMs: result.latencyMs,
    };
  }

  private toArtifact(
    ctx: TenantContext,
    request: ReasoningRequest,
    reasoning: ReasoningOutput,
    result: LLMProviderResult | undefined,
  ): ReasoningArtifact {
    return {
      tenantId: ctx.tenantId,
      missionId: request.execution.missionId,
      executionId: request.execution.executionId,
      agentId: request.execution.agentId,
      agentVersion: request.execution.agentVersion,
      capability: request.execution.capabilities[0],
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      rationale: reasoning.rationale,
      conclusion: reasoning.conclusion,
      confidence: reasoning.confidence,
      evidence: reasoning.evidence,
      requiredApprovals: reasoning.requiredApprovals,
      proposedActions: reasoning.proposedActions,
      assumptions: reasoning.assumptions,
      modelUsage: reasoning.modelUsage ?? { model: 'none', inputTokens: 0, outputTokens: 0, costUsd: 0 },
      providerId: result?.providerId ?? 'none',
      modelId: result?.modelId ?? 'none',
      providerRequestId: result?.providerRequestId ?? 'none',
      latencyMs: result?.latencyMs ?? 0,
      recordedAt: new Date(),
    };
  }

  private inferMaxTokens(promptContext: PromptContext): number {
    return promptContext.maxTokens ?? 1000;
  }
}
