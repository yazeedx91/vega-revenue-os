import type { IAgentExecutor } from '@projectx/ai-runtime';
import type { AIExecutionRequest, AIExecutionResult, ModelUsage } from '@projectx/shared';
import { ResearchEngine } from './research-engine';

export class IntelligenceAgentExecutor implements IAgentExecutor {
  constructor(private readonly engine: ResearchEngine) {}

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    const taskType = request.taskType;
    const startedAt = new Date();
    const modelUsage: ModelUsage = {
      model: 'intelligence-pipeline',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };

    try {
      if (taskType === 'execute-research-pipeline') {
        const input = request.context.mission ?? {};
        const summary = await this.engine.run(
          {
            tenantId: request.tenantId,
            correlationId: request.correlationId,
            missionId: request.missionId,
            userId: undefined,
          },
          {
            missionId: request.missionId,
            workspaceId: (input.workspaceId as string) ?? '',
            icpProfileId: (input.icpId as string) ?? '',
            objective: (input.objective as string) ?? '',
            territories: (input.territory as string[]) ?? [],
            maxResults: (input.maxResults as number) ?? 10,
          },
        );

        return {
          executionId: request.executionId,
          tenantId: request.tenantId,
          missionId: request.missionId,
          status: 'COMPLETED',
          outcome: {
            summary: `Research pipeline completed: ${JSON.stringify(summary)}`,
            decisions: [],
            actions: [],
            evidence: [],
          },
          modelUsage,
          startedAt,
          completedAt: new Date(),
          correlationId: request.correlationId,
          events: ['ResearchPipelineCompleted'],
        };
      }

      return {
        executionId: request.executionId,
        tenantId: request.tenantId,
        missionId: request.missionId,
        status: 'FAILED',
        outcome: {
          summary: `Unsupported intelligence task type: ${taskType}`,
          decisions: [],
          actions: [],
          evidence: [],
        },
        modelUsage,
        startedAt,
        completedAt: new Date(),
        correlationId: request.correlationId,
        events: [],
      };
    } catch (error) {
      return {
        executionId: request.executionId,
        tenantId: request.tenantId,
        missionId: request.missionId,
        status: 'FAILED',
        outcome: {
          summary: `Research pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
          decisions: [],
          actions: [],
          evidence: [],
        },
        modelUsage,
        startedAt,
        completedAt: new Date(),
        correlationId: request.correlationId,
        events: [],
      };
    }
  }
}
