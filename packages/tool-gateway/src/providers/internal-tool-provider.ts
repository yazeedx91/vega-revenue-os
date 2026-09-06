import type { TenantContext } from '@projectx/domain';
import type { ToolCallRequest, ToolProviderOutcome } from '@projectx/shared';
import type { IToolProvider } from '../tool-provider.interface';

/**
 * Handler invoked for an internal (in-process) tool. Internal tools never cross
 * a network boundary, so submission certainty is always known: a handler that
 * returns is `submitted=true, resultKnown=true`; a handler that throws is a
 * definitive non-submission (`submitted=false`) because no external side effect
 * could have occurred.
 */
export type InternalToolHandler = (
  ctx: TenantContext,
  request: ToolCallRequest,
) => Promise<unknown>;

/**
 * Generic internal-tool adapter. Routes a provider_id to a registered in-process
 * handler. Used for internal tools (e.g. local research, CRM read) that are
 * invoked through the same governed gateway without a network boundary.
 */
export class InternalToolProvider implements IToolProvider {
  readonly providerId: string;
  private readonly handler: InternalToolHandler;

  constructor(providerId: string, handler: InternalToolHandler) {
    this.providerId = providerId;
    this.handler = handler;
  }

  async execute(ctx: TenantContext, request: ToolCallRequest): Promise<ToolProviderOutcome> {
    try {
      const output = await this.handler(ctx, request);
      return {
        submitted: true,
        resultKnown: true,
        retryable: false,
        output,
      };
    } catch (err) {
      // In-process failure: no external side effect could have occurred.
      return {
        submitted: false,
        resultKnown: true,
        retryable: false,
        failureClassification: 'INTERNAL_ERROR',
        errorCode: 'INTERNAL_ERROR',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
