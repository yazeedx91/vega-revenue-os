import type { TenantContext } from '@projectx/domain';
import type { ToolCallRequest, ToolProviderOutcome } from '@projectx/shared';

/**
 * Adapter between domain tool calls and a specific provider (Dynamics 365, email, calendar, etc.).
 *
 * `execute` returns a submission-certainty outcome (`submitted`/`resultKnown`/
 * `retryable`/`failureClassification`/`providerRequestId`). The governed
 * `ToolGateway` translates this into a `ToolCallResult` and enforces ambiguous
 * side-effect safety. If `execute` throws unexpectedly after the provider
 * boundary has been crossed, the gateway treats it conservatively as a possible
 * submission (no automatic retry → reconciliation).
 */
export interface IToolProvider {
  readonly providerId: string;
  execute(ctx: TenantContext, request: ToolCallRequest): Promise<ToolProviderOutcome>;
}
