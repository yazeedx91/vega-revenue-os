import type { TenantContext } from '@projectx/domain';
import type { ToolCallRequest, ToolCallResult } from '@projectx/shared';

/**
 * Adapter between domain tool calls and a specific provider (Dynamics 365, email, calendar, etc.).
 */
export interface IToolProvider {
  readonly providerId: string;
  execute(ctx: TenantContext, request: ToolCallRequest): Promise<ToolCallResult>;
}
