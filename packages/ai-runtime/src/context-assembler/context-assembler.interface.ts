import type { TenantContext } from '@projectx/domain';
import type { AIExecutionRequest, PromptContext } from '@projectx/shared';

export interface IContextAssembler {
  assemble(ctx: TenantContext, request: AIExecutionRequest): Promise<PromptContext>;
}
