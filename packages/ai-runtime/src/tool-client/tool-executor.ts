import type { ITelemetry } from '@projectx/infrastructure';
import type { ToolCallRequest, ToolCallResult } from '@projectx/shared';
import type { IToolClient } from './tool-client.interface';

export interface ToolExecutorOptions {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
}

export class ToolExecutor implements IToolClient {
  constructor(
    private readonly gateway: IToolClient,
    private readonly telemetry: ITelemetry,
    private readonly options: ToolExecutorOptions = { maxRetries: 0, baseDelayMs: 100 },
  ) {}

  async call<TInput = unknown>(
    request: ToolCallRequest<TInput>,
  ): Promise<ToolCallResult> {
    this.validateAuthorization(request);

    let lastResult: ToolCallResult | undefined;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      lastResult = await this.telemetry.span(`tool.execute.${request.toolId}`, () =>
        this.gateway.call(request),
      );

      if (!this.isRetryable(lastResult)) {
        return lastResult;
      }

      this.telemetry.log('warn', `Tool ${request.toolId} attempt ${attempt} failed with retryable error; retrying.`, {
        toolId: request.toolId,
        attempt,
      });

      if (attempt < this.options.maxRetries) {
        await this.delay(this.options.baseDelayMs * 2 ** attempt);
      }
    }

    return lastResult!;
  }

  private validateAuthorization<TInput>(request: ToolCallRequest<TInput>): void {
    if (request.authorization.decision !== 'ALLOW') {
      throw new Error(`Tool ${request.toolId} is not authorized: ${request.authorization.decision}`);
    }
    if (new Date() > request.authorization.expiresAt) {
      throw new Error(`Tool ${request.toolId} authorization expired`);
    }
  }

  private isRetryable(result: ToolCallResult<unknown>): boolean {
    return (
      (result.status === 'PROVIDER_ERROR' || result.status === 'TIMEOUT') &&
      (result.error?.retryable ?? false)
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
