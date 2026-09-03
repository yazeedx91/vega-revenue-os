import type { TenantContext } from '@projectx/domain';
import { ensureSameTenant } from '@projectx/domain';
import type { ITelemetry } from '@projectx/infrastructure';
import type {
  AIExecutionRequest,
  AIExecutionResult,
  AIExecutionStatus,
  CorrelationId,
  ExecutionOutcome,
  ModelUsage,
  ToolCallRequest,
  ToolCallResult,
} from '@projectx/shared';
import type { IAgentExecutor } from './agent-executor.interface';
import type { IAgentRegistry } from './agent-registry.interface';
import type { IContextAssembler } from '../context-assembler/context-assembler.interface';
import type { IDecisionEngine } from '../decision/decision.interface';
import type { IKnowledgeRetriever } from '../knowledge/knowledge-retriever.interface';
import type { IMemoryRetriever } from '../memory/memory-retriever.interface';
import type { IOutputValidator } from '../output-validator/output-validator.interface';
import type { IPolicyClient, PolicyDecision } from '../policy-client/policy-client.interface';
import type { IReasoningEngine } from '../reasoning/reasoning.interface';
import type { IToolClient } from '../tool-client/tool-client.interface';
import { ExecutionState, type ExecutionFailure, type FailureClassification } from '../execution-state/execution-state';
import type { ICheckpointStore } from '../execution-state/checkpoint-store.interface';
import type { AgentContract } from '@projectx/shared';

export interface AgentExecutorDeps {
  readonly agentRegistry: IAgentRegistry;
  readonly policyClient: IPolicyClient;
  readonly contextAssembler: IContextAssembler;
  readonly memoryRetriever: IMemoryRetriever;
  readonly knowledgeRetriever: IKnowledgeRetriever;
  readonly reasoningEngine: IReasoningEngine;
  readonly decisionEngine: IDecisionEngine;
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

      const agent = await this.deps.telemetry.span('agent.lookup', () =>
        this.requireAgent(tenantCtx, request.agentId, request.agentVersion),
      );

      this.validateCapabilities(agent, request.capabilities);

      const policyDecision = await this.deps.telemetry.span('policy.evaluate', () =>
        this.deps.policyClient.evaluate(tenantCtx, request),
      );

      if (policyDecision.outcome === 'DENY') {
        return this.fail(
          state,
          request.correlationId,
          'POLICY_DENIED',
          'Policy denied execution',
          false,
          startedAt,
          policyDecision,
        );
      }

      const promptContext = await this.deps.telemetry.span('context.assemble', () =>
        this.deps.contextAssembler.assemble(tenantCtx, request),
      );

      const reasoning = await this.deps.telemetry.span('reasoning', () =>
        this.deps.reasoningEngine.reason(tenantCtx, {
          execution: request,
          promptContext,
          observations: [],
          correlationId: request.correlationId,
          idempotencyKey: request.idempotencyKey,
          deadline: request.deadline,
        }),
      );

      const decision = await this.deps.telemetry.span('decision', () =>
        this.deps.decisionEngine.decide(tenantCtx, {
          execution: request,
          reasoning,
          policyDecision,
          correlationId: request.correlationId,
          idempotencyKey: request.idempotencyKey,
          deadline: request.deadline,
        }),
      );

      if (decision.outcome === 'DENY') {
        return this.fail(
          state,
          request.correlationId,
          'POLICY_DENIED',
          'Decision engine denied execution',
          false,
          startedAt,
          policyDecision,
        );
      }

      if (decision.outcome === 'REQUIRE_APPROVAL') {
        state.transition('AWAITING_APPROVAL');
        await this.saveCheckpoint(state);
        return this.result(
          state,
          request.correlationId,
          'AWAITING_APPROVAL',
          'Awaiting explicit approval',
          startedAt,
          policyDecision,
          reasoning.evidence,
        );
      }

      if (reasoning.modelUsage) {
        this.trackModelUsage(state, reasoning.modelUsage, startedAt);
      }

      if (!state.isWithinBudget(request.budget)) {
        return this.fail(
          state,
          request.correlationId,
          'BUDGET_EXHAUSTED',
          'Execution exceeded allocated budget',
          false,
          startedAt,
          policyDecision,
        );
      }

      const toolResults = await this.executeToolCalls(
        state,
        request,
        agent,
        decision.allowedCapabilities,
        reasoning.proposedActions ?? [],
        policyDecision,
        tenantCtx,
      );

      for (const toolResult of toolResults) {
        if (toolResult.status !== 'SUCCESS') {
          const classification = this.classifyToolFailure(toolResult);
          return this.fail(
            state,
            request.correlationId,
            classification,
            toolResult.error?.message ?? `Tool ${toolResult.toolCallId} failed`,
            toolResult.error?.retryable ?? false,
            startedAt,
            policyDecision,
          );
        }
      }

      const proposedOutput = {
        rationale: reasoning.rationale,
        conclusion: reasoning.conclusion,
        toolResults,
      };
      const validation = await this.deps.outputValidator.validate(tenantCtx, {
        execution: request,
        proposedOutput,
        toolResults,
        correlationId: request.correlationId,
        idempotencyKey: request.idempotencyKey,
        deadline: request.deadline,
      });

      if (!validation.valid) {
        const schema = validation.schemaViolations ?? [];
        const policy = validation.policyViolations ?? [];
        return this.fail(
          state,
          request.correlationId,
          'VALIDATION_ERROR',
          `Output validation failed: ${[...schema, ...policy].join('; ')}`,
          false,
          startedAt,
          policyDecision,
        );
      }

      state.transition('COMPLETED');
      await this.saveCheckpoint(state);

      return this.result(
        state,
        request.correlationId,
        'COMPLETED',
        'Execution completed successfully',
        startedAt,
        policyDecision,
        reasoning.evidence,
      );
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
  ): Promise<AgentContract> {
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

  private validateCapabilities(agent: AgentContract, required: string[]): void {
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

  private trackModelUsage(state: ExecutionState, usage: ModelUsage, startedAt: Date): void {
    const durationSeconds = (Date.now() - startedAt.getTime()) / 1000;
    state.consumeBudget(
      usage.inputTokens + usage.outputTokens,
      usage.costUsd,
      durationSeconds,
    );
    this.deps.telemetry.histogram('llm.latency', durationSeconds, {
      model: usage.model,
    });
  }

  private async executeToolCalls(
    state: ExecutionState,
    request: AIExecutionRequest,
    agent: AgentContract,
    allowedCapabilities: string[],
    proposedActions: import('../reasoning/reasoning.interface').ProposedAction[],
    policyDecision: PolicyDecision,
    tenantCtx: TenantContext,
  ): Promise<ToolCallResult[]> {
    const results: ToolCallResult[] = [];

    for (const action of proposedActions) {
      if (!agent.tools.includes(action.toolId)) {
        throw new Error(`Tool ${action.toolId} is not in agent ${agent.agentId} tool allow-list`);
      }

      const toolRequest: ToolCallRequest = {
        toolCallId: `${request.executionId}-${action.actionId}`,
        toolId: action.toolId,
        toolVersion: action.toolVersion,
        tenantId: request.tenantId,
        missionId: request.missionId,
        agentId: request.agentId,
        agentVersion: request.agentVersion,
        executionId: request.executionId,
        taskId: request.taskId,
        correlationId: request.correlationId,
        idempotencyKey: request.idempotencyKey,
        authorization: {
          policyDecisionId: policyDecision.decisionId,
          decision: policyDecision.outcome,
          capabilities: allowedCapabilities,
          expiresAt: policyDecision.expiresAt,
        },
        riskCategory: action.riskCategory,
        input: action.input,
        timeoutSeconds: 30,
      };

      const result = await this.deps.toolClient.call(toolRequest);
      state.recordToolResult(result);
      results.push(result);
    }

    return results;
  }

  private classifyToolFailure(toolResult: {
    status: string;
    error?: { retryable: boolean };
  }): FailureClassification {
    switch (toolResult.status) {
      case 'TIMEOUT':
        return toolResult.error?.retryable ? 'TIMEOUT' : 'NON_RETRYABLE_BUSINESS_FAILURE';
      case 'PROVIDER_ERROR':
        return toolResult.error?.retryable ? 'TRANSIENT_PROVIDER_ERROR' : 'TOOL_FAILURE';
      case 'POLICY_DENIED':
      case 'UNAUTHORIZED':
        return 'AUTHORIZATION_FAILURE';
      case 'VALIDATION_ERROR':
        return 'VALIDATION_ERROR';
      default:
        return 'TOOL_FAILURE';
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
    const modelUsage: ModelUsage = {
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
      modelUsage,
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
    );
  }
}
