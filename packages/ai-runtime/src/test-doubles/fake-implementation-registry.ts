import type { AIExecutionRequest, AIExecutionResult, ToolCallResult } from '@projectx/shared';
import type { IAgentImplementation, AgentImplementationRuntime } from '../agent-executor/agent-implementation.interface';
import type { IAgentImplementationRegistry } from '../agent-executor/agent-implementation-registry.interface';

export class FakeAgentImplementation implements IAgentImplementation {
  constructor(public readonly implementationKey: string) {}

  async execute(request: AIExecutionRequest, runtime: AgentImplementationRuntime): Promise<AIExecutionResult> {
    if (request.budget) {
      if (request.budget.maxCostUsd !== undefined && request.budget.maxCostUsd <= 0) {
        return this.fail(runtime, request, 'budget exhausted (cost)');
      }
      if (request.budget.maxTokens !== undefined && request.budget.maxTokens <= 0) {
        return this.fail(runtime, request, 'budget exhausted (tokens)');
      }
      if (request.budget.maxDurationSeconds !== undefined && request.budget.maxDurationSeconds <= 0) {
        return this.fail(runtime, request, 'budget exhausted (time)');
      }
    }

    const reasoning = runtime.reasoningOutput ?? await runtime.reasoningEngine.reason(runtime.tenantContext, {
      execution: request,
      promptContext: runtime.promptContext,
      observations: [],
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      deadline: request.deadline,
    });
    const actions = reasoning.proposedActions ?? [];
    const toolResults: ToolCallResult[] = [];

    for (const action of actions) {
      if (!runtime.agent.contract.tools.includes(action.toolId)) {
        return this.fail(runtime, request, 'Tool ' + action.toolId + ' is not allowed for agent ' + runtime.agent.contract.agentId);
      }
      const toolRequest = {
        toolCallId: request.executionId + '-' + action.actionId,
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
        authorization: { policyDecisionId: 'pd-fake', decision: 'ALLOW' as const, capabilities: request.capabilities, expiresAt: new Date(Date.now() + 60000) },
        riskCategory: action.riskCategory,
        input: action.input,
        timeoutSeconds: 30,
      };
      const result = await runtime.toolClient.call(toolRequest as any);
      runtime.executionState.recordToolResult(result);
      toolResults.push(result);
      if (result.status !== 'SUCCESS') {
        return {
          executionId: request.executionId,
          tenantId: request.tenantId,
          missionId: request.missionId,
          status: 'FAILED',
          outcome: {
            summary: result.error?.message ?? 'Tool ' + toolRequest.toolId + ' failed with status ' + result.status,
            decisions: [{ policyDecisionId: 'pd-fake', outcome: 'ALLOW' as const }],
            actions: toolResults,
            evidence: reasoning.evidence,
          },
          modelUsage: reasoning.modelUsage ?? { model: 'fake', inputTokens: 0, outputTokens: 0, costUsd: 0 },
          startedAt: runtime.startedAt,
          completedAt: new Date(),
          correlationId: request.correlationId,
          events: ['ExecutionFailed'],
        };
      }
    }

    const validation = await runtime.outputValidator.validate(runtime.tenantContext, {
      execution: request,
      proposedOutput: { result: reasoning.conclusion },
      toolResults,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      deadline: request.deadline,
    });
    const violations = [...(validation.schemaViolations ?? []), ...(validation.policyViolations ?? [])];
    const valid = validation.valid && violations.length === 0;
    const summary = valid ? 'Fake execution completed' : 'Output validation failed: ' + violations.join(', ');
    const status = valid ? 'COMPLETED' : 'FAILED';

    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status,
      outcome: {
        summary,
        decisions: [{ policyDecisionId: 'pd-fake', outcome: 'ALLOW' as const }],
        actions: toolResults,
        evidence: reasoning.evidence,
      },
      modelUsage: reasoning.modelUsage ?? { model: 'fake', inputTokens: 0, outputTokens: 0, costUsd: 0 },
      startedAt: runtime.startedAt,
      completedAt: new Date(),
      correlationId: request.correlationId,
      events: ['ExecutionCompleted'],
    };
  }

  private fail(runtime: AgentImplementationRuntime, request: AIExecutionRequest, message: string): AIExecutionResult {
    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: 'FAILED',
      outcome: {
        summary: message,
        decisions: [{ policyDecisionId: 'pd-fake', outcome: 'ALLOW' as const }],
        actions: [],
        evidence: [],
      },
      modelUsage: { model: 'fake', inputTokens: 0, outputTokens: 0, costUsd: 0 },
      startedAt: runtime.startedAt,
      completedAt: new Date(),
      correlationId: request.correlationId,
      events: ['ExecutionFailed'],
    };
  }
}

export class FakeImplementationRegistry implements IAgentImplementationRegistry {
  private readonly implementations = new Map<string, IAgentImplementation>();

  register(implementation: IAgentImplementation): void {
    this.implementations.set(implementation.implementationKey, implementation);
  }

  resolve(implementationKey: string): IAgentImplementation | null {
    return this.implementations.get(implementationKey) ?? null;
  }

  constructor() {
    this.register(new FakeAgentImplementation('fake.agent.v1'));
    this.register(new FakeAgentImplementation('stub.agent.v1'));
  }
}
