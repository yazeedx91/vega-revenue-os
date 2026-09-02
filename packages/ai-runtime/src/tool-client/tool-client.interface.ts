import type { ToolCallRequest, ToolCallResult } from '@projectx/shared';

export interface IToolClient {
  call(request: ToolCallRequest): Promise<ToolCallResult>;
}
