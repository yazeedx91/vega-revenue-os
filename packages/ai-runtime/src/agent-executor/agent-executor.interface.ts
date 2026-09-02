import type { AIExecutionRequest, AIExecutionResult } from '@projectx/shared';

/**
 * The runtime that executes a single agent task under the authority of the
 * AI Control Plane and routes tool/LLM calls through the appropriate gateways.
 */
export interface IAgentExecutor {
  execute(request: AIExecutionRequest): Promise<AIExecutionResult>;
}
