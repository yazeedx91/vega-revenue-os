import type { ToolCallRequest, ToolCallResult } from '@projectx/shared';

/**
 * Single external-action path. All agent/external interactions go through here.
 */
export interface IToolGateway {
  execute(request: ToolCallRequest): Promise<ToolCallResult>;
}
