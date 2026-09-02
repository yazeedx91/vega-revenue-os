import type { ToolCallRequest, ToolCallResult } from '@projectx/shared';
import type { IToolClient } from '../tool-client/tool-client.interface';

export class FakeToolGateway implements IToolClient {
  constructor(private readonly resultFactory: (request: ToolCallRequest) => ToolCallResult) {}

  async call<TInput = unknown>(request: ToolCallRequest<TInput>): Promise<ToolCallResult> {
    return this.resultFactory(request);
  }
}
