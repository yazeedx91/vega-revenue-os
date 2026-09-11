import type { ConversationRepositoryContext } from '../ports/conversation-repository.interface';
import type {
  AIExecutionRequest,
  AIExecutionResult,
  ModelUsage,
} from '@projectx/shared';
import type { IAgentExecutor } from '@projectx/ai-runtime';
import type { ConversationHandlingService } from '../application/conversation-handling.service';
import type { ReplyIngressEvent } from '../ports/reply-ingress.interface';

export class ConversationAgentExecutor implements IAgentExecutor {
  constructor(private readonly service: ConversationHandlingService) {}

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    const startedAt = new Date();
    const modelUsage: ModelUsage = {
      model: 'conversation-deterministic',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };

    const workspaceId = request.context.authorization?.workspaceId;
    if (!workspaceId) return this.failed(request, 'Trusted workspace authorization context is required', startedAt, modelUsage);
    const ctx: ConversationRepositoryContext = {
      tenantId: request.tenantId,
      workspaceId,
      correlationId: request.correlationId,
    };

    try {
      if (request.taskType === 'handle-reply') {
        const event = request.context.target as unknown as ReplyIngressEvent;
        const result = await this.service.handleReply(ctx, event);
        return this.completed(request, result, startedAt, modelUsage);
      }

      if (request.taskType === 'classify-and-act') {
        const target = (request.context.target ?? {}) as Record<string, unknown>;
        const conversationId = target.conversationId as string;
        const autonomyLevel = (target.autonomyLevel as number) ?? 2;
        const conversation = await this.service.load(ctx, conversationId);
        if (!conversation) {
          throw new Error(`Conversation ${conversationId} not found`);
        }
        const result = await this.service.classifyAndAct(ctx, conversation, autonomyLevel);
        return this.completed(request, result, startedAt, modelUsage);
      }

      return this.failed(request, `Unsupported conversation task type: ${request.taskType}`, startedAt, modelUsage);
    } catch (error) {
      return this.failed(
        request,
        error instanceof Error ? error.message : String(error),
        startedAt,
        modelUsage,
      );
    }
  }

  private completed(
    request: AIExecutionRequest,
    result: unknown,
    startedAt: Date,
    modelUsage: ModelUsage,
  ): AIExecutionResult {
    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: 'COMPLETED',
      outcome: {
        summary: JSON.stringify(result),
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

  private failed(
    request: AIExecutionRequest,
    reason: string,
    startedAt: Date,
    modelUsage: ModelUsage,
  ): AIExecutionResult {
    return {
      executionId: request.executionId,
      tenantId: request.tenantId,
      missionId: request.missionId,
      status: 'FAILED',
      outcome: {
        summary: reason,
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
