import { randomUUID } from 'crypto';
import { LLMProviderError } from './llm-provider.interface';
import type {
  LLMProviderRequest,
  LLMProviderResult,
  ILLMProvider,
} from './llm-provider.interface';
import type { IProviderRegistry } from './provider-registry';
import type { IExecutionBudgetLedger } from './execution-budget-ledger';

export interface LLMModel {
  readonly modelId: string;
  readonly providerId: string;
  readonly family?: string;
  readonly capabilities: readonly string[];
  readonly maxContextTokens: number;
  readonly costPerInputTokenUsd: number;
  readonly costPerOutputTokenUsd: number;
  readonly supportsStructuredOutput: boolean;
  readonly latencyClass: 'interactive' | 'background' | 'batch' | string;
  readonly lifecycle: 'ACTIVE' | 'DEPRECATED' | 'RETIRED' | 'DRAFT' | 'TESTING';
  readonly priority: number;
}

export interface IModelCatalog {
  listEligibleModels(ctx: { tenantId: string }, request: LLMModelQuery): Promise<readonly LLMModel[]>;
}

export interface LLMModelQuery {
  readonly capability: string;
  readonly maxTokens: number;
  readonly structuredOutputRequired: boolean;
  readonly budget?: { readonly maxCostUsd: number; readonly maxTokens: number };
  readonly latencyClass?: string;
  readonly modelFamily?: string;
  readonly modelId?: string;
}

export type LLMAttemptStatus = 'success' | 'failed' | 'blocked_budget';

/**
 * Auditable record for a single provider attempt within one logical LLM call.
 * Emitted for every provider.invoke outcome (success and failure) so that
 * failed attempts are recorded honestly rather than as fabricated zero usage.
 */
export interface LLMUsageEvent {
  readonly tenantId: string;
  readonly missionId: string;
  readonly executionId: string;
  /** Stable identity of the logical call (one router.invoke). */
  readonly llmCallId: string;
  /** Provider-attempt index within the call (1 = primary, 2 = fallback, ...). */
  readonly attempt: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly providerRequestId?: string;
  readonly capability: string;
  readonly status: LLMAttemptStatus;
  /** Whether an HTTP request was actually dispatched to the provider. */
  readonly submitted: boolean;
  /** Whether real usage figures are known for this attempt. */
  readonly usageKnown: boolean;
  readonly failureClassification?: string;
  readonly retryable?: boolean;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
  /** Conservative charge retained when a submitted attempt's usage is unknown. */
  readonly estimatedCostUsd?: number;
  readonly latencyMs?: number;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
}

export type LLMUsageListener = (event: LLMUsageEvent) => Promise<void> | void;

export class NoEligibleModelError extends Error {
  constructor(
    public readonly request: LLMProviderRequest,
    message: string,
  ) {
    super(message);
    this.name = 'NoEligibleModelError';
  }
}

export class AmbiguousRoutingError extends Error {
  constructor(
    public readonly request: LLMProviderRequest,
    public readonly tiedModels: readonly string[],
  ) {
    super(`Ambiguous LLM routing: cannot deterministically choose between ${tiedModels.join(', ')}`);
    this.name = 'AmbiguousRoutingError';
  }
}

export interface LLMRouterConfig {
  readonly defaultCapability?: string;
  readonly maxAttempts?: number;
}

/**
 * Realistic per-call token reservation bound. A single provider call rarely
 * consumes its full maxTokens output ceiling; reserving the ceiling verbatim
 * would let one attempt consume the entire execution budget and block all
 * fallback. The reservation is reconciled to actual usage on success, so this
 * bound only needs to keep unknown-usage failures conservative.
 */
const PER_CALL_TOKEN_ESTIMATE = 1024;

export class LLMRouter {
  constructor(
    private readonly catalog: IModelCatalog,
    private readonly registry: IProviderRegistry,
    private readonly usageListener?: LLMUsageListener,
    private readonly config: LLMRouterConfig = {},
    private readonly budgetLedger?: IExecutionBudgetLedger,
  ) {}

  async invoke(request: LLMProviderRequest): Promise<LLMProviderResult> {
    const query: LLMModelQuery = {
      capability: request.capability || this.config.defaultCapability || 'chat',
      maxTokens: request.maxTokens,
      structuredOutputRequired: request.structuredOutputSchema !== undefined,
      budget: request.budget,
      latencyClass: (request.metadata?.latencyClass as string | undefined) ?? 'background',
      modelFamily: request.modelFamily,
      modelId: request.modelId,
    };

    const candidates = await this.catalog.listEligibleModels({ tenantId: request.tenantId }, query);
    if (candidates.length === 0) {
      throw new NoEligibleModelError(request, `No eligible model for capability ${query.capability}`);
    }

    const ordered = this.rankCandidates(candidates, query, request);
    if (ordered.length === 0) {
      throw new NoEligibleModelError(request, `No eligible model after ranking for capability ${query.capability}`);
    }

    const maxAttempts = this.config.maxAttempts ?? ordered.length;
    const attempts = ordered.slice(0, maxAttempts);
    const errors: LLMProviderError[] = [];
    const llmCallId = request.llmCallId ?? randomUUID();
    let attemptIndex = 0;
    let blockedByBudget = false;

    for (const model of attempts) {
      attemptIndex += 1;
      const attemptKey = `${llmCallId}:${attemptIndex}`;
      const provider = this.registry.get(model.providerId);
      if (!provider) {
        errors.push(
          new LLMProviderError(
            `Provider ${model.providerId} not registered`,
            model.providerId,
            'PROVIDER_NOT_REGISTERED',
            false,
          ),
        );
        continue;
      }

      await provider.checkReadiness();

      const providerRequest: LLMProviderRequest = {
        ...request,
        modelId: request.modelId ?? model.modelId,
        costPerInputTokenUsd: request.costPerInputTokenUsd ?? model.costPerInputTokenUsd,
        costPerOutputTokenUsd: request.costPerOutputTokenUsd ?? model.costPerOutputTokenUsd,
      };

      // Conservative budget reservation: before dispatching the provider call,
      // reserve the estimated charge. If the accumulated charges plus this
      // estimate exceed the execution budget, the attempt is blocked and no
      // provider call is made. The token estimate is a realistic per-call bound
      // (not the worst-case output cap): request.maxTokens is the per-call
      // output ceiling, which the context assembler sets to the whole execution
      // budget — reserving it verbatim would consume the entire budget on the
      // first attempt and make cross-provider fallback impossible. The
      // reservation is reconciled to actual usage on success, so a realistic
      // bound still keeps unknown-usage failures conservative.
      const estimatedCostUsd =
        (providerRequest.costPerOutputTokenUsd ?? 0) * request.maxTokens;
      const estimatedTokens = Math.min(request.maxTokens, PER_CALL_TOKEN_ESTIMATE);
      const estimate = { costUsd: estimatedCostUsd, tokens: estimatedTokens };
      if (this.budgetLedger && request.budget) {
        const allowed = this.budgetLedger.tryReserve(
          request.executionId,
          attemptKey,
          estimate,
          request.budget,
        );
        if (!allowed) {
          await this.emitAttempt(request, llmCallId, attemptIndex, model, {
            status: 'blocked_budget',
            submitted: false,
            usageKnown: true,
            failureClassification: 'BUDGET_EXHAUSTED',
            retryable: false,
            estimatedCostUsd,
          });
          errors.push(
            new LLMProviderError(
              `Budget exhausted before attempting provider ${model.providerId}`,
              model.providerId,
              'BUDGET_EXHAUSTED',
              false,
            ),
          );
          blockedByBudget = true;
          break;
        }
      }

      const attemptStartedAt = new Date();
      try {
        const result = await provider.invoke(providerRequest);
        this.budgetLedger?.commitActual(request.executionId, attemptKey, {
          costUsd: result.costUsd,
          tokens: result.totalTokens,
        });
        await this.emitAttempt(request, llmCallId, attemptIndex, model, {
          status: 'success',
          submitted: true,
          usageKnown: true,
          providerRequestId: result.providerRequestId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalTokens: result.totalTokens,
          costUsd: result.costUsd,
          latencyMs: result.latencyMs,
          startedAt: attemptStartedAt,
          completedAt: new Date(),
        });
        return result;
      } catch (err) {
        if (err instanceof LLMProviderError) {
          errors.push(err);
          const usage = err.usage;
          const usageKnown = !err.submitted || usage !== undefined;
          const costUsd = usage
            ? usage.inputTokens * (providerRequest.costPerInputTokenUsd ?? 0) +
              usage.outputTokens * (providerRequest.costPerOutputTokenUsd ?? 0)
            : undefined;

          if (!err.submitted) {
            // No provider request was dispatched: release the reservation.
            this.budgetLedger?.release(request.executionId, attemptKey);
          } else if (usage) {
            // Submitted and usage is known: reconcile to actual.
            this.budgetLedger?.commitActual(request.executionId, attemptKey, {
              costUsd: costUsd ?? 0,
              tokens: usage.totalTokens,
            });
          } else {
            // Submitted but usage unknown: retain the conservative estimate so
            // a fallback cannot silently exceed the budget.
            this.budgetLedger?.retain(request.executionId, attemptKey);
          }

          await this.emitAttempt(request, llmCallId, attemptIndex, model, {
            status: 'failed',
            submitted: err.submitted,
            usageKnown,
            failureClassification: err.code,
            retryable: err.retryable,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            totalTokens: usage?.totalTokens,
            costUsd,
            estimatedCostUsd: err.submitted && !usage ? estimatedCostUsd : undefined,
            startedAt: attemptStartedAt,
            completedAt: new Date(),
          });

          if (!err.retryable) {
            throw err;
          }
          continue;
        }
        const unwrapped = err instanceof Error ? err : new Error(String(err));
        throw new LLMProviderError(unwrapped.message, 'router', 'ROUTER_UNEXPECTED_ERROR', false, unwrapped);
      }
    }

    if (blockedByBudget) {
      throw new LLMProviderError(
        `Execution budget exhausted for capability ${query.capability}`,
        'router',
        'BUDGET_EXHAUSTED',
        false,
      );
    }

    const message = errors.map((e) => `${e.providerId}: ${e.message}`).join('; ');
    throw new LLMProviderError(
      `All providers failed for capability ${query.capability}: ${message}`,
      'router',
      'ALL_PROVIDERS_FAILED',
      errors.some((e) => e.retryable),
    );
  }

  private rankCandidates(
    models: readonly LLMModel[],
    query: LLMModelQuery,
    request: LLMProviderRequest,
  ): readonly LLMModel[] {
    const budget = query.budget;
    const active = models.filter((m) => {
      if (m.lifecycle !== 'ACTIVE') return false;
      if (m.maxContextTokens < query.maxTokens) return false;
      if (query.structuredOutputRequired && !m.supportsStructuredOutput) return false;
      if (budget) {
        const estimatedCost = m.costPerOutputTokenUsd > 0 ? m.costPerOutputTokenUsd * query.maxTokens : 0;
        if (estimatedCost > budget.maxCostUsd) return false;
        if (query.maxTokens > budget.maxTokens) return false;
      }
      if (query.modelFamily && m.family !== query.modelFamily) return false;
      if (query.modelId && m.modelId !== query.modelId) return false;
      return true;
    });

    if (active.length === 0) {
      return [];
    }

    const scored = active.map((m) => ({
      model: m,
      score: this.score(m, query),
    }));

    scored.sort((a, b) => {
      if (a.score.priority !== b.score.priority) return a.score.priority - b.score.priority;
      if (a.score.cost !== b.score.cost) return a.score.cost - b.score.cost;
      if (a.score.latency !== b.score.latency) return a.score.latency - b.score.latency;
      return a.model.modelId.localeCompare(b.model.modelId);
    });

    const first = scored[0];
    const tied = scored.filter(
      (s) =>
        s.score.priority === first.score.priority &&
        s.score.cost === first.score.cost &&
        s.score.latency === first.score.latency,
    );
    if (tied.length > 1) {
      throw new AmbiguousRoutingError(
        request,
        tied.map((s) => s.model.modelId),
      );
    }

    return scored.map((s) => s.model);
  }

  private score(model: LLMModel, query: LLMModelQuery): { priority: number; cost: number; latency: number } {
    const latencyRank = { interactive: 1, background: 2, batch: 3 }[model.latencyClass] ?? 9;
    const queryLatencyRank = { interactive: 1, background: 2, batch: 3 }[query.latencyClass ?? 'background'] ?? 9;

    const capabilityMatch = model.capabilities.includes(query.capability) ? 0 : 1000;
    const structuredMatch = !query.structuredOutputRequired || model.supportsStructuredOutput ? 0 : 1000;

    return {
      priority: model.priority + capabilityMatch + structuredMatch,
      cost: model.costPerOutputTokenUsd,
      latency: Math.abs(latencyRank - queryLatencyRank),
    };
  }

  private async emitAttempt(
    request: LLMProviderRequest,
    llmCallId: string,
    attempt: number,
    model: LLMModel,
    detail: {
      readonly status: LLMAttemptStatus;
      readonly submitted: boolean;
      readonly usageKnown: boolean;
      readonly providerRequestId?: string;
      readonly failureClassification?: string;
      readonly retryable?: boolean;
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly totalTokens?: number;
      readonly costUsd?: number;
      readonly estimatedCostUsd?: number;
      readonly latencyMs?: number;
      readonly startedAt?: Date;
      readonly completedAt?: Date;
    },
  ): Promise<void> {
    if (!this.usageListener) return;
    await this.usageListener({
      tenantId: request.tenantId,
      missionId: request.missionId,
      executionId: request.executionId,
      llmCallId,
      attempt,
      providerId: model.providerId,
      modelId: model.modelId,
      providerRequestId: detail.providerRequestId,
      capability: request.capability,
      status: detail.status,
      submitted: detail.submitted,
      usageKnown: detail.usageKnown,
      failureClassification: detail.failureClassification,
      retryable: detail.retryable,
      inputTokens: detail.inputTokens,
      outputTokens: detail.outputTokens,
      totalTokens: detail.totalTokens,
      costUsd: detail.costUsd,
      estimatedCostUsd: detail.estimatedCostUsd,
      latencyMs: detail.latencyMs,
      startedAt: detail.startedAt,
      completedAt: detail.completedAt,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
    });
  }
}
