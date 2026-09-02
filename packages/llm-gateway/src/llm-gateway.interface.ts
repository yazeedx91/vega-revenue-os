import type { LLMCompletion, PromptContext } from '@projectx/shared';

export interface ILLMGateway {
  complete(context: PromptContext): Promise<LLMCompletion>;
}
