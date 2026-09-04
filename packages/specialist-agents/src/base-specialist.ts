import type { IAgentImplementation, AgentImplementationRuntime } from '@projectx/ai-runtime';
import type { AIExecutionRequest, AIExecutionResult, ExecutionOutcome, ModelUsage } from '@projectx/shared';

export abstract class BaseSpecialist implements IAgentImplementation {
  abstract readonly implementationKey: string;
  abstract readonly capabilities: readonly string[];
  abstract readonly riskCategory: string;

  async execute(request: AIExecutionRequest, runtime: AgentImplementationRuntime): Promise<AIExecutionResult> {
    this.validateRequest(request, runtime);
    const startedAt = runtime.startedAt;
    const completedAt = new Date();
    const outcome = await this.executeCore(request, runtime);
    return this.buildResult(request, startedAt, completedAt, outcome, runtime);
  }

  protected abstract executeCore(
    request: AIExecutionRequest,
    runtime: AgentImplementationRuntime,
  ): Promise<ExecutionOutcome>;

  protected validateRequest(request: AIExecutionRequest, _runtime: AgentImplementationRuntime): void {
    const required = request.capabilities.length > 0 ? request.capabilities : this.capabilities;
    const available = new Set(this.capabilities);
    const missing = required.filter((cap) => !available.has(cap));
    if (missing.length > 0) {
      throw new Error(`Specialist ${this.implementationKey} cannot satisfy capabilities: ${missing.join(', ')}`);
    }
  }

  protected buildResult(
    request: AIExecutionRequest,
    startedAt: Date,
    completedAt: Date,
    outcome: ExecutionOutcome,
    runtime: AgentImplementationRuntime,
  ): AIExecutionResult {
    const reasoningUsage = runtime.reasoningOutput?.modelUsage;
    const modelUsage: ModelUsage = reasoningUsage ?? {
      model: 'slice-4-deterministic',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: 'COMPLETED',
      outcome,
      modelUsage,
      startedAt,
      completedAt,
      correlationId: request.correlationId,
      events: ['ExecutionCompleted'],
    };
  }
}
