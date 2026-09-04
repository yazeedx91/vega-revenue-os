import type { TenantContext } from '@projectx/domain';
import { ensureSameTenant } from '@projectx/domain';
import type { ITelemetry } from '@projectx/infrastructure';
import type {
  AIExecutionRequest,
  AIExecutionResult,
  AIExecutionStatus,
  CorrelationId,
  ExecutionBudget,
  ExecutionOutcome,
  ModelUsage,
} from '@projectx/shared';
import type { IAgentExecutor } from './agent-executor.interface';
import type { IAgentImplementation, AgentImplementationRuntime } from './agent-implementation.interface';
import type { IAgentImplementationRegistry } from './agent-implementation-registry.interface';
import type { IAgentRegistry } from './agent-registry.interface';
import type { ResolvedAgent } from './resolved-agent';
import type { IContextAssembler } from '../context-assembler/context-assembler.interface';
import type { IKnowledgeRetriever } from '../knowledge/knowledge-retriever.interface';
import type { IMemoryRetriever } from '../memory/memory-retriever.interface';
import type { IOutputValidator } from '../output-validator/output-validator.interface';
import type { IPolicyClient, PolicyDecision } from '../policy-client/policy-client.interface';
import type { IReasoningEngine, ReasoningOutput, ReasoningRequest } from '../reasoning/reasoning.interface';
import type { IToolClient } from '../tool-client/tool-client.interface';
import type { DecisionOutput, DecisionRequest } from '../decision/decision.interface';
import { ExecutionState, type ExecutionFailure, type FailureClassification } from '../execution-state/execution-state';
import type { ICheckpointStore } from '../execution-state/checkpoint-store.interface';

export interface AgentExecutorDeps {
  readonly agentRegistry: IAgentRegistry;
  readonly implementationRegistry: IAgentImplementationRegistry;
  readonly policyClient: IPolicyClient;
  readonly contextAssembler: IContextAssembler;
  readonly memoryRetriever: IMemoryRetriever;
  readonly knowledgeRetriever: IKnowledgeRetriever;
  readonly reasoningEngine: IReasoningEngine;
  readonly decisionEngine: import('../decision/decision.interface').IDecisionEngine;
  readonly toolClient: IToolClient;
  readonly outputValidator: IOutputValidator;
  readonly telemetry: ITelemetry;
  readonly checkpointStore: ICheckpointStore;
}

export class AgentExecutor implements IAgentExecutor {
  constructor(private readonly deps: AgentExecutorDeps) {}

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    const startedAt = new Date();
    const state = new ExecutionState(
      request.executionId,
      request.tenantId,
      request.missionId,
      request.taskId,
      request.agentId,
      request.budget,
    );
    state.transition('RUNNING');
    await this.saveCheckpoint(state);

    const tenantCtx: TenantContext = {
      tenantId: request.tenantId,
      correlationId: request.correlationId,
    };

    try {
      ensureSameTenant(tenantCtx, request.tenantId);
      this.checkDeadline(request.deadline, startedAt);
      this.checkBudget(request.budget);

      const agent = await this.deps.telemetry.span('agent.lookup', () =>
        this.requireAgent(tenantCtx, request.agentId, request.agentVersion),
      );

      this.validateCapabilities(agent.contract, request.capabilities);

      const policyDecision = await this.deps.telemetry.span('policy.evaluate', () =>
        this.deps.policyClient.evaluate(tenantCtx, request),
      );

      const promptContext = await this.deps.telemetry.span('context.assemble', () =>
        this.deps.contextAssembler.assemble(tenantCtx, request),
      );

      if (!state.isWithinBudget(request.budget)) {
        throw new Error('budget exhausted before reasoning');
      }

      const remainingBudget: ExecutionBudget = {
        maxTokens: request.budget.maxTokens - state.budgetConsumed.maxTokens,
        maxCostUsd: request.budget.maxCostUsd - state.budgetConsumed.maxCostUsd,
        maxDurationSeconds: request.budget.maxDurationSeconds - state.budgetConsumed.maxDurationSeconds,
      };

      const reasoningStartedAt = new Date();
      const reasoningOutput = await this.deps.telemetry.span('reasoning', () =>
        this.deps.reasoningEngine.reason(tenantCtx, {
          execution: request,
          promptContext,
          observations: [],
          correlationId: request.correlationId,
          idempotencyKey: request.idempotencyKey,
          deadline: request.deadline,
          remainingBudget,
        } as ReasoningRequest),
      );
      const reasoningCompletedAt = new Date();
      const reasoningDurationSeconds = (reasoningCompletedAt.getTime() - reasoningStartedAt.getTime()) / 1000;
      const reasoningUsage = reasoningOutput.modelUsage ?? { model: 'unknown', inputTokens: 0, outputTokens: 0, costUsd: 0 };
      state.consumeBudget(reasoningUsage.inputTokens + reasoningUsage.outputTokens, reasoningUsage.costUsd, reasoningDurationSeconds);

      if (!state.isWithinBudget(request.budget)) {
        return this.fail(
          state,
          request.correlationId,
          'BUDGET_EXHAUSTED',
          'Reasoning consumed the remaining execution budget',
          false,
          startedAt,
          policyDecision,
          reasoningUsage,
        );
      }

      const decisionOutput = await this.deps.telemetry.span('decision', () =>
        this.deps.decisionEngine.decide(tenantCtx, {
          execution: request,
          reasoning: reasoningOutput,
          policyDecision,
          correlationId: request.correlationId,
          idempotencyKey: request.idempotencyKey,
          deadline: request.deadline,
        } as DecisionRequest),
      );

      if (decisionOutput.outcome === 'DENY') {
        return this.fail(
          state,
          request.correlationId,
          'POLICY_DENIED',
          decisionOutput.rationale,
          false,
          startedAt,
          policyDecision,
          reasoningOutput.modelUsage,
        );
      }

      if (decisionOutput.outcome === 'REQUIRE_APPROVAL') {
        state.transition('AWAITING_APPROVAL');
        await this.saveCheckpoint(state);
        return this.result(
          state,
          request.correlationId,
          'AWAITING_APPROVAL',
          decisionOutput.rationale,
          startedAt,
          policyDecision,
          reasoningOutput.evidence,
          reasoningOutput.modelUsage,
        );
      }

      const implementation = this.deps.implementationRegistry.resolve(agent.implementationKey);
      if (!implementation) {
        return this.fail(
          state,
          request.correlationId,
          'NON_RETRYABLE_BUSINESS_FAILURE',
          `Implementation not found for key ${agent.implementationKey}`,
          false,
          startedAt,
          policyDecision,
        );
      }

      const runtime: AgentImplementationRuntime = {
        tenantContext: tenantCtx,
        agent: { contract: agent.contract, implementationKey: agent.implementationKey },
        promptContext,
        reasoningEngine: this.deps.reasoningEngine,
        decisionEngine: this.deps.decisionEngine,
        toolClient: this.deps.toolClient,
        outputValidator: this.deps.outputValidator,
        contextAssembler: this.deps.contextAssembler,
        memoryRetriever: this.deps.memoryRetriever,
        knowledgeRetriever: this.deps.knowledgeRetriever,
        telemetry: this.deps.telemetry,
        checkpointStore: this.deps.checkpointStore,
        executionState: state,
        reasoningOutput,
        startedAt,
      };

      const specialistResult = await this.deps.telemetry.span('specialist.execute', () =>
        implementation.execute(request, runtime),
      );

      state.transition(specialistResult.status);
      await this.saveCheckpoint(state);

      const specialistUsage = specialistResult.modelUsage;
      if (specialistUsage) {
        state.consumeBudget(
          specialistUsage.inputTokens + specialistUsage.outputTokens,
          specialistUsage.costUsd,
          (specialistResult.completedAt.getTime() - specialistResult.startedAt.getTime()) / 1000,
        );
      }

      if (!state.isWithinBudget(request.budget)) {
        return this.fail(
          state,
          request.correlationId,
          'BUDGET_EXHAUSTED',
          'Specialist execution consumed the remaining budget',
          false,
          startedAt,
          policyDecision,
          specialistUsage ?? reasoningOutput.modelUsage,
        );
      }

      return specialistResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.fail(
        state,
        request.correlationId,
        'NON_RETRYABLE_BUSINESS_FAILURE',
        message,
        false,
        startedAt,
        {
          decisionId: 'unknown',
          tenantId: request.tenantId as string,
          outcome: 'DENY' as const,
          capabilities: [],
          evaluatedAt: new Date(),
          expiresAt: new Date(Date.now() + 60000),
        },
      );
    }
  }

  private async requireAgent(
    ctx: TenantContext,
    agentId: string,
    version?: string,
  ): Promise<ResolvedAgent> {
    const agent = await this.deps.agentRegistry.getAgent(ctx, agentId, version);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    if (agent.lifecycle !== 'ACTIVE' && agent.lifecycle !== 'APPROVED') {
      throw new Error(`Agent ${agentId} is not active`);
    }
    if (version && agent.version !== version) {
      throw new Error(`Agent ${agentId} version mismatch: expected ${version}, got ${agent.version}`);
    }
    return agent;
  }

  private validateCapabilities(agent: import('@projectx/shared').AgentContract, required: string[]): void {
    const available = new Set(agent.capabilities);
    const missing = required.filter((cap) => !available.has(cap));
    if (missing.length > 0) {
      throw new Error(`Missing capabilities: ${missing.join(', ')}`);
    }
  }

  private checkDeadline(deadline: Date | undefined, startedAt: Date): void {
    if (deadline && startedAt > deadline) {
      throw new Error('Execution deadline has already passed');
    }
  }

  private checkBudget(budget: AIExecutionRequest['budget']): void {
    if (!budget) return;
    if (budget.maxCostUsd !== undefined && budget.maxCostUsd <= 0) {
      throw new Error('budget exhausted (cost)');
    }
    if (budget.maxTokens !== undefined && budget.maxTokens <= 0) {
      throw new Error('budget exhausted (tokens)');
    }
    if (budget.maxDurationSeconds !== undefined && budget.maxDurationSeconds <= 0) {
      throw new Error('budget exhausted (time)');
    }
  }

  private async saveCheckpoint(state: ExecutionState): Promise<void> {
    await this.deps.checkpointStore.save(state.snapshot());
  }

  private result(
    state: ExecutionState,
    correlationId: CorrelationId,
    status: AIExecutionStatus,
    summary: string,
    startedAt: Date,
    policyDecision: PolicyDecision,
    evidence: string[],
    modelUsage?: ModelUsage,
  ): AIExecutionResult {
    const completedAt = new Date();
    const outcome: ExecutionOutcome = {
      summary,
      decisions: [
        { policyDecisionId: policyDecision.decisionId, outcome: policyDecision.outcome },
      ],
      actions: state.toolExecutionHistory.map((r) => ({
        toolCallId: r.toolCallId,
        status: r.status,
      })),
      evidence,
    };
    const usage: ModelUsage = modelUsage ?? {
      model: 'unknown',
      inputTokens: state.budgetConsumed.maxTokens,
      outputTokens: 0,
      costUsd: state.budgetConsumed.maxCostUsd,
    };

    return {
      executionId: state.executionId,
      tenantId: state.tenantId,
      missionId: state.missionId,
      status,
      outcome,
      modelUsage: usage,
      startedAt,
      completedAt,
      correlationId,
      events: ['ExecutionStateChanged'],
    };
  }

  private fail(
    state: ExecutionState,
    correlationId: CorrelationId,
    classification: FailureClassification,
    message: string,
    retryable: boolean,
    startedAt: Date,
    policyDecision: PolicyDecision,
    modelUsage?: ModelUsage,
  ): AIExecutionResult {
    const failure: ExecutionFailure = {
      code: classification,
      message,
      retryable,
      classification,
    };
    state.markFailure(failure);
    this.saveCheckpoint(state).catch(() => undefined);
    return this.result(
      state,
      correlationId,
      'FAILED',
      message,
      startedAt,
      policyDecision,
      [],
      modelUsage,
    );
  }
}



