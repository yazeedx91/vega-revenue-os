import type { ITelemetry } from '@projectx/infrastructure';
import type { ToolCallRequest, ToolCallResult } from '@projectx/shared';
import type { IToolClient } from './tool-client.interface';

/**
 * Thin agent-facing delegation + telemetry boundary. `ToolExecutor` has ZERO
 * retry authority for ALL tools — `ToolGateway` is the sole retry authority for
 * every provider attempt (READ_ONLY, REVERSIBLE_WRITE, IRREVERSIBLE_EXTERNAL).
 * The retry loop is removed entirely; each call is delegated exactly once.
 */
export class ToolExecutor implements IToolClient {
  constructor(
    private readonly gateway: IToolClient,
    private readonly telemetry: ITelemetry,
  ) {}

  async call<TInput = unknown>(
    request: ToolCallRequest<TInput>,
  ): Promise<ToolCallResult> {
    this.validateAuthorization(request);
    // Single delegation — no retry. The governed gateway owns all retry,
    // idempotency, and ambiguous-side-effect reconciliation.
    return this.telemetry.span(`tool.execute.${request.toolId}`, () =>
      this.gateway.call(request),
    );
  }

  private validateAuthorization<TInput>(request: ToolCallRequest<TInput>): void {
    if (request.authorization.decision !== 'ALLOW') {
      throw new Error(`Tool ${request.toolId} is not authorized: ${request.authorization.decision}`);
    }
    if (new Date() > request.authorization.expiresAt) {
      throw new Error(`Tool ${request.toolId} authorization expired`);
    }
  }
}
